import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { newId } from '../ids/id';

export interface OutboxMessage {
  type: string;
  payload: Record<string, unknown>;
  tenantId?: string | null;
}

/**
 * Transactional outbox writer. Call `enqueue` inside the same transaction as the
 * state change (the unit-of-work makes this the request transaction); the worker
 * publishes pending events after commit.
 */
@Injectable()
export class OutboxService {
  constructor(private readonly prisma: PrismaService) {}

  async enqueue(message: OutboxMessage): Promise<void> {
    await this.prisma.db.outboxEvent.create({
      data: {
        id: newId(),
        tenantId: message.tenantId ?? null,
        type: message.type,
        payload: message.payload as object,
      },
    });
  }
}
