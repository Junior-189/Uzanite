import { describe, it, expect } from 'vitest';
import { registerSchema, loginSchema, setPlanSchema, updateTenantSchema } from './index';

describe('contracts (Zod)', () => {
  it('normalizes email and accepts a strong registration', () => {
    const parsed = registerSchema.parse({ name: 'Amina', email: 'Amina@Example.com', password: 'Str0ng!Passw0rd' });
    expect(parsed.email).toBe('amina@example.com');
  });

  it('rejects a weak password and unknown fields', () => {
    expect(registerSchema.safeParse({ name: 'A', email: 'a@b.com', password: 'weak' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@b.com', password: 'x', role: 'admin' }).success).toBe(false);
  });

  it('validates plan and tenant updates strictly', () => {
    expect(setPlanSchema.safeParse({ plan: 'pro' }).success).toBe(true);
    expect(setPlanSchema.safeParse({ plan: 'enterprise' }).success).toBe(false);
    expect(updateTenantSchema.safeParse({ name: 'Shop', role: 'admin' }).success).toBe(false);
  });
});
