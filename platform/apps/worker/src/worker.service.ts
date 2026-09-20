import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { WhatsAppOutboundService } from './messaging/whatsapp-outbound.service';

// Phase M1: worker skeleton. Real processors (WhatsApp, receipts, email,
// payments, maintenance) are implemented in later migration phases. This proves
// the BullMQ + Redis wiring and graceful shutdown.
@Injectable()
export class WorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerService.name);
  private readonly workers: Worker[] = [];
  private connection: Redis | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly whatsapp: WhatsAppOutboundService
  ) {}

  onApplicationBootstrap(): void {
    const url = this.config.get<string>('REDIS_URL');
    if (!url) {
      this.logger.warn('REDIS_URL not set — worker started in no-op mode');
      return;
    }
    this.connection = new Redis(url, { maxRetriesPerRequest: null });

    const queues = ['maintenance', 'email', 'whatsapp-outbound', 'receipts', 'payments', 'broadcast'];
    for (const name of queues) {
      const worker = new Worker(
        name,
        async (job) => {
          // Low-latency path: the DB queue is the source of truth; this is a
          // wake-up so a freshly enqueued WhatsApp message is sent immediately.
          if (name === 'whatsapp-outbound' && job.data?.messageId) {
            return this.whatsapp.sendOne(String(job.data.messageId));
          }
          this.logger.log(`Processing ${name}:${job.name} (id=${job.id})`);
          return { ok: true };
        },
        { connection: this.connection, concurrency: name === 'broadcast' ? 2 : 5 }
      );
      worker.on('failed', (job, err) =>
        this.logger.error(`Job ${name}:${job?.name} failed: ${err.message}`)
      );
      this.workers.push(worker);
    }
    this.logger.log(`Worker started for queues: ${queues.join(', ')}`);
  }

  async onApplicationShutdown(): Promise<void> {
    for (const w of this.workers) {
      try {
        await w.close();
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
