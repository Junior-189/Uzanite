import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

export const QUEUES = [
  'whatsapp-outbound',
  'broadcast',
  'receipts',
  'email',
  'payments',
  'maintenance',
  'dlq',
] as const;

export type QueueName = (typeof QUEUES)[number];

// Thin wrapper over BullMQ. When REDIS_URL is unset, jobs are logged and
// dropped (M1 has no in-process job runner; the worker app handles real work).
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly connection: Redis | null;
  private readonly queues = new Map<string, Queue>();

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL');
    this.connection = url ? new Redis(url, { maxRetriesPerRequest: null }) : null;
  }

  private getQueue(name: QueueName): Queue | null {
    if (!this.connection) return null;
    if (!this.queues.has(name)) {
      this.queues.set(name, new Queue(name, { connection: this.connection }));
    }
    return this.queues.get(name) as Queue;
  }

  async add(name: QueueName, job: string, data: Record<string, unknown>, opts: Record<string, unknown> = {}): Promise<void> {
    const queue = this.getQueue(name);
    if (!queue) {
      this.logger.warn(`REDIS_URL not set — dropping job ${name}:${job}`);
      return;
    }
    await queue.add(job, data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: false,
      ...opts,
    });
  }

  async onModuleDestroy(): Promise<void> {
    for (const q of this.queues.values()) {
      try {
        await q.close();
      } catch {
        /* ignore */
      }
    }
    if (this.connection) {
      try {
        await this.connection.quit();
      } catch {
        /* ignore */
      }
    }
  }
}
