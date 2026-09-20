import { z } from 'zod';
import { uuid } from './common';

export const notificationPriority = z.enum(['low', 'normal', 'high', 'critical']);

export const listNotificationsQuery = z
  .object({
    read: z.enum(['true', 'false']).optional(),
    type: z.string().trim().max(60).optional(),
    includeDeleted: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(25),
    cursor: uuid.optional(),
  })
  .strict();

export const notificationIdParam = z.object({ id: uuid });

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuery>;
export type NotificationPriorityInput = z.infer<typeof notificationPriority>;
