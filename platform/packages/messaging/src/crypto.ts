import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'crypto';

// AES-256-GCM for secrets at rest (per-tenant Meta access tokens / verify tokens).
// Format: `v1.<iv-b64>.<tag-b64>.<ciphertext-b64>`. Key from ENCRYPTION_KEY
// (64-char hex, or any string hashed to 32 bytes).

/** Raised when a stored secret cannot be decrypted. */
export class DecryptionError extends Error {
  constructor(
    message: string,
    readonly reason: 'malformed' | 'key_mismatch' | 'no_key'
  ) {
    super(message);
    this.name = 'DecryptionError';
  }
}

function keyFrom(raw: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  return createHash('sha256').update(raw).digest();
}

/** The active key used for new encryption. */
function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new DecryptionError('ENCRYPTION_KEY is not set — cannot encrypt/decrypt secrets.', 'no_key');
  return keyFrom(raw);
}

/**
 * Decrypt-only fallback keys, for rotation. Set `ENCRYPTION_KEYS_PREVIOUS` to a
 * comma-separated list of the old secrets; new data is written with the active
 * `ENCRYPTION_KEY`, and existing data still decrypts until it is re-encrypted.
 */
function getKeyCandidates(): Buffer[] {
  const keys = [getKey()];
  const previous = (process.env.ENCRYPTION_KEYS_PREVIOUS ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  for (const raw of previous) keys.push(keyFrom(raw));
  return keys;
}

export function encrypt(plain: string): string {
  if (!plain) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
}

/**
 * Decrypt a stored secret.
 *
 * THROWS on failure, deliberately. This used to return `''` for any error,
 * which turned a rotated or mistyped ENCRYPTION_KEY into "WhatsApp silently
 * stopped working" — the failure surfaced as an empty access token far from its
 * cause, and looked identical to "no token configured". A wrong key is an
 * operational emergency and must say so.
 *
 * Callers that genuinely tolerate a missing secret should use `tryDecrypt`.
 */
export function decrypt(payload: string): string {
  if (!payload) return '';
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new DecryptionError('Stored secret is not in the expected v1 envelope format.', 'malformed');
  }
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const ct = Buffer.from(parts[3], 'base64');
  // Try the active key, then any rotation fallbacks.
  for (const key of getKeyCandidates()) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    } catch {
      // try the next key
    }
  }
  // GCM auth failure on every candidate: wrong key, or the ciphertext was tampered with.
  throw new DecryptionError(
    'Stored secret failed authentication — ENCRYPTION_KEY does not match the key used to encrypt it.',
    'key_mismatch'
  );
}

/**
 * Non-throwing variant: returns `null` on failure and reports why, so a caller
 * can degrade gracefully while still logging a real diagnosis.
 */
export function tryDecrypt(payload: string): { value: string | null; error: DecryptionError | null } {
  try {
    return { value: decrypt(payload), error: null };
  } catch (err) {
    if (err instanceof DecryptionError) return { value: null, error: err };
    throw err;
  }
}

export function isEncrypted(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('v1.');
}

/**
 * Keyed HMAC blind index for equality lookups on encrypted PII. Deterministic,
 * one-way, and domain-separated by a dedicated key (falls back to
 * ENCRYPTION_KEY). Shared by the API and worker so indexes always agree.
 */
export function blindIndex(value: string): string {
  const secret = process.env.PII_INDEX_KEY || process.env.ENCRYPTION_KEY || '';
  if (!secret) throw new Error('PII_INDEX_KEY (or ENCRYPTION_KEY) is required for blind indexes');
  const key = createHmac('sha256', secret).update('pii-index-v1').digest();
  return createHmac('sha256', key).update(value.trim().toLowerCase()).digest('hex');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString('hex');
}
