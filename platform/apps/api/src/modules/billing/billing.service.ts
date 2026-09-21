import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import {
  DEFAULT_PLAN_KEY,
  LIMIT_METRIC_PERIOD,
  LimitMetric,
  PLAN_FEATURES,
  PlanFeature,
  isKnownLimitMetric,
  isKnownPlanFeature,
  planByKey,
} from '@uzanite/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { UnitOfWorkService } from '../../prisma/unit-of-work.service';
import { CacheService } from '../../cache/cache.service';
import { getDb } from '../../context/tenant-context';
import { newId } from '../../ids/id';

export interface BillingStatus {
  plan: string;
  planName: string;
  status: string;
  trialEndsAt: Date | null;
  limits: Record<string, number>;
  features: Record<string, boolean>;
  periodKey: string;
  usage: Record<string, number>;
}

export interface LimitCheck {
  allowed: boolean;
  current: number;
  limit: number;
  metric: string;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly cacheTtl: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWorkService,
    private readonly cache: CacheService,
    config: ConfigService
  ) {
    this.cacheTtl = config.get<number>('CACHE_BILLING_TTL') ?? 60;
  }

  private periodKey(date = new Date()): string {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Live count for a `lifetime` metric, read from the table of record rather
   * than a counter. Counters drift (a deleted product would never free
   * allowance); counting rows cannot.
   */
  private async lifetimeUsage(client: PrismaClient, tenantId: string, metric: LimitMetric): Promise<number> {
    switch (metric) {
      case 'products':
        return client.product.count({ where: { tenantId, deletedAt: null } });
      case 'staff':
        return client.membership.count({ where: { tenantId, status: 'active' } });
      default:
        return 0;
    }
  }

  private async readStatus(client: PrismaClient, tenantId: string): Promise<BillingStatus> {
    const sub = await client.subscription.findFirst({ where: { tenantId }, include: { plan: true } });
    const planKey = sub?.planKey ?? DEFAULT_PLAN_KEY;
    const dbPlan = sub?.plan ?? (await client.plan.findUnique({ where: { key: planKey } }));
    const catalogue = planByKey(planKey) ?? planByKey(DEFAULT_PLAN_KEY);
    const periodKey = this.periodKey();

    // Plan rows are seeded from the catalogue, but the catalogue is the
    // authority: a DB row missing a newly-added metric or feature must not
    // silently grant it.
    const limits: Record<string, number> = { ...(catalogue?.limits ?? {}) };
    for (const [key, value] of Object.entries((dbPlan?.limits as Record<string, number>) ?? {})) {
      if (isKnownLimitMetric(key) && typeof value === 'number') limits[key] = value;
    }

    const features: Record<string, boolean> = {};
    for (const feature of PLAN_FEATURES) features[feature] = catalogue?.features[feature] ?? false;
    for (const [key, value] of Object.entries((dbPlan?.features as Record<string, boolean>) ?? {})) {
      if (isKnownPlanFeature(key) && typeof value === 'boolean') features[key] = value;
    }

    // Monthly metrics come from this period's counter only (reading every
    // period and letting the last row win was the original bug). Lifetime
    // metrics are counted live.
    const counters = await client.usageCounter.findMany({ where: { tenantId, periodKey } });
    const usage: Record<string, number> = {};
    for (const c of counters) {
      if (isKnownLimitMetric(c.metric) && LIMIT_METRIC_PERIOD[c.metric] === 'monthly') {
        usage[c.metric] = Number(c.count);
      }
    }
    for (const [metric, period] of Object.entries(LIMIT_METRIC_PERIOD)) {
      if (period === 'lifetime') {
        usage[metric] = await this.lifetimeUsage(client, tenantId, metric as LimitMetric);
      } else if (usage[metric] === undefined) {
        usage[metric] = 0;
      }
    }

    return {
      plan: planKey,
      planName: dbPlan?.name ?? catalogue?.name ?? 'Free',
      status: sub?.status ?? 'active',
      trialEndsAt: sub?.trialEndsAt ?? null,
      limits,
      features,
      periodKey,
      usage,
    };
  }

  /** Read inside the request transaction (tenant RLS GUC or extension context). */
  getStatus(tenantId: string): Promise<BillingStatus> {
    return this.readStatus(this.prisma.db, tenantId);
  }

  /**
   * Guard-safe read: works both before the request interceptor (guard context,
   * no transaction) and from inside a service that already holds one.
   *
   * REUSING AN AMBIENT TRANSACTION IS LOAD-BEARING. `runAsSystem` opens a new
   * transaction on a *second* connection. Since this read now counts live rows
   * in `products` and `memberships` for the lifetime metrics, opening a second
   * transaction while the caller holds locks on those same rows makes the two
   * connections wait on each other — which, with `lock_timeout` set, surfaces
   * as an intermittent failure rather than a hang. Reading through the caller's
   * own transaction avoids that entirely, and is also more correct for a limit
   * check: it sees what the caller is about to commit.
   *
   * Cached, because this runs on every plan-guarded route.
   */
  async getStatusForGuard(tenantId: string): Promise<BillingStatus> {
    const readInAmbientOrSystemTx = () =>
      getDb() ? this.readStatus(this.prisma.db, tenantId) : this.uow.runAsSystem(() => this.readStatus(this.prisma.db, tenantId));

    return this.cache.wrap(
      'billing',
      `billing:status:${tenantId}`,
      this.cacheTtl,
      readInAmbientOrSystemTx,
      // Dates do not survive JSON, so revive the one date field on read.
      (raw) => ({ ...raw, trialEndsAt: raw.trialEndsAt ? new Date(raw.trialEndsAt as unknown as string) : null })
    );
  }

  /** Drop the cached entitlement snapshot (plan change, usage increment). */
  invalidate(tenantId: string): Promise<void> {
    return this.cache.del(`billing:status:${tenantId}`);
  }

  /**
   * Fails CLOSED: an unknown feature is denied rather than granted. Adding a
   * feature to the code without declaring it in the catalogue now blocks it
   * everywhere instead of silently enabling it for every tenant.
   */
  hasFeature(status: BillingStatus, feature: string): boolean {
    if (!isKnownPlanFeature(feature)) {
      this.logger.error(`Unknown plan feature "${feature}" requested — denying. Add it to PLAN_FEATURES.`);
      return false;
    }
    return status.features?.[feature as PlanFeature] === true;
  }

  /**
   * Fails CLOSED on an unknown metric. A metric with no limit in the plan is
   * treated as unlimited only when the plan explicitly says -1.
   */
  async checkLimit(tenantId: string, metric: string): Promise<LimitCheck> {
    if (!isKnownLimitMetric(metric)) {
      this.logger.error(`Unknown limit metric "${metric}" requested — denying. Add it to LIMIT_METRICS.`);
      return { allowed: false, current: 0, limit: 0, metric };
    }
    const status = await this.getStatusForGuard(tenantId);
    const limit = status.limits?.[metric];
    if (limit === undefined) {
      this.logger.error(`Plan "${status.plan}" has no limit for "${metric}" — denying.`);
      return { allowed: false, current: 0, limit: 0, metric };
    }
    if (limit === -1) return { allowed: true, current: status.usage?.[metric] ?? 0, limit: -1, metric };
    const current = status.usage?.[metric] ?? 0;
    return { allowed: current < limit, current, limit, metric };
  }

  /**
   * Service-level entitlement guard. HTTP `@EnforceLimit` only protects routes;
   * flows (WhatsApp) and bulk endpoints reach services directly. `willAdd`
   * lets callers reserve N rows at once (e.g. CSV import).
   */
  async assertLimit(tenantId: string, metric: string, willAdd = 1): Promise<void> {
    const check = await this.checkLimit(tenantId, metric);
    if (check.limit === -1) return;
    if (check.current + willAdd > check.limit) {
      throw new ConflictException(
        `Your plan allows ${check.limit} ${metric} and you already have ${check.current}. Upgrade to add more.`
      );
    }
  }

  /**
   * Atomic monthly counter increment. The previous read-then-create raced the
   * `(tenant_id, metric, period_key)` unique index, so two concurrent orders at
   * a period boundary produced a duplicate-key 500.
   */
  async incrementUsage(tenantId: string, metric: string, by = 1): Promise<void> {
    if (!isKnownLimitMetric(metric)) {
      this.logger.error(`Refusing to increment unknown metric "${metric}"`);
      return;
    }
    if (LIMIT_METRIC_PERIOD[metric] === 'lifetime') return; // counted live

    const periodKey = this.periodKey();
    await this.prisma.db.usageCounter.upsert({
      where: { tenantId_metric_periodKey: { tenantId, metric, periodKey } },
      create: { id: newId(), tenantId, metric, periodKey, count: by },
      update: { count: { increment: by } },
    });
    await this.invalidate(tenantId);
  }

  listPlans() {
    return this.prisma.base.plan.findMany({ where: { active: true }, orderBy: { priceTzs: 'asc' } });
  }
}
