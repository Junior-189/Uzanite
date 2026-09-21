import { z } from 'zod';

export const contactPhoneParam = z.object({ phone: z.string().trim().min(1).max(32) });

export const listContactsQuery = z
  .object({
    search: z.string().trim().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    cursor: z.string().uuid().optional(),
  })
  .strict();

export const createContactSchema = z
  .object({
    phone: z.string().trim().min(5).max(32),
    name: z.string().trim().max(120).optional().default(''),
  })
  .strict();

export const updateContactSchema = z
  .object({
    name: z.string().trim().max(120).optional(),
    email: z.union([z.string().trim().email('Invalid email'), z.literal('')]).optional(),
  })
  .strict();

export const contactEmailSchema = z
  .object({
    subject: z.string().trim().min(1).max(200),
    message: z.string().trim().min(1).max(5000),
  })
  .strict();

export type ListContactsQuery = z.infer<typeof listContactsQuery>;
export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type ContactEmailInput = z.infer<typeof contactEmailSchema>;
