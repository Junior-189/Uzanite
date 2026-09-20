import { describe, it, expect } from 'vitest';
import {
  registerSchema,
  loginSchema,
  manualOrderSchema,
  debtUpdateSchema,
  businessUpdateSchema,
  productCreateSchema,
} from '../../src/validation/schemas.js';

describe('Zod schemas', () => {
  it('accepts a valid registration', () => {
    const parsed = registerSchema.parse({
      name: 'Amina',
      email: 'Amina@Example.com',
      password: 'Str0ng!Passw0rd',
    });
    expect(parsed.email).toBe('amina@example.com');
  });

  it('rejects a weak password at registration', () => {
    const res = registerSchema.safeParse({ name: 'A', email: 'a@b.com', password: 'weak' });
    expect(res.success).toBe(false);
  });

  it('strips unknown keys on login (strict)', () => {
    const res = loginSchema.safeParse({ email: 'a@b.com', password: 'x', role: 'super_admin' });
    expect(res.success).toBe(false);
  });

  it('validates manual orders require at least one item', () => {
    const res = manualOrderSchema.safeParse({ items: [] });
    expect(res.success).toBe(false);
  });

  it('does not allow protected debt fields', () => {
    const res = debtUpdateSchema.safeParse({ paidAmount: 999, businessId: 'other' });
    // strict schema rejects unknown keys
    expect(res.success).toBe(false);
  });

  it('rejects unknown business update fields', () => {
    const res = businessUpdateSchema.safeParse({ name: 'Shop', role: 'super_admin' });
    expect(res.success).toBe(false);
  });

  it('coerces product price from string (multipart)', () => {
    const parsed = productCreateSchema.parse({ name: 'Coke', price: '1500', stock: '10' });
    expect(parsed.price).toBe(1500);
    expect(parsed.stock).toBe(10);
  });
});
