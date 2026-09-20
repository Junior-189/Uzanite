import { z } from 'zod';
import { uuid } from './common';

// Mirrors the legacy Express Payment enum.
export const paymentStatus = z.enum([
  'initiated',
  'pending',
  'processing',
  'succeeded',
  'failed',
  'cancelled',
  'refunded',
]);

export const paymentProvider = z.enum(['manual', 'clickpesa', 'azampay']);

export const ledgerEntryType = z.enum(['payment_in', 'cash_sale', 'refund', 'adjustment']);
export const ledgerDirection = z.enum(['credit', 'debit']);

export const initiatePaymentSchema = z
  .object({
    provider: paymentProvider.optional().default('manual'),
    method: z.string().trim().max(60).optional().default('manual'),
    phone: z.string().trim().max(32).optional(),
  })
  .strict();

// Manual confirmation: a reference is required, proof is an optional stored key.
export const confirmManualPaymentSchema = z
  .object({
    method: z.string().trim().max(60).optional().default('manual'),
    reference: z.string().trim().min(1).max(120),
    proofPath: z.string().trim().max(500).optional().nullable(),
  })
  .strict();

export const refundPaymentSchema = z
  .object({
    amount: z.coerce.number().positive(),
    reason: z.string().trim().max(500).optional().default(''),
    clientRef: z.string().trim().max(120).optional().nullable(),
  })
  .strict();

export const listPaymentsQuery = z
  .object({
    status: paymentStatus.optional(),
    provider: paymentProvider.optional(),
    orderId: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(25),
    cursor: uuid.optional(),
  })
  .strict();

export const listLedgerQuery = z
  .object({
    type: ledgerEntryType.optional(),
    direction: ledgerDirection.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(25),
    cursor: uuid.optional(),
  })
  .strict();

export const paymentIdParam = z.object({ id: uuid });
export const webhookProviderParam = z.object({ provider: z.string().trim().min(1).max(40) });

export type PaymentStatusInput = z.infer<typeof paymentStatus>;
export type PaymentProviderInput = z.infer<typeof paymentProvider>;
export type InitiatePaymentInput = z.infer<typeof initiatePaymentSchema>;
export type ConfirmManualPaymentInput = z.infer<typeof confirmManualPaymentSchema>;
export type RefundPaymentInput = z.infer<typeof refundPaymentSchema>;
export type ListPaymentsQuery = z.infer<typeof listPaymentsQuery>;
export type ListLedgerQuery = z.infer<typeof listLedgerQuery>;
