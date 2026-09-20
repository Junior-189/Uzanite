import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UnitOfWorkService } from '../prisma/unit-of-work.service';
import { MetricsService } from '../metrics/metrics.service';

/**
 * Business/operational gauges computed at scrape time and appended to the
 * Prometheus `/metrics` output. Runs in a system context so it can count
 * tenant-scoped rows (RLS bypass) without a tenant.
 */
@Injectable()
export class OperationalMetricsService {
  private readonly logger = new Logger(OperationalMetricsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWorkService,
    private readonly metrics: MetricsService
  ) {}

  /**
   * Connection-pool gauges from Prisma's own metrics.
   *
   * Pool saturation is the first real ceiling this system will hit under load,
   * and it used to be invisible: a request queued waiting for a connection and
   * a genuinely slow query look identical from the outside. `busy` approaching
   * `open`, with a non-zero `wait_count`, is the signal to raise
   * `connection_limit` or add PgBouncer.
   */
  private async collectPoolMetrics(): Promise<void> {
    try {
      const raw = await this.prisma.base.$metrics.json();
      const interesting: Record<string, string> = {
        prisma_pool_connections_open: 'open',
        prisma_pool_connections_busy: 'busy',
        prisma_pool_connections_idle: 'idle',
        prisma_pool_connections_opened_total: 'opened_total',
        prisma_client_queries_active: 'queries_active',
        prisma_client_queries_wait: 'queries_waiting',
      };

      for (const gauge of [...raw.gauges, ...raw.counters]) {
        const label = interesting[gauge.key];
        if (label) this.metrics.setDbPool(label, Number(gauge.value ?? 0));
      }
    } catch (err) {
      // Metrics must never break a scrape.
      this.logger.debug(`Pool metrics unavailable: ${(err as Error).message}`);
    }
  }

  async collect(): Promise<string> {
    await this.collectPoolMetrics();
    try {
      return await this.uow.runAsSystem(async () => {
        const [outboxByStatus, messageByStatus, operatorActions, oldestPending] = await Promise.all([
          this.prisma.db.outboxEvent.groupBy({ by: ['status'], _count: { _all: true } }),
          this.prisma.db.message.groupBy({
            by: ['status'],
            where: { direction: 'outbound' },
            _count: { _all: true },
          }),
          this.prisma.db.notification.count({
            where: { type: 'payment_awaiting_order_approval', read: false, deletedAt: null },
          }),
          this.prisma.db.outboxEvent.findFirst({
            where: { status: 'pending' },
            orderBy: { createdAt: 'asc' },
            select: { createdAt: true },
          }),
        ]);

        const lines: string[] = [];
        lines.push('# HELP uzanite_outbox_events Outbox events by status');
        lines.push('# TYPE uzanite_outbox_events gauge');
        for (const row of outboxByStatus) {
          lines.push(`uzanite_outbox_events{status="${row.status}"} ${row._count._all}`);
        }

        lines.push('# HELP uzanite_whatsapp_messages Outbound WhatsApp messages by status');
        lines.push('# TYPE uzanite_whatsapp_messages gauge');
        for (const row of messageByStatus) {
          lines.push(`uzanite_whatsapp_messages{status="${row.status}"} ${row._count._all}`);
        }

        lines.push('# HELP uzanite_operator_actions_unread Unread operator-action notifications');
        lines.push('# TYPE uzanite_operator_actions_unread gauge');
        lines.push(`uzanite_operator_actions_unread{type="payment_awaiting_order_approval"} ${operatorActions}`);

        const ageSeconds = oldestPending
          ? Math.max(0, Math.round((Date.now() - new Date(oldestPending.createdAt).getTime()) / 1000))
          : 0;
        lines.push('# HELP uzanite_outbox_oldest_pending_seconds Age of the oldest pending outbox event');
        lines.push('# TYPE uzanite_outbox_oldest_pending_seconds gauge');
        lines.push(`uzanite_outbox_oldest_pending_seconds ${ageSeconds}`);

        return lines.join('\n');
      });
    } catch (err) {
      // Metrics must never break the scrape; log and omit the operational block.
      this.logger.warn(`Operational metrics unavailable: ${(err as Error).message}`);
      return '';
    }
  }
}
