import { Injectable } from '@nestjs/common';
import { NotificationPriority, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

export interface CreateNotificationInput {
  tenantId: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  priority?: NotificationPriority;
  dedupeKey?: string;
}

/**
 * Idempotent writer for tenant-scoped in-app notifications. A replay of the
 * same logical event (same dedupeKey) is a no-op thanks to the unique
 * (tenant_id, dedupe_key) index.
 */
@Injectable()
export class NotificationWriter {
  async create(tx: Prisma.TransactionClient, input: CreateNotificationInput): Promise<boolean> {
    // `skipDuplicates` emits ON CONFLICT DO NOTHING: a replay is a no-op and,
    // unlike catching P2002, it does NOT abort the surrounding transaction.
    const res = await tx.notification.createMany({
      data: [
        {
          id: randomUUID(),
          tenantId: input.tenantId,
          type: input.type,
          title: input.title,
          message: input.message,
          data: (input.data ?? {}) as object,
          priority: input.priority ?? 'normal',
          dedupeKey: input.dedupeKey ?? null,
        },
      ],
      skipDuplicates: true,
    });
    return res.count > 0;
  }
}
