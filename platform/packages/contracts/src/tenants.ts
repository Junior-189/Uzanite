import { z } from 'zod';
import { phone, uuid } from './common';

export const updateTenantSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    phone: phone.optional(),
    currency: z.string().trim().length(3).optional(),
    timezone: z.string().trim().max(64).optional(),
    theme: z.enum(['light', 'dark']).optional(),
  })
  .strict();

export const upsertPaymentMethodSchema = z
  .object({
    provider: z.enum(['mpesa', 'tigo', 'airtel']),
    number: z.string().trim().min(5).max(25),
    accountName: z.string().trim().max(80).optional().default(''),
    active: z.boolean().optional().default(true),
  })
  .strict();

export const tenantIdParam = z.object({ tenantId: uuid });

export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
export type UpsertPaymentMethodInput = z.infer<typeof upsertPaymentMethodSchema>;
