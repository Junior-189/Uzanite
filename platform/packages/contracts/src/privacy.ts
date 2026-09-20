import { z } from 'zod';
import { uuid } from './common';

// Data-subject rights (Tanzania Personal Data Protection Act, 2022).
// The platform previously had no privacy surface at all, so migrating a tenant
// off Express would have removed their export/erasure/consent tooling.

export const privacyExportQuery = z
  .object({
    /** Narrow the export to one data subject; omit for the whole tenant. */
    phone: z.string().trim().max(25).optional(),
    email: z.string().trim().email().max(200).optional(),
  })
  .strict();

export const privacyEraseSchema = z
  .object({
    phone: z.string().trim().max(25).optional(),
    email: z.string().trim().email().max(200).optional(),
    /**
     * Erasure must not silently destroy financial records that the tenant is
     * legally required to retain. When true, order/payment rows are
     * pseudonymised (PII stripped, amounts kept) instead of deleted.
     */
    preserveFinancialRecords: z.boolean().optional().default(true),
    reason: z.string().trim().max(500).optional().default(''),
  })
  .strict()
  .refine((v) => v.phone || v.email, { message: 'phone or email is required' });

export const consentSchema = z
  .object({
    phone: z.string().trim().max(25).optional(),
    email: z.string().trim().email().max(200).optional(),
    channel: z.enum(['whatsapp', 'email', 'sms', 'any']).optional().default('any'),
    action: z.enum(['granted', 'revoked']),
    source: z.string().trim().max(80).optional().default('api'),
  })
  .strict()
  .refine((v) => v.phone || v.email, { message: 'phone or email is required' });

export const listPrivacyRequestsQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional().default(25),
    cursor: uuid.optional(),
  })
  .strict();

export type PrivacyExportQuery = z.infer<typeof privacyExportQuery>;
export type PrivacyEraseInput = z.infer<typeof privacyEraseSchema>;
export type ConsentInput = z.infer<typeof consentSchema>;
export type ListPrivacyRequestsQuery = z.infer<typeof listPrivacyRequestsQuery>;
