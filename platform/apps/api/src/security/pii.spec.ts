import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { blindIndex, decryptPii, encryptPii, normalizePii } from './pii';

describe('PII helpers', () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.PII_INDEX_KEY = 'p'.repeat(64);
  });
  afterAll(() => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.PII_INDEX_KEY;
  });

  it('round-trips a value through encryption/decryption', () => {
    const ct = encryptPii('Asha Mwinyi');
    expect(ct).toBeTruthy();
    expect(ct).not.toContain('Asha');
    expect(decryptPii(ct)).toBe('Asha Mwinyi');
  });

  it('returns an empty string for missing values and passes legacy plaintext through', () => {
    expect(decryptPii(null)).toBe('');
    expect(decryptPii('legacy plaintext')).toBe('legacy plaintext');
  });

  it('produces a stable, case-insensitive blind index without exposing the value', () => {
    const a = blindIndex('  Asha@Example.com ');
    const b = blindIndex('asha@example.com');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain('asha');
    expect(normalizePii('  X ')).toBe('x');
  });

  it('gives different indexes for different values', () => {
    expect(blindIndex('a@x.com')).not.toBe(blindIndex('b@x.com'));
  });
});
