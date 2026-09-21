import { z } from 'zod';
import { uuid } from './common';

// ── Expenses (legacy `/api/expenses`) ────────────────────────────────────────
export const expenseCreateSchema = z
  .object({
    description: z.string().trim().min(1).max(300),
    amount: z.coerce.number().min(0),
    category: z.string().trim().max(80).optional().default('Other'),
    date: z.union([z.coerce.date(), z.literal('')]).optional(),
    // Offline queue idempotency key; ignored (expenses are not idempotent).
    clientRef: z.string().trim().max(120).optional().nullable(),
  })
  .strict();

export const listExpensesQuery = z
  .object({
    period: z.string().trim().max(20).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional().default(100),
    cursor: uuid.optional(),
  })
  .strict();

// ── Purchases (legacy `/api/purchases`) ──────────────────────────────────────
export const purchaseCreateSchema = z
  .object({
    productId: z.union([uuid, z.literal(''), z.null()]).optional(),
    productName: z.string().trim().min(1).max(200),
    quantity: z.coerce.number().int().min(1),
    costPerUnit: z.coerce.number().min(0),
    supplier: z.string().trim().max(160).optional().default(''),
    date: z.union([z.coerce.date(), z.literal('')]).optional(),
    notes: z.string().trim().max(1000).optional().default(''),
    expiryDate: z.union([z.coerce.date(), z.literal(''), z.null()]).optional(),
    clientRef: z.string().trim().max(120).optional().nullable(),
    receiptKey: z.string().trim().max(500).optional().nullable(),
    // Legacy multipart/JSON field; a file upload supersedes it.
    receiptPath: z.string().trim().max(500).optional(),
  })
  .strict();

export const purchaseUpdateSchema = z
  .object({
    productName: z.string().trim().min(1).max(200).optional(),
    quantity: z.coerce.number().int().min(1).optional(),
    costPerUnit: z.coerce.number().min(0).optional(),
    supplier: z.string().trim().max(160).optional(),
    notes: z.string().trim().max(1000).optional(),
    expiryDate: z.union([z.coerce.date(), z.literal(''), z.null()]).optional(),
    date: z.union([z.coerce.date(), z.literal('')]).optional(),
    receiptKey: z.string().trim().max(500).nullable().optional(),
    // `receiptPath: ''` clears the stored receipt (legacy shape).
    receiptPath: z.string().trim().max(500).optional(),
  })
  .strict();

export const listPurchasesQuery = z
  .object({
    period: z.string().trim().max(20).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional().default(100),
    cursor: uuid.optional(),
  })
  .strict();

// ── Debts (legacy `/api/debts`) ──────────────────────────────────────────────
export const debtCreateSchema = z
  .object({
    customerName: z.string().trim().min(1).max(120),
    customerPhone: z.string().trim().max(25).optional().default(''),
    amount: z.coerce.number().min(0),
    description: z.string().trim().max(500).optional().default(''),
    dueDate: z.union([z.coerce.date(), z.literal(''), z.null()]).optional(),
    orderId: z.union([uuid, z.literal(''), z.null()]).optional(),
    notes: z.string().trim().max(1000).optional().default(''),
    // Offline queue idempotency key; ignored (debts are not idempotent).
    clientRef: z.string().trim().max(120).optional().nullable(),
  })
  .strict();

export const debtUpdateSchema = z
  .object({
    customerName: z.string().trim().min(1).max(120).optional(),
    customerPhone: z.string().trim().max(25).optional(),
    amount: z.coerce.number().min(0).optional(),
    description: z.string().trim().max(500).optional(),
    dueDate: z.union([z.coerce.date(), z.literal(''), z.null()]).optional(),
    notes: z.string().trim().max(1000).optional(),
    clientRef: z.string().trim().max(120).optional().nullable(),
  })
  .strict();

export const debtPaySchema = z
  .object({
    paymentAmount: z.coerce.number().positive(),
    notes: z.string().trim().max(1000).optional().default(''),
  })
  .strict();

export const listDebtsQuery = z
  .object({
    status: z.enum(['unpaid', 'partial', 'paid', 'all']).optional().default('all'),
    search: z.string().trim().max(120).optional(),
    period: z.string().trim().max(20).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional().default(100),
    cursor: uuid.optional(),
  })
  .strict();

export type ExpenseCreateInput = z.infer<typeof expenseCreateSchema>;
export type ListExpensesQuery = z.infer<typeof listExpensesQuery>;
export type PurchaseCreateInput = z.infer<typeof purchaseCreateSchema>;
export type PurchaseUpdateInput = z.infer<typeof purchaseUpdateSchema>;
export type ListPurchasesQuery = z.infer<typeof listPurchasesQuery>;
export type DebtCreateInput = z.infer<typeof debtCreateSchema>;
export type DebtUpdateInput = z.infer<typeof debtUpdateSchema>;
export type DebtPayInput = z.infer<typeof debtPaySchema>;
export type ListDebtsQuery = z.infer<typeof listDebtsQuery>;
