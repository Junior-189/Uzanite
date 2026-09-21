import { describe, it, expect } from 'vitest';
import { ExecutionContext } from '@nestjs/common';
import { PermissionsGuard } from './permissions.guard';
import { runWithRequest, Principal, RequestStore } from '../context/tenant-context';

const principal = (overrides: Partial<Principal> = {}): Principal => ({
  userId: 'user-1',
  name: 'User',
  platformRole: null,
  tenantId: 'tenant-1',
  membershipId: 'm1',
  role: 'staff',
  permissions: [],
  tokenVersion: 0,
  impersonatedBy: null,
  ...overrides,
});

const context = { getHandler: () => ({}), getClass: () => ({}), switchToHttp: () => ({ getRequest: () => ({}) }) } as unknown as ExecutionContext;

function makeGuard(required: string[] | undefined) {
  const reflector = { getAllAndOverride: () => required };
  return new PermissionsGuard(reflector as never);
}

const run = (p: Principal, fn: () => boolean) => runWithRequest({ principal: p } as RequestStore, fn);

describe('PermissionsGuard (read/write authorization baseline)', () => {
  it('allows when no permissions are required', () => {
    expect(run(principal(), () => makeGuard(undefined).canActivate(context))).toBe(true);
  });

  it('requires all listed permissions for staff', () => {
    expect(() =>
      run(principal({ permissions: ['orders'] }), () => makeGuard(['orders', 'products']).canActivate(context))
    ).toThrow(/Missing permission/);
    expect(run(principal({ permissions: ['orders', 'products'] }), () => makeGuard(['orders', 'products']).canActivate(context))).toBe(true);
  });

  it('lets owners bypass permission checks but not managers without the permission', () => {
    expect(run(principal({ role: 'owner', permissions: [] }), () => makeGuard(['payments']).canActivate(context))).toBe(true);
    // Managers are ordinary permission-holders now (owner-only perms stay owner-only).
    expect(() =>
      run(principal({ role: 'manager', permissions: [] }), () => makeGuard(['manage_staff']).canActivate(context))
    ).toThrow(/Missing permission/);
    expect(run(principal({ role: 'manager', permissions: ['manage_staff'] }), () => makeGuard(['manage_staff']).canActivate(context))).toBe(true);
  });

  it('lets platform admins bypass', () => {
    expect(run(principal({ platformRole: 'super_admin', permissions: [] }), () => makeGuard(['payments']).canActivate(context))).toBe(true);
  });
});
