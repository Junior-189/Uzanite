import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

/**
 * Data retention sweep.
 *
 * Two reasons this exists:
 *
 *  1. **Compliance.** Tanzania's Personal Data Protection Act expects personal
 *     data to be kept only as long as it is needed. "We keep everything
 *     forever" is not a retention policy, and it was the de facto position
 *     before this: nothing was ever deleted, and there was no schedule to point
 *     an auditor at.
 *
 *  2. **Operational cost and performance.** Flow traces and webhook events are
 *     high-volume diagnostic records. Left unbounded they grow without limit,
 *     inflate every backup, and slowly degrade the indexes around them.
 *
 * What it deliberately does NOT touch: orders, payments, refunds, ledger
 * entries, journals and receipts. Those are financial records a business is
 * required to retain, and the ledger tables are append-only at the database
 * level anyway — a DELETE would be rejected by a trigger. Customer PII inside
 * those records is handled by the erasure endpoint, which pseudonymises rather
 * than deletes (see PrivacyService).
 *
 * Every sweep is bounded (`DELETE ... WHERE id IN (SELECT ... LIMIT n)`) so a
 * first run against a large table cannot hold long locks or blow up the WAL.
 */
@Injectable()
export class RetentionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RetentionService.name);
  private readonly prisma = new PrismaClient();
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly policy: Array<{ table: string; column: string; days: number; label: string }>;
  private readonly messageDays: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(config: ConfigService) {
    const interval = Number(config.get<string>('RETENTION_INTERVAL_MS') ?? '');
    // Daily by default: retention is not urgent, and a frequent sweep is just
    // load for no benefit.
    this.intervalMs = Number.isFinite(interval) && interval > 0 ? interval : 24 * 60 * 60 * 1000;

    const batch = Number(config.get<string>('RETENTION_BATCH_SIZE') ?? '');
    this.batchSize = Number.isFinite(batch) && batch > 0 ? batch : 5000;

    const days = (key: string, fallback: number): number => {
      const raw = Number(config.get<string>(key) ?? '');
      return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
    };

    // 0 disables an individual sweep.
    this.policy = [
      {
        table: 'flow_traces',
        column: 'created_at',
        days: days('RETENTION_FLOW_TRACE_DAYS', 90),
        label: 'conversation flow traces (diagnostic)',
      },
      {
        table: 'webhook_events',
        column: 'created_at',
        days: days('RETENTION_WEBHOOK_EVENT_DAYS', 30),
        label: 'provider webhook events (dedupe window)',
      },
      {
        table: 'login_attempts',
        column: 'created_at',
        days: days('RETENTION_LOGIN_ATTEMPT_DAYS', 90),
        label: 'login attempts (contains IP addresses)',
      },
      {
        table: 'activity_logs',
        column: 'created_at',
        days: days('RETENTION_ACTIVITY_LOG_DAYS', 365),
        label: 'activity/audit logs',
      },
    ];

    // Message bodies are personal data. Redacted (not deleted) so delivery
    // history stays intact. 0 disables (opt-in for existing deployments).
    this.messageDays = days('RETENTION_MESSAGE_DAYS', 0);
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.prisma.$connect();
    this.timer = setInterval(
      () => void this.runOnce().catch((e) => this.logger.error(`Retention sweep failed: ${e.message}`)),
      this.intervalMs
    );
    const summary = this.policy
      .filter((p) => p.days > 0)
      .map((p) => `${p.table}=${p.days}d`)
      .join(' ');
    this.logger.log(`Retention sweep scheduled every ${Math.round(this.intervalMs / 1000)}s (${summary})`);
  }

  /** Runs one retention pass. Exposed for tests and manual triggers. */
  async runOnce(): Promise<Record<string, number>> {
    if (this.running) return {};
    this.running = true;
    const deleted: Record<string, number> = {};

    try {
      for (const rule of this.policy) {
        if (rule.days <= 0) continue;

        let removedForTable = 0;
        // Loop in batches until a pass deletes nothing, so the first run on a
        // large table makes progress without one enormous statement.
        for (;;) {
          const count = await this.deleteBatch(rule.table, rule.column, rule.days);
          removedForTable += count;
          if (count < this.batchSize) break;
        }

        if (removedForTable > 0) {
          deleted[rule.table] = removedForTable;
          this.logger.log(`Retention: removed ${removedForTable} row(s) from ${rule.table} — ${rule.label}`);
        }
      }

      if (this.messageDays > 0) {
        let redacted = 0;
        for (;;) {
          const count = await this.redactMessageBatch(this.messageDays);
          redacted += count;
          if (count < this.batchSize) break;
        }
        if (redacted > 0) {
          deleted.messages_redacted = redacted;
          this.logger.log(`Retention: redacted ${redacted} message body(ies) older than ${this.messageDays}d`);
        }
      }

      if (Object.keys(deleted).length === 0) {
        this.logger.debug('Retention sweep: nothing past its retention period');
      }
      return deleted;
    } finally {
      this.running = false;
    }
  }

  /**
   * Deletes one bounded batch.
   *
   * Table and column names come only from the hard-coded policy above, never
   * from input, and the numeric values are coerced — so the interpolation here
   * cannot carry injected SQL. The cutoff and limit are passed as parameters.
   */
  private async deleteBatch(table: string, column: string, days: number): Promise<number> {
    const safeTable = table.replace(/[^a-z_]/g, '');
    const safeColumn = column.replace(/[^a-z_]/g, '');
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    return this.prisma.$transaction(async (tx) => {
      // The sweep spans all tenants, so it runs in a system (RLS bypass)
      // context — the same pattern the outbox publisher uses.
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      return tx.$executeRawUnsafe(
        `DELETE FROM "${safeTable}"
         WHERE ctid IN (
           SELECT ctid FROM "${safeTable}"
           WHERE "${safeColumn}" < $1
           LIMIT $2
         )`,
        cutoff,
        this.batchSize
      );
    });
  }

  /** Pseudonymises old message bodies/payloads (keeps delivery metadata). */
  private async redactMessageBatch(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      return tx.$executeRawUnsafe(
        `UPDATE "messages" SET "text" = '[redacted]', "raw" = '{}'::jsonb
         WHERE ctid IN (
           SELECT ctid FROM "messages"
           WHERE "created_at" < $1 AND "text" <> '[redacted]'
           LIMIT $2
         )`,
        cutoff,
        this.batchSize
      );
    });
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.prisma.$disconnect();
  }
}
