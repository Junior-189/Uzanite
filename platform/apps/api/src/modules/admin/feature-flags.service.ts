import { Injectable, NotFoundException } from '@nestjs/common';
import {
  FEATURE_FLAGS,
  FEATURE_KEYS,
  FeatureFlagsUpdateInput,
  ListFeatureFlagsQuery,
  UpsertFeatureFlagInput,
} from '@uzanite/contracts';
import { CacheService } from '../../cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { runAsSystem } from '../../context/tenant-context';
import { newId } from '../../ids/id';

/**
 * Feature flag administration.
 *
 * The model shipped in M1 but had no service or controller, so the only way to
 * toggle a flag was a manual DB write — the kind of dead schema that quietly
 * becomes a production incident when someone needs a kill switch in a hurry.
 *
 * Resolution order for a tenant: tenant-scoped row, then the global row, then
 * the supplied default. Flags are cached because a kill switch is worthless if
 * checking it costs a query on every request.
 */
@Injectable()
export class FeatureFlagsService {
  private static readonly CACHE_TTL_SECONDS = 30;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService
  ) {}

  /** Effective value of one flag for a tenant (or globally when tenantId is null). */
  async isEnabled(key: string, tenantId: string | null, fallback = false): Promise<boolean> {
    const flags = await this.effectiveFlags(tenantId);
    return flags[key] ?? fallback;
  }

  /** Every effective flag for a tenant, tenant rows overriding global ones. */
  effectiveFlags(tenantId: string | null): Promise<Record<string, boolean>> {
    return this.cache.wrap(
      'feature_flags',
      `flags:${tenantId ?? 'global'}`,
      FeatureFlagsService.CACHE_TTL_SECONDS,
      () =>
        runAsSystem(async () => {
          const rows = await this.prisma.db.featureFlag.findMany({
            where: tenantId ? { OR: [{ scope: 'global' }, { scope: 'tenant', tenantId }] } : { scope: 'global' },
          });
          const resolved: Record<string, boolean> = {};
          // Global first, then tenant rows overwrite.
          for (const row of rows.filter((r) => r.scope === 'global')) resolved[row.key] = row.enabled;
          for (const row of rows.filter((r) => r.scope === 'tenant')) resolved[row.key] = row.enabled;
          return resolved;
        })
    );
  }

  // ── Legacy keyed-shape administration (admin panel) ────────────────────────

  private defaults(): Record<string, { enabled: boolean; message: string }> {
    return Object.fromEntries(FEATURE_KEYS.map((key) => [key, { enabled: true, message: '' }]));
  }

  private async rowsFor(scope: 'global' | 'tenant', tenantId?: string | null) {
    return runAsSystem(() =>
      this.prisma.db.featureFlag.findMany({
        where: { scope, tenantId: scope === 'tenant' ? tenantId ?? null : null },
      })
    );
  }

  /** Global flags with defaults; every known key is present. */
  async globalMap(): Promise<Record<string, { enabled: boolean; message: string }>> {
    const rows = await this.rowsFor('global');
    const map = this.defaults();
    for (const row of rows) if (FEATURE_KEYS.includes(row.key)) map[row.key] = { enabled: row.enabled, message: row.message };
    return map;
  }

  /** Effective flags for a tenant (global overlaid by tenant overrides). */
  async effectiveWithMessages(tenantId: string | null): Promise<Record<string, { enabled: boolean; message: string }>> {
    const map = await this.globalMap();
    if (tenantId) {
      const rows = await this.rowsFor('tenant', tenantId);
      for (const row of rows) if (FEATURE_KEYS.includes(row.key)) map[row.key] = { enabled: row.enabled, message: row.message };
    }
    return map;
  }

  private async tenantOverrideKeys(tenantId: string): Promise<Set<string>> {
    const rows = await this.rowsFor('tenant', tenantId);
    return new Set(rows.map((r) => r.key));
  }

  private async applyFlags(scope: 'global' | 'tenant', tenantId: string | null, flags: FeatureFlagsUpdateInput['flags']) {
    const known = Object.entries(flags).filter(([key]) => FEATURE_KEYS.includes(key));
    await runAsSystem(async () => {
      for (const [key, entry] of known) {
        const existing = await this.prisma.db.featureFlag.findFirst({
          where: { scope, tenantId: scope === 'tenant' ? tenantId : null, key },
        });
        const data = { enabled: entry.enabled !== false, message: entry.message ?? '' };
        if (existing) {
          await this.prisma.db.featureFlag.update({ where: { id: existing.id }, data });
        } else {
          await this.prisma.db.featureFlag.create({
            data: { id: newId(), scope, tenantId: scope === 'tenant' ? tenantId : null, key, ...data },
          });
        }
      }
    });
    await this.invalidate(scope === 'tenant' ? tenantId : null);
  }

  async listForAdmin(tenantId?: string) {
    if (!tenantId) {
      return { success: true, features: FEATURE_FLAGS, global: await this.globalMap() };
    }
    const overridden = await this.tenantOverrideKeys(tenantId);
    const effective = await this.effectiveWithMessages(tenantId);
    const global = Object.fromEntries(
      Object.entries(effective).map(([key, value]) => [key, { ...value, overridden: overridden.has(key) }])
    );
    return { success: true, features: FEATURE_FLAGS, global };
  }

  async updateGlobal(input: FeatureFlagsUpdateInput) {
    await this.applyFlags('global', null, input.flags);
    return { success: true, message: 'Feature flags updated', global: await this.globalMap() };
  }

  async updateTenant(tenantId: string, input: FeatureFlagsUpdateInput) {
    const tenant = await runAsSystem(() => this.prisma.db.tenant.findFirst({ where: { id: tenantId, deletedAt: null } }));
    if (!tenant) throw new NotFoundException('Tenant not found');
    await this.applyFlags('tenant', tenantId, input.flags);
    const rows = await this.rowsFor('tenant', tenantId);
    const overrides = Object.fromEntries(rows.map((r) => [r.key, { enabled: r.enabled, message: r.message }]));
    return { success: true, message: 'Tenant feature flags updated', overrides };
  }

  async resetTenant(tenantId: string) {
    const tenant = await runAsSystem(() => this.prisma.db.tenant.findFirst({ where: { id: tenantId, deletedAt: null } }));
    if (!tenant) throw new NotFoundException('Tenant not found');
    await runAsSystem(() =>
      this.prisma.db.featureFlag.deleteMany({ where: { scope: 'tenant', tenantId } })
    );
    await this.invalidate(tenantId);
    return { success: true, message: 'Tenant feature flags reset to global defaults' };
  }

  async list(query: ListFeatureFlagsQuery) {
    const flags = await runAsSystem(() =>
      this.prisma.db.featureFlag.findMany({
        where: {
          ...(query.scope ? { scope: query.scope } : {}),
          ...(query.tenantId ? { tenantId: query.tenantId } : {}),
        },
        orderBy: [{ scope: 'asc' }, { key: 'asc' }],
        take: query.limit,
      })
    );
    return { success: true, flags };
  }

  async upsert(input: UpsertFeatureFlagInput) {
    const flag = await runAsSystem(async () => {
      const existing = await this.prisma.db.featureFlag.findFirst({
        where: { scope: input.scope, tenantId: input.tenantId ?? null, key: input.key },
      });
      if (existing) {
        return this.prisma.db.featureFlag.update({
          where: { id: existing.id },
          data: { enabled: input.enabled, message: input.message ?? '' },
        });
      }
      return this.prisma.db.featureFlag.create({
        data: {
          id: newId(),
          scope: input.scope,
          tenantId: input.tenantId ?? null,
          key: input.key,
          enabled: input.enabled,
          message: input.message ?? '',
        },
      });
    });

    await this.invalidate(input.tenantId ?? null);
    return { success: true, flag };
  }

  async remove(id: string) {
    const flag = await runAsSystem(() => this.prisma.db.featureFlag.findFirst({ where: { id } }));
    if (!flag) throw new NotFoundException('Feature flag not found');
    await runAsSystem(() => this.prisma.db.featureFlag.delete({ where: { id } }));
    await this.invalidate(flag.tenantId);
    return { success: true };
  }

  /**
   * A global change affects every tenant's resolved set. We cannot enumerate
   * tenants cheaply, so the short TTL is what bounds staleness there; the
   * global key itself is dropped immediately.
   */
  private async invalidate(tenantId: string | null): Promise<void> {
    await this.cache.del(`flags:${tenantId ?? 'global'}`);
    if (!tenantId) await this.cache.del('flags:global');
  }
}
