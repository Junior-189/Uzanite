import { describe, it, expect } from 'vitest';
import { adaptPlatformUser, mapPlatformPermissions } from './platformBridge';

describe('platformBridge (platform → legacy client user shape)', () => {
  it('maps a tenant owner/manager to the client role "tenant"', () => {
    expect(adaptPlatformUser({ platformRole: null, role: 'owner', permissions: ['orders'] }).role).toBe('tenant');
    expect(adaptPlatformUser({ platformRole: null, role: 'manager', permissions: [] }).role).toBe('tenant');
  });

  it('maps platform staff permissions to client page keys', () => {
    const user = adaptPlatformUser({
      platformRole: null,
      role: 'staff',
      permissions: ['orders', 'products', 'contacts', 'notifications', 'recycle_bin'],
    });
    expect(user.role).toBe('staff');
    expect(user.permissions).toEqual(
      expect.arrayContaining(['orders', 'products', 'contacts', 'notifications', 'recycleBin'])
    );
  });

  it('maps platform admins to their client roles', () => {
    expect(adaptPlatformUser({ platformRole: 'super_admin', role: null, permissions: [] }).role).toBe('super_admin');
    const sub = adaptPlatformUser({ platformRole: 'sub_admin', role: null, permissions: ['orders', 'reports'] });
    expect(sub.role).toBe('sub_admin');
    expect(sub.permissions).toEqual(expect.arrayContaining(['manage_orders', 'view_reports']));
  });

  it('drops permissions with no client equivalent', () => {
    expect(mapPlatformPermissions(['payments', 'receipts'], 'staff')).toEqual([]);
  });
});
