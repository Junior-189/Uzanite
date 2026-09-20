import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ListTenantsQuery, SetPlanInput } from '@uzanite/contracts';
import { CacheService } from '../../cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { runAsSystem } from '../../context/tenant-context';
import { paginate } from '../../pagination/pagination';
import { TokenService } from '../../security/token.service';
import { newId } from '../../ids/id';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService,
    private readonly cache: CacheService
  ) {}

  async listTenants(query: ListTenantsQuery) {
    const where: Record<string, unknown> = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { slug: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const page = await paginate<{ id: string }>({
      findMany: (args) => this.prisma.db.tenant.findMany(args as never) as Promise<{ id: string }[]>,
      where,
      limit: query.limit,
      cursor: query.cursor,
    });
    return { success: true, tenants: page.items, nextCursor: page.nextCursor };
  }

  async listUsers(tenantId: string) {
    return runAsSystem(async () => {
      const memberships = await this.prisma.db.membership.findMany({
        where: { tenantId },
        include: { user: { select: { id: true, name: true, email: true, status: true, platformRole: true } } },
        orderBy: { createdAt: 'asc' },
      });
      return { success: true, memberships };
    });
  }

  private async findTenant(tenantId: string) {
    const tenant = await this.prisma.db.tenant.findFirst({ where: { id: tenantId, deletedAt: null } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async approve(tenantId: string) {
    await this.findTenant(tenantId);
    await runAsSystem(async () => {
      await this.prisma.db.tenant.update({ where: { id: tenantId }, data: { status: 'approved' } });
      const owner = await this.prisma.db.membership.findFirst({ where: { tenantId, role: 'owner' } });
      if (owner) await this.prisma.db.user.update({ where: { id: owner.userId }, data: { status: 'active' } });
    });
    await this.cache.invalidateTenant(tenantId);
    return { success: true, message: 'Tenant approved' };
  }

  async reject(tenantId: string, reason: string) {
    await this.findTenant(tenantId);
    await runAsSystem(async () => {
      await this.prisma.db.tenant.update({ where: { id: tenantId }, data: { status: 'rejected' } });
      const owner = await this.prisma.db.membership.findFirst({ where: { tenantId, role: 'owner' } });
      if (owner) await this.prisma.db.user.update({ where: { id: owner.userId }, data: { status: 'rejected' } });
    });
    await this.cache.invalidateTenant(tenantId);
    return { success: true, message: 'Tenant rejected', reason };
  }

  async setSuspended(tenantId: string, suspended: boolean) {
    await this.findTenant(tenantId);
    await this.prisma.db.tenant.update({
      where: { id: tenantId },
      data: { status: suspended ? 'suspended' : 'approved' },
    });
    // Suspension must take effect immediately, not after the cache TTL.
    await this.cache.invalidateTenant(tenantId);
    return { success: true, suspended };
  }

  async setPlan(tenantId: string, input: SetPlanInput) {
    await this.findTenant(tenantId);
    const data = {
      planKey: input.plan,
      status: (input.subscriptionStatus ?? 'active') as never,
      trialEndsAt: input.trialEndsAt ? new Date(input.trialEndsAt) : null,
      currentPeriodEnd: input.currentPeriodEnd ? new Date(input.currentPeriodEnd) : null,
    };
    await runAsSystem(async () => {
      const existing = await this.prisma.db.subscription.findFirst({ where: { tenantId } });
      if (existing) {
        await this.prisma.db.subscription.update({ where: { id: existing.id }, data });
      } else {
        await this.prisma.db.subscription.create({ data: { id: newId(), tenantId, ...data } });
      }
    });
    await this.cache.invalidateTenant(tenantId);
    return { success: true, plan: input.plan };
  }

  async impersonate(tenantId: string, actorUserId: string, ip?: string, userAgent?: string) {
    const tenant = await this.findTenant(tenantId);
    const owner = await runAsSystem(() =>
      this.prisma.db.membership.findFirst({ where: { tenantId, role: 'owner' }, include: { user: true } })
    );
    if (!owner) throw new NotFoundException('Tenant owner not found');

    // Short-lived, explicitly attributed impersonation token.
    const token = await this.tokens.signAccess(
      {
        userId: owner.userId,
        tenantId,
        membershipId: owner.id,
        role: owner.role,
        permissions: owner.permissions,
        tokenVersion: owner.user.tokenVersion,
        impersonatedBy: actorUserId,
      },
      this.config.get<string>('IMPERSONATION_TTL') ?? '30m'
    );

    await this.prisma.db.activityLog.create({
      data: {
        tenantId,
        userId: actorUserId,
        page: 'admin/impersonate',
        action: 'impersonate',
        ip,
        userAgent,
      },
    });

    return { success: true, token, tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name } };
  }
}
