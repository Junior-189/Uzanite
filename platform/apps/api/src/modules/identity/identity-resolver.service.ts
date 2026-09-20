import { Injectable } from '@nestjs/common';
import { IdentityAliasKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UnitOfWorkService } from '../../prisma/unit-of-work.service';
import { newId } from '../../ids/id';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ResolvedUser {
  id: string;
  via: 'uuid' | 'alias' | 'legacy_id';
}
export interface ResolvedTenant {
  id: string;
  via: 'uuid' | 'alias' | 'slug';
}
export interface PrimaryMembership {
  tenantId: string;
  membershipId: string;
  role: string;
  permissions: string[];
}

/**
 * Bridges legacy (Mongo ObjectId / business slug) identities to platform UUIDs.
 *
 * Resolution order for a user claim:
 *   1. a platform UUID that exists in `users` (native NestJS token), else
 *   2. an `identity_aliases` row `(legacy_mongo, kind, externalId)`, else
 *   3. the denormalised `users.legacy_id` column (backward compatibility).
 *
 * All reads run in a system context so they are safe under RLS (memberships and
 * tenants are RLS-protected). The `identity_aliases` table itself is a
 * platform-level lookup (no RLS) because it is read before a tenant exists.
 */
@Injectable()
export class IdentityResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWorkService
  ) {}

  isUuid(value: string | null | undefined): boolean {
    return !!value && UUID_RE.test(value);
  }

  async resolveUserId(payload: {
    sub?: string | null;
    id?: string | null;
    type?: string | null;
  }): Promise<ResolvedUser | null> {
    const raw = payload.sub || payload.id;
    if (!raw) return null;

    return this.uow.runAsSystem(async () => {
      // 1) Native platform UUID.
      if (this.isUuid(raw)) {
        const user = await this.prisma.db.user.findFirst({ where: { id: raw, deletedAt: null }, select: { id: true } });
        if (user) return { id: user.id, via: 'uuid' as const };
      }

      // 2) Explicit alias mapping (Express user or staff ObjectId).
      const kind: IdentityAliasKind = payload.type === 'staff' ? 'staff' : 'user';
      const alias = await this.prisma.db.identityAlias.findFirst({
        where: { provider: 'legacy_mongo', kind, externalId: raw },
        select: { userId: true },
      });
      if (alias?.userId) return { id: alias.userId, via: 'alias' as const };

      // 3) Denormalised legacy_id fallback (staff are stored as `staff:<id>`).
      const candidates = kind === 'staff' ? [`staff:${raw}`, raw] : [raw];
      const legacy = await this.prisma.db.user.findFirst({
        where: { legacyId: { in: candidates }, deletedAt: null },
        select: { id: true },
      });
      if (legacy) return { id: legacy.id, via: 'legacy_id' as const };

      return null;
    });
  }

  async resolveTenantId(value: string | null | undefined): Promise<ResolvedTenant | null> {
    if (!value) return null;
    return this.uow.runAsSystem(async () => {
      if (this.isUuid(value)) {
        const tenant = await this.prisma.db.tenant.findFirst({ where: { id: value, deletedAt: null }, select: { id: true } });
        if (tenant) return { id: tenant.id, via: 'uuid' as const };
      }

      const alias = await this.prisma.db.identityAlias.findFirst({
        where: { provider: 'legacy_mongo', kind: 'tenant', externalId: value },
        select: { tenantId: true },
      });
      if (alias?.tenantId) return { id: alias.tenantId, via: 'alias' as const };

      // Legacy business slug (tenants.slug) or tenant ObjectId (tenants.legacy_id).
      const tenant = await this.prisma.db.tenant.findFirst({
        where: { OR: [{ slug: value }, { legacyId: value }], deletedAt: null },
        select: { id: true },
      });
      if (tenant) return { id: tenant.id, via: 'slug' as const };
      return null;
    });
  }

  /** The tenant a user belongs to when their token carries no tenant claim. */
  async resolvePrimaryMembership(userId: string): Promise<PrimaryMembership | null> {
    return this.uow.runAsSystem(async () => {
      const memberships = await this.prisma.db.membership.findMany({
        where: { userId, status: 'active' },
        select: { id: true, tenantId: true, role: true, permissions: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!memberships.length) return null;
      const priority: Record<string, number> = { owner: 0, manager: 1, staff: 2 };
      const chosen = [...memberships].sort((a, b) => (priority[a.role] ?? 9) - (priority[b.role] ?? 9))[0];
      return {
        tenantId: chosen.tenantId,
        membershipId: chosen.id,
        role: chosen.role,
        permissions: chosen.permissions,
      };
    });
  }

  // ── Mapping writers (backfill / admin) ───────────────────────────────────────
  async linkUser(input: {
    userId: string;
    externalId: string;
    kind?: 'user' | 'staff';
    note?: string;
    createdBy?: string;
  }): Promise<void> {
    const kind = input.kind ?? 'user';
    await this.prisma.base.identityAlias.upsert({
      where: { provider_kind_externalId: { provider: 'legacy_mongo', kind, externalId: input.externalId } },
      update: { userId: input.userId, note: input.note ?? '' },
      create: {
        id: newId(),
        provider: 'legacy_mongo',
        kind,
        externalId: input.externalId,
        userId: input.userId,
        note: input.note ?? '',
        createdBy: input.createdBy ?? null,
      },
    });
  }

  async linkTenant(input: { tenantId: string; externalId: string; note?: string; createdBy?: string }): Promise<void> {
    await this.prisma.base.identityAlias.upsert({
      where: { provider_kind_externalId: { provider: 'legacy_mongo', kind: 'tenant', externalId: input.externalId } },
      update: { tenantId: input.tenantId, note: input.note ?? '' },
      create: {
        id: newId(),
        provider: 'legacy_mongo',
        kind: 'tenant',
        externalId: input.externalId,
        tenantId: input.tenantId,
        note: input.note ?? '',
        createdBy: input.createdBy ?? null,
      },
    });
  }
}
