import { z } from 'zod';
import { orderPeriod } from './commerce';

export const dashboardQuery = z
  .object({
    period: orderPeriod.optional().default('monthly'),
  })
  .strict();

export type DashboardQuery = z.infer<typeof dashboardQuery>;
