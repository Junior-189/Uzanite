import { describe, it, expect } from 'vitest';
import { ExecutionContext } from '@nestjs/common';
import { TenantGuard } from './tenant.guard';
import { runWithRequest, Principal, RequestStore } from '../context/tenant-context';

const principal = (overrides: Partial<Principal> = {}): Principal => ({
  userId: 'user-1',
  name: 'Owner',
  platformRole: null,
  tenantId: 'tenant-1',
  membershipId: null,
  role: 'owner',
  permissions: [],
  tokenVersion: 0,
  impersonatedBy: null,
  ...overrides,
});

function context(): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
  } as unknown as ExecutionContext;
}

function buildGuard(opts: {
  required: boolean;
  membership: unknown;
  principal?: Principal;
  /** Set to exercise the cached path instead of the loader. */
  cached?: unknown;
  ttl?: number;
}) {
  const reflector = { getAllAndOverride: () => opts.required };
  const uow = { runAsSystem: async (fn: () => Promise<unknown>) => fn() };
  const prisma = { db: { membership: { findFirst: async () => opts.membership } } };
  // Pass-through cache: exercises the guard's logic, not Redis.
  const cache = {
    generation: async () => '0',
    wrap: async <T>(_name: string, _key: string, _ttl: number, loader: () => Promise<T>) =>
      (opts.cached !== undefined ? (opts.cached as T) : await loader()),
    del: async () => undefined,
    bumpGeneration: async () => undefined,
    invalidateMembership: async () => undefined,
    invalidateTenant: async () => undefined,
  };
  const config = { get: () => opts.ttl ?? 60 };
  return new TenantGuard(prisma as never, reflector as never, uow as never, cache as never, config as never);
}

const run = (p: Principal, fn: () => Promise<boolean>) => runWithRequest({ principal: p } as RequestStore, fn);

describe('TenantGuard — tenant/user lifecycle gating (M10)', () => {
  it('blocks a pending tenant on protected routes', async () => {
    const guard = buildGuard({
      required: true,
      membership: { id: 'm1', role: 'owner', permissions: [], tenant: { status: 'pending' }, user: { status: 'active' } },
    });
    await expect(run(principal(), () => guard.canActivate(context()))).rejects.toThrow(/not active yet/);
  });

  it('blocks a non-active user on protected routes', async () => {
    const guard = buildGuard({
      required: true,
      membership: { id: 'm1', role: 'owner', permissions: [], tenant: { status: 'approved' }, user: { status: 'pending' } },
    });
    await expect(run(principal(), () => guard.canActivate(context()))).rejects.toThrow(/account is not active/i);
  });

  it('allows an approved tenant with an active user', async () => {
    const guard = buildGuard({
      required: true,
      membership: { id: 'm1', role: 'owner', permissions: [], tenant: { status: 'approved' }, user: { status: 'active' } },
    });
    await expect(run(principal(), () => guard.canActivate(context()))).resolves.toBe(true);
  });

  it('does not gate non-tenant routes (e.g. /auth/me)', async () => {
    const guard = buildGuard({
      required: false,
      membership: { id: 'm1', role: 'owner', permissions: [], tenant: { status: 'pending' }, user: { status: 'pending' } },
    });
    await expect(run(principal(), () => guard.canActivate(context()))).resolves.toBe(true);
  });

  it('lets platform admins bypass', async () => {
    const guard = buildGuard({ required: true, membership: null, principal: principal({ platformRole: 'super_admin', tenantId: null }) });
    await expect(
      run(principal({ platformRole: 'super_admin', tenantId: null }), () => guard.canActivate(context()))
    ).resolves.toBe(true);
  });

  it('rejects non-members', async () => {
    const guard = buildGuard({ required: true, membership: null });
    await expect(run(principal(), () => guard.canActivate(context()))).rejects.toThrow(/not a member/);
  });
});
