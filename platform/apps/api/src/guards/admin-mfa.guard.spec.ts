import { describe, it, expect } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AdminMfaGuard } from './admin-mfa.guard';
import { runWithRequest, Principal, RequestStore } from '../context/tenant-context';

const principal = (overrides: Partial<Principal> = {}): Principal => ({
  userId: 'admin-1',
  name: 'Admin',
  platformRole: 'super_admin',
  tenantId: null,
  membershipId: null,
  role: null,
  permissions: [],
  tokenVersion: 0,
  impersonatedBy: null,
  ...overrides,
});

const context = {} as unknown as ExecutionContext;

const makeGuard = (totpEnabledAt: Date | null) =>
  new AdminMfaGuard({ db: { user: { findFirst: async () => ({ totpEnabledAt }) } } } as never);

const run = (p: Principal, fn: () => Promise<boolean>) => runWithRequest({ principal: p } as RequestStore, fn);

describe('AdminMfaGuard', () => {
  it('blocks platform admins without TOTP enabled', async () => {
    await expect(run(principal(), () => makeGuard(null).canActivate(context))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows platform admins with TOTP enabled', async () => {
    await expect(run(principal(), () => makeGuard(new Date()).canActivate(context))).resolves.toBe(true);
  });

  it('does not affect non-admin users', async () => {
    await expect(run(principal({ platformRole: null }), () => makeGuard(null).canActivate(context))).resolves.toBe(true);
  });
});
