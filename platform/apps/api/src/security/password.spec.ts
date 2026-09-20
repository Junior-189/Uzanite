import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, passwordErrors } from './password';

describe('password policy + hashing', () => {
  it('accepts a strong password', () => {
    expect(passwordErrors('Str0ng!Passw0rd')).toEqual([]);
  });

  it('rejects weak passwords', () => {
    expect(passwordErrors('short')).toContain('At least 8 characters');
    expect(passwordErrors('alllowercase')).toContain('At least 1 uppercase letter');
  });

  it('hashes and verifies', async () => {
    const hash = await hashPassword('Str0ng!Passw0rd');
    expect(hash).not.toContain('Str0ng');
    expect(await verifyPassword('Str0ng!Passw0rd', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
    expect(await verifyPassword('x', null)).toBe(false);
  });
});
