import { Injectable, NotFoundException } from '@nestjs/common';
import { ListFeatureFlagsQuery, UpsertFeatureFlagInput } from '@uzanite/contracts';
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
