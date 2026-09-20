import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { NotificationWriter } from './consumers/notification-writer.service';

/**
 * Periodic double-entry reconciliation. Scans for journals whose debits and
 * credits do not balance and raises a critical operator notification per tenant
 * (daily-deduped) so an unbalanced ledger is never silently ignored.
 */
@Injectable()
export class ReconciliationService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ReconciliationService.name);
  private readonly prisma = new PrismaClient();
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    config: ConfigService,
    private readonly notifications: NotificationWriter
  ) {
    const configured = Number(config.get<string>('RECONCILE_INTERVAL_MS') ?? '');
    this.intervalMs = Number.isFinite(configured) && configured > 0 ? configured : 15 * 60 * 1000;
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.prisma.$connect();
    this.timer = setInterval(() => void this.runOnce().catch((e) => this.logger.error(e.message)), this.intervalMs);
    this.logger.log(`Ledger reconciliation scheduled every ${Math.round(this.intervalMs / 1000)}s`);
  }

  /** Runs one reconciliation pass (used by tests and manual triggers). */
  async runOnce(): Promise<{ unbalancedTenants: number; unbalancedJournals: number }> {
    if (this.running) return { unbalancedTenants: 0, unbalancedJournals: 0 };
    this.running = true;
    try {
      const rows = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
        return tx.$queryRaw<Array<{ tenant_id: string; unbalanced: number }>>`
          SELECT t."tenant_id", count(*)::int AS unbalanced
          FROM (
            SELECT j."tenant_id", j."id"
            FROM "journal_entries" j
            JOIN "journal_lines" l ON l."journal_id" = j."id"
            GROUP BY j."tenant_id", j.id
            HAVING sum(CASE WHEN l."direction" = 'debit' THEN l."amount" ELSE 0 END)
                 <> sum(CASE WHEN l."direction" = 'credit' THEN l."amount" ELSE 0 END)
          ) t
          GROUP BY t."tenant_id"
        `;
      });

      let journals = 0;
      const day = new Date().toISOString().slice(0, 10);
      for (const row of rows) {
        const unbalanced = Number(row.unbalanced);
        journals += unbalanced;
        await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
          await this.notifications.create(tx, {
            tenantId: row.tenant_id,
            type: 'ledger_unbalanced',
            title: 'Ledger reconciliation failed',
            message: `${unbalanced} unbalanced journal(s) detected. Investigate immediately.`,
            data: { unbalanced },
            priority: 'critical',
            dedupeKey: `ledger.unbalanced:${row.tenant_id}:${day}`,
          });
        });
        this.logger.error(`Unbalanced journals for tenant ${row.tenant_id}: ${unbalanced}`);
      }
      if (rows.length === 0) this.logger.debug('Ledger reconciliation OK (no unbalanced journals)');
      return { unbalancedTenants: rows.length, unbalancedJournals: journals };
    } finally {
      this.running = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.prisma.$disconnect();
  }
}
