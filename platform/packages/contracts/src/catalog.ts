import { z } from 'zod';
import { uuid } from './common';

export const createProductSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().max(2000).optional().default(''),
    barcode: z.string().trim().max(64).optional().nullable(),
    price: z.coerce.number().min(0),
    minPrice: z.coerce.number().min(0).optional().default(0),
    cost: z.coerce.number().min(0).optional().default(0),
    currency: z.string().trim().length(3).optional().default('TZS'),
    stock: z.coerce.number().int().min(0).optional().default(0),
    lowStockThreshold: z.coerce.number().int().min(0).optional().default(5),
    expiryDate: z.string().trim().optional().nullable(),
    expiryWarnDays: z.coerce.number().int().min(0).optional().default(7),
    imageKey: z.string().max(500).optional().nullable(),
    // Optional link to a tenant category. Validated against the tenant's own
    // categories in ProductsService, so it cannot reference another tenant's row.
    categoryId: uuid.optional().nullable(),
    recordedBy: z.string().trim().max(120).optional(),
  })
  .strict();

// `stock` is intentionally excluded — it must change only via the stock service.
export const updateProductSchema = createProductSchema
  .partial()
  .omit({ stock: true })
  .extend({
    version: z.coerce.number().int().min(0).optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const restockSchema = z
  .object({
    quantity: z.coerce.number().int().positive(),
    expiryDate: z.string().trim().optional().nullable(),
    note: z.string().max(500).optional(),
    clientRef: z.string().max(120).optional(),
  })
  .strict();

export const adjustStockSchema = z
  .object({
    delta: z.coerce.number().int().refine((v) => v !== 0, 'delta must be non-zero'),
    note: z.string().max(500).optional(),
    clientRef: z.string().max(120).optional(),
  })
  .strict();

export const listProductsQuery = z
  .object({
    active: z.enum(['true', 'false']).optional(),
    search: z.string().trim().max(120).optional(),
    barcode: z.string().trim().max(64).optional(),
    categoryId: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(25),
    cursor: uuid.optional(),
  })
  .strict();

export const productIdParam = z.object({ id: uuid });

export const createCategorySchema = z.object({ name: z.string().trim().min(1).max(80) }).strict();

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type RestockInput = z.infer<typeof restockSchema>;
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuery>;
