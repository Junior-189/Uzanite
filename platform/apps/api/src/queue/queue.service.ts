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

  /** Per-queue job counts for operator observability (legacy `/admin/queues`). */
  async stats(): Promise<{ redis: boolean; queues: Record<string, unknown> }> {
    if (!this.connection) return { redis: false, queues: {} };
    const entries = await Promise.all(
      QUEUES.map(async (name) => {
        const queue = this.getQueue(name);
        const counts = queue ? await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed') : {};
        return [name, counts] as const;
      })
    );
    return { redis: true, queues: Object.fromEntries(entries) };
  }

  /** Recent dead-lettered jobs (the `dlq` queue). */
  async deadLetters(limit = 50): Promise<Array<Record<string, unknown>>> {
    if (!this.connection) return [];
    const queue = this.getQueue('dlq');
    if (!queue) return [];
    const jobs = await queue.getJobs(['waiting', 'failed', 'delayed'], 0, Math.max(0, limit - 1), false);
    return jobs.map((job) => ({
      id: job.id,
      name: job.name,
      data: job.data,
      failedReason: job.failedReason,
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
    }));
  }

  /** Fetch a dead-letter job (for admin replay). */
  async getDeadLetter(id: string): Promise<{ id: string; data: Record<string, unknown> } | null> {
    if (!this.connection) return null;
    const queue = this.getQueue('dlq');
    const job = queue ? await queue.getJob(id) : null;
    if (!job) return null;
    return { id: String(job.id), data: (job.data ?? {}) as Record<string, unknown> };
  }

  /** Remove a dead-letter job after it has been replayed. */
  async removeDeadLetter(id: string): Promise<void> {
    if (!this.connection) return;
    const queue = this.getQueue('dlq');
    const job = queue ? await queue.getJob(id) : null;
    if (job) await job.remove();
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
