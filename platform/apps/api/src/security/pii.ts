import { createHmac } from 'crypto';
import { decrypt, encrypt, isEncrypted } from '@uzanite/messaging';

/**
 * PII storage helpers.
 *
 * Confidentiality and lookup are separate concerns:
 *  - `encryptPii` stores the value with AES-256-GCM (never readable at rest).
 *  - `blindIndex` is a keyed HMAC of a normalised value, stored alongside, so
 *    equality lookups (login by email, order lookup by phone, contact upsert)
 *    still work without a plaintext column. It is deterministic but one-way and
 *    domain-separated by a dedicated key.
 *
 * Reads tolerate legacy plaintext rows (`decryptPii` passes non-envelopes
 * through) so a column can be encrypted during a rolling rollout.
 */
function indexKey(): Buffer {
  const secret = process.env.PII_INDEX_KEY || process.env.ENCRYPTION_KEY || '';
  if (!secret) throw new Error('PII_INDEX_KEY (or ENCRYPTION_KEY) is required for blind indexes');
  return createHmac('sha256', secret).update('pii-index-v1').digest();
}

/** Case/whitespace-insensitive normalisation before indexing. */
export function normalizePii(value: string): string {
  return value.trim().toLowerCase();
}

export function blindIndex(value: string): string {
  return createHmac('sha256', indexKey()).update(normalizePii(value)).digest('hex');
}

export function encryptPii(value?: string | null): string | null {
  if (value === undefined || value === null || value === '') return null;
  return encrypt(value);
}

/** Decrypts an envelope; returns plaintext (legacy rows) unchanged; '' when absent. */
export function decryptPii(stored?: string | null): string {
  if (!stored) return '';
  if (!isEncrypted(stored)) return stored;
  try {
    return decrypt(stored);
  } catch {
    // Never surface ciphertext; a key mismatch is logged by the caller's path.
    return '';
  }
}
