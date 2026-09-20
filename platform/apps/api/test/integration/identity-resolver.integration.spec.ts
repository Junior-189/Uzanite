import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { createHarness, resetDb, hasDb, Harness } from './setup';
import { UnitOfWorkService } from '../../src/prisma/unit-of-work.service';
import { IdentityResolverService } from '../../src/modules/identity/identity-resolver.service';
import { JwtAuthGuard } from '../../src/guards/jwt-auth.guard';
import { runWithRequest, getRequestStore, Principal } from '../../src/context/tenant-context';

const d = hasDb ? describe : describe.skip;

const OID = (suffix: string) => `507f1f77bcf86cd7994390${suffix}`; // 24-hex Mongo ObjectId

d('identity resolver / dual-token auth (Postgres)', () => {
  let h: Harness;
  let resolver: IdentityResolverService;
  let guard: JwtAuthGuard;
  let jwt: JwtService;

  beforeAll(async () => {
    h = await createHarness();
    const uow = new UnitOfWorkService(h.prisma);
    resolver = new IdentityResolverService(h.prisma, uow);
    jwt = new JwtService({ secret: process.env.JWT_SECRET as string });
    guard = new JwtAuthGuard(jwt, h.prisma, new Reflector(), resolver);
  });
  afterAll(async () => {
    if (h) await h.prisma.onModuleDestroy();
  });
  beforeEach(async () => {
    await resetDb(h.prisma);
  });

  const sign = (payload: Record<string, unknown>) => jwt.signAsync(payload, { expiresIn: '1h' });

  function ctx(authorization?: string): ExecutionContext {
    const req: Record<string, unknown> = { headers: authorization ? { authorization } : {} };
    return {
      getHandler: () => function handler() {},
      getClass: () => class Test {},
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}), getNext: () => ({}) }),
    } as unknown as ExecutionContext;
  }

  async function runGuard(authorization?: string): Promise<Principal | undefined> {
    return runWithRequest({ requestId: 'test' }, async () => {
      await guard.canActivate(ctx(authorization));
      return getRequestStore()?.principal;
    });
  }

  async function seed(opts: {
    legacyId?: string | null;
    staff?: boolean;
    platformRole?: 'super_admin' | 'sub_admin' | null;
    tokenVersion?: number;
    status?: 'active' | 'suspended';
  }) {
    const tenantId = randomUUID();
    const slug = `idr-${tenantId.slice(0, 8)}`;
    await h.prisma.base.tenant.create({
      data: { id: tenantId, slug, name: 'IDR', status: 'approved' },
    });
    const userId = randomUUID();
    await h.prisma.base.user.create({
      data: {
        id: userId,
        email: `${userId.slice(0, 8)}@x.com`,
        name: 'IDR User',
        status: opts.status ?? 'active',
        tokenVersion: opts.tokenVersion ?? 0,
        legacyId: opts.legacyId ?? null,
        platformRole: opts.platformRole ?? null,
      },
    });
    if (!opts.platformRole) {
      await h.prisma.base.membership.create({
        data: {
          id: randomUUID(),
          userId,
          tenantId,
          role: opts.staff ? 'staff' : 'owner',
          permissions: opts.staff ? ['products'] : [],
        },
      });
    }
    return { tenantId, userId, slug };
  }

  it('resolves a legacy Express token (Mongo ObjectId via legacy_id) to the platform user + tenant', async () => {
    const { tenantId, userId } = await seed({ legacyId: OID('11') });
    const token = await sign({ id: OID('11'), tv: 0 });

    const principal = await runGuard(`Bearer ${token}`);
    expect(principal?.userId).toBe(userId);
    expect(principal?.tenantId).toBe(tenantId);
    expect(principal?.role).toBe('owner');
    expect(principal?.platformRole).toBeNull();
  });

  it('resolves a legacy token via an explicit identity_alias row', async () => {
    const { userId, tenantId } = await seed({ legacyId: null });
    await resolver.linkUser({ userId, externalId: OID('12'), note: 'test' });
    const token = await sign({ id: OID('12'), tv: 0 });

    const principal = await runGuard(`Bearer ${token}`);
    expect(principal?.userId).toBe(userId);
    expect(principal?.tenantId).toBe(tenantId);
  });

  it('still resolves native NestJS platform tokens (UUID claims)', async () => {
    const { userId, tenantId } = await seed({});
    const token = await sign({ sub: userId, id: userId, tid: tenantId, mid: null, role: 'owner', perms: [], tv: 0 });

    const principal = await runGuard(`Bearer ${token}`);
    expect(principal?.userId).toBe(userId);
    expect(principal?.tenantId).toBe(tenantId);
    expect(principal?.role).toBe('owner');
  });

  it('resolves a legacy staff token (type=staff) to the staff membership', async () => {
    const { userId, tenantId } = await seed({ legacyId: `staff:${OID('13')}`, staff: true });
    const token = await sign({ id: OID('13'), tv: 0, type: 'staff' });

    const principal = await runGuard(`Bearer ${token}`);
    expect(principal?.userId).toBe(userId);
    expect(principal?.tenantId).toBe(tenantId);
    expect(principal?.role).toBe('staff');
    expect(principal?.permissions).toEqual(['products']);
  });

  it('resolves a tenant claim given as a legacy business slug', async () => {
    const { userId, tenantId, slug } = await seed({ legacyId: OID('14') });
    const token = await sign({ id: OID('14'), tid: slug, tv: 0 });

    const principal = await runGuard(`Bearer ${token}`);
    expect(principal?.userId).toBe(userId);
    expect(principal?.tenantId).toBe(tenantId);
  });

  it('resolves a legacy super_admin token without a membership', async () => {
    await seed({ legacyId: OID('15'), platformRole: 'super_admin' });
    const token = await sign({ id: OID('15'), tv: 0 });

    const principal = await runGuard(`Bearer ${token}`);
    expect(principal?.platformRole).toBe('super_admin');
    expect(principal?.tenantId).toBeNull();
  });

  it('rejects an unknown legacy identity', async () => {
    await expect(runGuard(`Bearer ${await sign({ id: OID('99'), tv: 0 })}`)).rejects.toThrow(/token failed|Not authorized/);
  });

  it('rejects a token whose version no longer matches', async () => {
    await seed({ legacyId: OID('16'), tokenVersion: 2 });
    await expect(runGuard(`Bearer ${await sign({ id: OID('16'), tv: 0 })}`)).rejects.toThrow(/Session expired/);
  });

  it('rejects a suspended user', async () => {
    await seed({ legacyId: OID('17'), status: 'suspended' });
    await expect(runGuard(`Bearer ${await sign({ id: OID('17'), tv: 0 })}`)).rejects.toThrow(/suspended/);
  });

  it('rejects a request with no token', async () => {
    await expect(runGuard(undefined)).rejects.toThrow(/no token/);
  });
});
