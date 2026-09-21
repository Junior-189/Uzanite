import { z } from 'zod';
import { uuid } from './common';

// Mirrors the legacy Express ORDER_STATUS enum exactly.
export const orderStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'PENDING_PAYMENT', 'PAID', 'DELIVERED']);
export const orderSource = z.enum(['whatsapp', 'cash']);

// `annually`/`alltime` are legacy client spellings accepted as aliases of
// `yearly`/`all` (the SPA's PeriodFilter sends these).
export const orderPeriod = z.enum(['daily', 'weekly', 'monthly', 'yearly', 'annually', 'all', 'alltime']);

export const isAllTimePeriod = (period: string | undefined): boolean => !period || period === 'all' || period === 'alltime';

const optionalEmail = z.union([z.string().trim().email('Invalid email'), z.literal('')]).optional().default('');

// A single line item. Price is optional: when omitted the server resolves it
// from the product (authoritative), so clients cannot tamper with totals.
export const orderItemInput = z
  .object({
    productId: uuid.optional().nullable(),
    // Mongo ObjectId of a legacy product (strangler bridge).
    legacyProductId: z.string().trim().max(64).optional().nullable(),
    productName: z.string().trim().max(200).optional(),
    price: z.coerce.number().min(0).optional(),
    currency: z.string().trim().length(3).optional(),
    quantity: z.coerce.number().int().positive(),
    // Legacy POS client sends a line subtotal; ignored (server recomputes).
    subtotal: z.coerce.number().min(0).optional(),
  })
  .strict();

export const createOrderSchema = z
  .object({
    customerPhone: z.string().trim().max(32).optional().default(''),
    customerName: z.string().trim().max(120).optional().default('Customer'),
    customerEmail: optionalEmail,
    deliveryLocation: z.string().trim().max(300).optional().default(''),
    deliveryPhone: z.string().trim().max(32).optional().default(''),
    source: orderSource.optional().default('whatsapp'),
    items: z.array(orderItemInput).min(1, 'At least one item is required').max(200),
    // Negotiated total (optional). originalTotal is computed server-side.
    offeredTotal: z.coerce.number().min(0).optional(),
    clientRef: z.string().trim().max(120).optional().nullable(),
    recordedBy: z.string().trim().max(120).optional(),
    // Legacy POS client extras. Accepted for compatibility but ignored: totals
    // are server-authoritative, and a cash `source` is persisted as PAID +
    // DELIVERED via the manual-order path.
    total: z.coerce.number().min(0).optional(),
    paymentMethod: z.string().trim().max(60).optional(),
    status: orderStatus.optional(),
  })
  .strict();

// Manual/POS cash order — identical shape, but persisted as PAID + DELIVERED.
export const createManualOrderSchema = createOrderSchema;

export const listOrdersQuery = z
  .object({
    status: orderStatus.optional(),
    source: orderSource.optional(),
    customerPhone: z.string().trim().max(32).optional(),
    period: orderPeriod.optional(),
    from: z.string().trim().optional(),
    to: z.string().trim().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(25),
    cursor: uuid.optional(),
    includeDeleted: z.enum(['true', 'false']).optional(),
  })
  .strict();

export const orderNoteSchema = z.object({ note: z.string().trim().max(500).optional().default('') }).strict();

export const rejectOrderSchema = z.object({ reason: z.string().trim().max(500).optional().default('') }).strict();

export const confirmPaymentSchema = z
  .object({
    method: z.string().trim().max(60).optional().default('manual'),
    reference: z.string().trim().max(120).optional().default('N/A'),
  })
  .strict();

export const orderIdParam = z.object({ id: uuid });
export const orderNumberParam = z.object({ orderNumber: z.string().trim().min(1).max(64) });

export type OrderStatusInput = z.infer<typeof orderStatus>;
export type OrderSourceInput = z.infer<typeof orderSource>;
export type OrderItemInput = z.infer<typeof orderItemInput>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type ListOrdersQuery = z.infer<typeof listOrdersQuery>;
export type OrderNoteInput = z.infer<typeof orderNoteSchema>;
export type RejectOrderInput = z.infer<typeof rejectOrderSchema>;
export type ConfirmPaymentInput = z.infer<typeof confirmPaymentSchema>;
