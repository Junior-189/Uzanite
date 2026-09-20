import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { REQUIRE_TENANT_KEY } from '../decorators/require-tenant.decorator';
import { getRequestStore, setPrincipal, setTenant } from '../context/tenant-context';
import { CacheService } from '../cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { UnitOfWorkService } from '../prisma/unit-of-work.service';

interface CachedMembership {
  id: string;
  role: string;
  permissions: string[];
  tenantStatus: string;
  userStatus: string;
}

// Resolves the active tenant (from X-Tenant-Id or the token) and verifies the
// caller's membership. Platform admins bypass membership checks.
//
// Tenant-scoped routes (@RequireTenant) additionally require the tenant to be
// `approved` and the user to be `active`, so a pending/rejected/suspended
// tenant (or a pending user) cannot reach protected business APIs even though
// login succeeds and /auth/me remains available.
//
// NOTE: guards run BEFORE the request transaction interceptor, so the
// membership lookup runs in its own bypass transaction (RLS-safe) when RLS is on.
//
// The lookup is cached for CACHE_MEMBERSHIP_TTL seconds because it is on 100%
// of authenticated traffic. Any write that changes a membership, a tenant's
// status or a user's status must invalidate it (see MembershipsService and
// AdminService) — the short TTL bounds the damage if one is ever missed.
@Injectable()
export class TenantGuard implements CanActivate {
  private readonly cacheTtl: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    private readonly uow: UnitOfWorkService,
    private readonly cache: CacheService,
    config: ConfigService
  ) {
    this.cacheTtl = config.get<number>('CACHE_MEMBERSHIP_TTL') ?? 60;
  }

  private async loadMembership(userId: string, tenantId: string): Promise<CachedMembership | null> {
    // The generation prefix lets a tenant-wide change (approval, suspension,
    // plan change) invalidate every member's entry with one counter bump.
    const gen = this.cacheTtl > 0 ? await this.cache.generation(tenantId) : '0';
    return this.cache.wrap<CachedMembership | null>(
      'membership',
      `membership:${gen}:${userId}:${tenantId}`,
      this.cacheTtl,
      async () => {
        const membership = await this.uow.runAsSystem(() =>
          this.prisma.db.membership.findFirst({
            where: { userId, tenantId, status: 'active' },
            select: {
              id: true,
              role: true,
              permissions: true,
              tenant: { select: { status: true } },
              user: { select: { status: true } },
            },
          })
        );
        if (!membership) return null;
        return {
          id: membership.id,
          role: membership.role,
          permissions: membership.permissions,
          tenantStatus: membership.tenant.status,
          userStatus: membership.user.status,
        };
      }
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const principal = getRequestStore()?.principal;
    if (!principal) return true; // public route

    const required = this.reflector.getAllAndOverride<boolean>(REQUIRE_TENANT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (principal.platformRole) return true; // platform admins operate cross-tenant

    const req = context.switchToHttp().getRequest<Request>();
    const headerTenant = (req.headers['x-tenant-id'] as string) || null;
    const tenantId = headerTenant || principal.tenantId;
    if (!tenantId) {
      if (required) throw new ForbiddenException('Tenant context required');
      return true;
    }

    const membership = await this.loadMembership(principal.userId, tenantId);
    if (!membership) throw new ForbiddenException('You are not a member of this tenant');

    // Gate protected business APIs on tenant + user lifecycle status.
    if (required) {
      if (membership.tenantStatus !== 'approved') {
        throw new ForbiddenException('Your business account is not active yet. Contact support.');
      }
      if (membership.userStatus !== 'active') {
        throw new ForbiddenException('Your account is not active. Contact support.');
      }
    }

    principal.tenantId = tenantId;
    principal.membershipId = membership.id;
    principal.role = membership.role as typeof principal.role;
    principal.permissions = membership.permissions;
    setPrincipal(principal);
    setTenant(tenantId);
    return true;
  }
}
