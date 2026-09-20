import { describe, it, expect, beforeAll } from 'vitest';
import { encrypt, decrypt, tryDecrypt, sha256, randomToken } from './crypto';

beforeAll(() => {
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
});

describe('crypto', () => {
  it('round-trips secrets with AES-256-GCM', () => {
    const enc = encrypt('EAAG-meta-token');
    expect(enc.startsWith('v1.')).toBe(true);
    expect(enc).not.toContain('EAAG');
    expect(decrypt(enc)).toBe('EAAG-meta-token');
  });

  it('produces a different ciphertext each time', () => {
    expect(encrypt('same')).not.toBe(encrypt('same'));
  });

  it('rejects tampered ciphertext by throwing, not by returning empty', () => {
    const parts = encrypt('secret').split('.');
    parts[3] = Buffer.from('tampered').toString('base64');
    // Returning '' here used to make a wrong ENCRYPTION_KEY look like
    // "no token configured", hiding the real cause far from the failure.
    expect(() => decrypt(parts.join('.'))).toThrow(/failed authentication/i);
    const { value, error } = tryDecrypt(parts.join('.'));
    expect(value).toBeNull();
    expect(error?.reason).toBe('key_mismatch');
  });

  it('rejects a malformed envelope', () => {
    expect(() => decrypt('not-an-envelope')).toThrow(/envelope/i);
    expect(tryDecrypt('v1.only.three').error?.reason).toBe('malformed');
  });

  it('hashes deterministically and generates random tokens', () => {
    expect(sha256('a')).toBe(sha256('a'));
    expect(randomToken(8)).toHaveLength(16);
  });
});
