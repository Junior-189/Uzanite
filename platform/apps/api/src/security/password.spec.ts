import { describe, it, expect } from 'vitest';
import * as bcrypt from 'bcryptjs';
import { hashPassword, verifyPassword, verifyPasswordDetailed, passwordErrors } from './password';

describe('password policy + hashing', () => {
  it('accepts a strong password', () => {
    expect(passwordErrors('Str0ng!Passw0rd')).toEqual([]);
  });

  it('rejects weak passwords', () => {
    expect(passwordErrors('short')).toContain('At least 8 characters');
    expect(passwordErrors('alllowercase')).toContain('At least 1 uppercase letter');
  });

  it('hashes with argon2id and verifies', async () => {
    const hash = await hashPassword('Str0ng!Passw0rd');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('Str0ng');
    expect(await verifyPassword('Str0ng!Passw0rd', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
    expect(await verifyPassword('x', null)).toBe(false);
  });

  it('reports no rehash needed for a current argon2id hash', async () => {
    const hash = await hashPassword('Str0ng!Passw0rd');
    expect(await verifyPasswordDetailed('Str0ng!Passw0rd', hash)).toEqual({ valid: true, needsRehash: false });
  });

  it('verifies legacy bcrypt hashes and flags them for rehash', async () => {
    const legacy = await bcrypt.hash('Str0ng!Passw0rd', 10);
    expect(legacy.startsWith('$2')).toBe(true);
    expect(await verifyPasswordDetailed('Str0ng!Passw0rd', legacy)).toEqual({ valid: true, needsRehash: true });
    expect(await verifyPasswordDetailed('wrong', legacy)).toEqual({ valid: false, needsRehash: false });
  });

  it('fails closed on an unknown hash format', async () => {
    expect(await verifyPasswordDetailed('x', 'not-a-hash')).toEqual({ valid: false, needsRehash: false });
  });
});
