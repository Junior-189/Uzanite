import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { JwtKeyService } from '../security/jwt-keys.service';
import { PrismaService } from '../prisma/prisma.service';
import { IdentityResolverService } from '../modules/identity/identity-resolver.service';
import { runAsSystem, setPrincipal, setTenant, Principal } from '../context/tenant-context';

interface AccessTokenPayload {
  sub?: string;
  // Legacy Express claim (id) — accepted for transition compatibility.
  id?: string;
  // Legacy Express staff tokens carry `type: 'staff'`.
  type?: string;
  tid?: string | null;
  mid?: string | null;
  role?: string | null;
  perms?: string[];
  tv?: number;
  act?: string | null;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly keys: JwtKeyService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    private readonly identity: IdentityResolverService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('Not authorized, no token');

    let payload: AccessTokenPayload;
    try {
      payload = await this.keys.verify<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Not authorized, token failed');
    }

    // Platform staff tokens carry `type: 'staff'` with a platform UUID subject
    // and are not Users, so they build their principal from the staff row
    // (tenant + page permissions) instead of a membership. Legacy Express staff
    // tokens also use `type: 'staff'` but carry a Mongo ObjectId in `id` and no
    // `sub`; those fall through to the identity resolver below.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (payload.type === 'staff' && typeof payload.sub === 'string' && UUID_RE.test(payload.sub)) {
      const staffId = payload.sub;
      const staff = await runAsSystem(() =>
        this.prisma.db.staff.findFirst({
          where: { id: staffId },
          select: { id: true, name: true, tenantId: true, role: true, permissions: true, tokenVersion: true, status: true },
        })
      ).catch(() => null);
      if (!staff) throw new UnauthorizedException('Not authorized, token failed');
      if ((payload.tv ?? 0) !== staff.tokenVersion) {
        throw new UnauthorizedException('Session expired. Please sign in again.');
      }
      if (staff.status !== 'active') throw new ForbiddenException('Account is inactive. Contact your manager.');

      const principal: Principal = {
        userId: staff.id,
        name: staff.name ?? '',
        platformRole: null,
        tenantId: staff.tenantId,
        membershipId: null,
        role: 'staff',
        permissions: staff.permissions ?? [],
        tokenVersion: staff.tokenVersion,
        impersonatedBy: null,
      };
      setPrincipal(principal);
      setTenant(principal.tenantId);
      (req as Request & { principal?: Principal }).principal = principal;
      return true;
    }

    // C4: resolve a claim from EITHER system (platform UUID or legacy ObjectId)
    // to a platform user id.
    const resolved = await this.identity.resolveUserId(payload);
    if (!resolved) throw new UnauthorizedException('Not authorized, token failed');

    const user = await runAsSystem(() =>
      this.prisma.db.user.findFirst({
        where: { id: resolved.id, deletedAt: null },
        select: { id: true, name: true, tokenVersion: true, status: true, platformRole: true },
      })
    );
    if (!user) throw new UnauthorizedException('User not found');
    if ((payload.tv ?? 0) !== user.tokenVersion) {
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }
    if (user.status === 'suspended') throw new ForbiddenException('Your account has been suspended.');

    // Tenant + role: use token claims when present; otherwise derive from the
    // user's primary membership (legacy Express tokens carry no tenant claim).
    let tenantId = payload.tid ? ((await this.identity.resolveTenantId(payload.tid))?.id ?? null) : null;
    let membershipId = payload.mid ?? null;
    let role = payload.role ?? null;
    let permissions = payload.perms ?? [];

    if (!user.platformRole && (!tenantId || !role)) {
      const primary = await this.identity.resolvePrimaryMembership(user.id);
      if (primary) {
        tenantId = tenantId ?? primary.tenantId;
        membershipId = membershipId ?? primary.membershipId;
        role = role ?? primary.role;
        if (!permissions.length) permissions = primary.permissions;
      }
    }

    const principal: Principal = {
      userId: user.id,
      name: user.name ?? '',
      platformRole: (user.platformRole as Principal['platformRole']) ?? null,
      tenantId,
      membershipId,
      role,
      permissions,
      tokenVersion: user.tokenVersion,
      impersonatedBy: payload.act ?? null,
    };
    setPrincipal(principal);
    setTenant(principal.tenantId);
    (req as Request & { principal?: Principal }).principal = principal;
    return true;
  }
}
