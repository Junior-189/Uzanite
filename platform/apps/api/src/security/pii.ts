import { blindIndex as sharedBlindIndex, decrypt, encrypt, isEncrypted } from '@uzanite/messaging';

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
/** Case/whitespace-insensitive normalisation before indexing. */
export function normalizePii(value: string): string {
  return value.trim().toLowerCase();
}

export const blindIndex = sharedBlindIndex;

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
