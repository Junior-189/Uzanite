import { z } from 'zod';

export const objectIdLike = z.string().uuid('Must be a UUID');
export const uuid = objectIdLike;

export const email = z.string().trim().toLowerCase().email('Invalid email');

export const password = z
  .string()
  .min(8, 'At least 8 characters')
  .max(128, 'Too long')
  .regex(/[A-Z]/, 'At least 1 uppercase letter')
  .regex(/[a-z]/, 'At least 1 lowercase letter')
  .regex(/[0-9]/, 'At least 1 number')
  .regex(/[^A-Za-z0-9]/, 'At least 1 special character');

export const phone = z.string().trim().min(5).max(25);

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  cursor: z.string().uuid().optional(),
});

export const idParam = z.object({ id: uuid });

export type PaginationQuery = z.infer<typeof paginationQuery>;
