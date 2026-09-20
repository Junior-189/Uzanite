import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { encrypt, decrypt, isEncrypted } = require('../../src/utils/crypto.js');

describe('crypto (AES-256-GCM)', () => {
  it('round-trips a secret', () => {
    const enc = encrypt('EAAG...meta-access-token');
    expect(isEncrypted(enc)).toBe(true);
    expect(enc).not.toContain('EAAG');
    expect(decrypt(enc)).toBe('EAAG...meta-access-token');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    expect(encrypt('same')).not.toBe(encrypt('same'));
  });

  it('returns empty string for empty/invalid input', () => {
    expect(encrypt('')).toBe('');
    expect(decrypt('')).toBe('');
    expect(decrypt('not-encrypted')).toBe('');
  });

  it('rejects tampered ciphertext (auth tag)', () => {
    const enc = encrypt('secret');
    const parts = enc.split('.');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(decrypt(parts.join('.'))).toBe('');
  });
});
