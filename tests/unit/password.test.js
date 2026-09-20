import { describe, it, expect } from 'vitest';
import { validatePassword } from '../../src/middleware/auth.js';

describe('validatePassword', () => {
  it('accepts a strong password', () => {
    expect(validatePassword('Str0ng!Passw0rd')).toEqual([]);
  });

  it('rejects short passwords', () => {
    expect(validatePassword('Ab1!')).toContain('At least 8 characters');
  });

  it('requires upper, lower, number and special', () => {
    const errors = validatePassword('alllowercase');
    expect(errors).toContain('At least 1 uppercase letter');
    expect(errors).toContain('At least 1 number');
    expect(errors).toContain('At least 1 special character');
  });
});
