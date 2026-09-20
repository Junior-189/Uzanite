import { z } from 'zod';

export const REPORT_KEYS = ['orders', 'products', 'expenses', 'purchases', 'debts', 'staff', 'full'] as const;
export const reportKey = z.enum(REPORT_KEYS);

export const reportKeyParam = z.object({ key: reportKey });

export const reportQuery = z
  .object({
    period: z.string().trim().max(20).optional().default('all'),
    lang: z.enum(['en', 'sw']).optional().default('en'),
  })
  .strict();

export type ReportKey = z.infer<typeof reportKey>;
export type ReportQuery = z.infer<typeof reportQuery>;
