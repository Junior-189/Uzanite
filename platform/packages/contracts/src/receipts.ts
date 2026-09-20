import { z } from 'zod';
import { uuid } from './common';

export const receiptType = z.enum(['order', 'payment']);

export const listReceiptsQuery = z
  .object({
    type: receiptType.optional(),
    orderId: uuid.optional(),
    paymentId: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(25),
    cursor: uuid.optional(),
  })
  .strict();

export const receiptIdParam = z.object({ id: uuid });
export const orderReceiptParam = z.object({ orderId: uuid });

export type ListReceiptsQuery = z.infer<typeof listReceiptsQuery>;
export type ReceiptTypeInput = z.infer<typeof receiptType>;

// ── Shared receipt payload builder (pure; used by the API and the worker) ────
export interface ReceiptLineItem {
  productName: string;
  quantity: number;
  price: number;
  subtotal: number;
}

export interface ReceiptData {
  receiptNumber: string;
  type: 'order' | 'payment';
  issuedAt: string;
  business: { name: string; phone: string | null; currency: string };
  customer: { name: string; phone: string | null; email: string | null; deliveryLocation: string | null };
  order: {
    id: string;
    number: string;
    status: string;
    createdAt: string;
    items: ReceiptLineItem[];
    total: number;
    currency: string;
    paymentMethod: string | null;
    paymentReference: string | null;
  };
  payment: {
    id: string;
    provider: string;
    method: string;
    reference: string | null;
    amount: number;
    currency: string;
    confirmedAt: string | null;
  } | null;
  totals: { total: number; currency: string };
}

export interface BuildOrderReceiptInput {
  receiptNumber: string;
  business: { name: string; phone?: string | null; currency?: string | null };
  customer: { name?: string | null; phone?: string | null; email?: string | null; deliveryLocation?: string | null };
  order: {
    id: string;
    number: string;
    status: string;
    createdAt: Date | string;
    total: number | string;
    currency?: string | null;
    paymentMethod?: string | null;
    paymentReference?: string | null;
  };
  items: Array<{ productName: string; quantity: number; price: number | string; subtotal: number | string }>;
  payment?: {
    id: string;
    provider: string;
    method: string;
    reference?: string | null;
    amount: number | string;
    currency?: string | null;
    confirmedAt?: Date | string | null;
  } | null;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const toNum = (v: number | string | null | undefined): number => round2(Number(v ?? 0));
const iso = (v: Date | string | null | undefined): string | null => (v ? new Date(v).toISOString() : null);

export function buildReceiptData(input: BuildOrderReceiptInput): ReceiptData {
  const currency = (input.order.currency ?? input.business.currency ?? 'TZS').toUpperCase();
  return {
    receiptNumber: input.receiptNumber,
    type: input.payment ? 'payment' : 'order',
    issuedAt: new Date().toISOString(),
    business: { name: input.business.name, phone: input.business.phone ?? null, currency },
    customer: {
      name: input.customer.name?.trim() || 'Customer',
      phone: input.customer.phone ?? null,
      email: input.customer.email ?? null,
      deliveryLocation: input.customer.deliveryLocation ?? null,
    },
    order: {
      id: input.order.id,
      number: input.order.number,
      status: input.order.status,
      createdAt: iso(input.order.createdAt) ?? new Date().toISOString(),
      items: input.items.map((i) => ({
        productName: i.productName,
        quantity: Number(i.quantity),
        price: toNum(i.price),
        subtotal: toNum(i.subtotal),
      })),
      total: toNum(input.order.total),
      currency,
      paymentMethod: input.order.paymentMethod ?? null,
      paymentReference: input.order.paymentReference ?? null,
    },
    payment: input.payment
      ? {
          id: input.payment.id,
          provider: input.payment.provider,
          method: input.payment.method,
          reference: input.payment.reference ?? null,
          amount: toNum(input.payment.amount),
          currency: (input.payment.currency ?? currency).toUpperCase(),
          confirmedAt: iso(input.payment.confirmedAt),
        }
      : null,
    totals: { total: toNum(input.order.total), currency },
  };
}
