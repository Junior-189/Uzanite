import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { workerPrisma } from './prisma-client';
import { OutboxDispatcherService } from './consumers/outbox-dispatcher.service';
import { WorkerErrorTracker } from './error-tracker.service';

const MAX_ATTEMPTS = 5;
const POLL_MS = 10000;
const BATCH = 50;
// A claimed (processing) event is considered abandoned after this lease and is
// returned to `pending` for another worker to pick up.
const LEASE_MS = 5 * 60 * 1000;

/**
 * Polls the transactional outbox and dispatches events to their consumers.
 *
 * Multi-worker safety: events are claimed with `SELECT ... FOR UPDATE SKIP
 * LOCKED` and moved to `processing` before the network/DB work runs, so two
 * replicas never claim the same row. A lease (`locked_at`) recovers events from
 * crashed workers. Database work runs in a system transaction with the RLS
 * bypass GUC; network side effects (SMTP) run only AFTER that transaction
 * commits. Delivery is at-least-once; consumers are idempotent.
 */
@Injectable()
export class OutboxPublisherService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxPublisherService.name);
  private readonly prisma = workerPrisma;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  private dlq: Queue | null = null;

  constructor(
    private readonly dispatcher: OutboxDispatcherService,
    private readonly tracker?: WorkerErrorTracker,
    private readonly config?: ConfigService
  ) {}

  /** Lazily connects the dead-letter queue (only when Redis is configured). */
  private getDlq(): Queue | null {
    if (this.dlq) return this.dlq;
    const url = this.config?.get<string>('REDIS_URL');
    if (!url) return null;
    this.dlq = new Queue('dlq', { connection: new Redis(url, { maxRetriesPerRequest: null }) });
    return this.dlq;
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.prisma.$connect();
    this.timer = setInterval(() => this.tick().catch((e) => this.logger.error(e.message)), POLL_MS);
    this.logger.log('Outbox publisher started');
  }

  /** Runs one poll cycle immediately (used by tests and manual drains). */
  async drainOnce(): Promise<void> {
    await this.tick();
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.recoverStuck();
      const events = await this.claimBatch();
      for (const event of events) {
        await this.process(event.id, event.tenantId, event.type, event.attempts, event.payload as Record<string, unknown>);
      }
    } finally {
      this.running = false;
    }
  }

  /** Return abandoned `processing` rows to `pending` after the lease expires. */
  private async recoverStuck(): Promise<void> {
    const res = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      return tx.outboxEvent.updateMany({
        where: { status: 'processing', lockedAt: { lt: new Date(Date.now() - LEASE_MS) } },
        data: { status: 'pending', lockedAt: null },
      });
    });
    if (res.count > 0) this.logger.warn(`Recovered ${res.count} abandoned outbox event(s)`);
  }

  /**
   * Atomically claim a batch of due pending events with SKIP LOCKED so multiple
   * worker replicas process disjoint sets.
   */
  private async claimBatch() {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      const claimed = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "outbox_events"
        WHERE "status" = 'pending' AND "available_at" <= now()
        ORDER BY "created_at" ASC
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED
      `;
      if (claimed.length === 0) return [];
      const ids = claimed.map((row) => row.id);
      await tx.outboxEvent.updateMany({
        where: { id: { in: ids } },
        data: { status: 'processing', lockedAt: new Date() },
      });
      return tx.outboxEvent.findMany({ where: { id: { in: ids } } });
    });
  }

  private async process(
    id: string,
    tenantId: string | null,
    type: string,
    attempts: number,
    payload: Record<string, unknown>
  ): Promise<void> {
    try {
      // Phase 1 (DB only): run handlers and, when there are no deferred side
      // effects, mark the event published in the same transaction.
      const sideEffects = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
        const fx = await this.dispatcher.dispatch({ id, tenantId, type, payload, attempts }, tx);
        if (fx.length === 0) {
          await tx.outboxEvent.update({ where: { id }, data: { status: 'published', publishedAt: new Date(), lockedAt: null } });
        }
        return fx;
      });

      // Phase 2 (network I/O, no transaction): run deferred effects, then mark
      // published. If an effect throws, the event is retried; DB writes already
      // committed are idempotent.
      if (sideEffects.length > 0) {
        for (const fx of sideEffects) await fx();
        await this.markPublished(id);
      }
    } catch (err) {
      const nextAttempts = attempts + 1;
      const failed = nextAttempts >= MAX_ATTEMPTS;
      this.logger.error(`Outbox event ${id} (${type}) failed (attempt ${nextAttempts}): ${(err as Error).message}`);
      if (failed) {
        this.tracker?.capture(err, { eventId: id, type, tenantId, attempts: nextAttempts });
        // Surface the exhausted event on the operator dead-letter queue so it
        // can be replayed (admin/queues/dead-letters) rather than only logged.
        const dlq = this.getDlq();
        if (dlq) {
          await dlq
            .add('dead-letter', { eventId: id, type, tenantId, error: (err as Error).message }, { removeOnFail: false })
            .catch(() => undefined);
        }
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
        await tx.outboxEvent.update({
          where: { id },
          data: {
            attempts: nextAttempts,
            status: failed ? 'failed' : 'pending',
            lockedAt: null,
            availableAt: new Date(Date.now() + Math.min(2 ** nextAttempts * 1000, 60000)),
          },
        });
      });
    }
  }

  private async markPublished(id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      await tx.outboxEvent.update({ where: { id }, data: { status: 'published', publishedAt: new Date(), lockedAt: null } });
    });
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.prisma.$disconnect();
  }
}
