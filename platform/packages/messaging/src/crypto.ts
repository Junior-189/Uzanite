import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

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

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new DecryptionError('ENCRYPTION_KEY is not set — cannot encrypt/decrypt secrets.', 'no_key');
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  return createHash('sha256').update(raw).digest();
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
  try {
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const ct = Buffer.from(parts[3], 'base64');
    const decipher = createDecipheriv('aes-256-gcm', getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (err) {
    if (err instanceof DecryptionError) throw err;
    // GCM auth failure: wrong key, or the ciphertext was tampered with.
    throw new DecryptionError(
      'Stored secret failed authentication — ENCRYPTION_KEY does not match the key used to encrypt it.',
      'key_mismatch'
    );
  }
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

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString('hex');
}
