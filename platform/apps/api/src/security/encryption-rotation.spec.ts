import { describe, it, expect, afterEach } from 'vitest';
import { encrypt, decrypt } from '@uzanite/messaging';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

describe('ENCRYPTION_KEY rotation', () => {
  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEYS_PREVIOUS;
  });

  it('decrypts data written with a previous key during rotation', () => {
    process.env.ENCRYPTION_KEY = KEY_A;
    const ciphertext = encrypt('per-tenant-secret');

    // Rotate: new active key, old key moved to the previous list.
    process.env.ENCRYPTION_KEY = KEY_B;
    process.env.ENCRYPTION_KEYS_PREVIOUS = KEY_A;

    expect(decrypt(ciphertext)).toBe('per-tenant-secret');
  });

  it('fails loudly when no configured key matches', () => {
    process.env.ENCRYPTION_KEY = KEY_A;
    const ciphertext = encrypt('per-tenant-secret');

    process.env.ENCRYPTION_KEY = KEY_B;
    delete process.env.ENCRYPTION_KEYS_PREVIOUS;

    expect(() => decrypt(ciphertext)).toThrow(/authentication/i);
  });
});
