import { describe, it, expect } from 'vitest';
import {
  defaultPermissionsFor,
  isKnownPermission,
  isOwnerOnlyPermission,
  PERMISSIONS,
  ROLE_DEFAULT_PERMISSIONS,
} from './permissions';

describe('permission catalogue & role defaults', () => {
  it('is unique and every default references a known permission', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
    for (const permissions of Object.values(ROLE_DEFAULT_PERMISSIONS)) {
      for (const permission of permissions) {
        expect(isKnownPermission(permission)).toBe(true);
      }
    }
  });

  it('applies practical role defaults', () => {
    expect(defaultPermissionsFor('owner')).toHaveLength(PERMISSIONS.length);
    expect(defaultPermissionsFor('staff')).toEqual(['orders', 'products', 'contacts', 'notifications']);
    expect(defaultPermissionsFor('manager')).toContain('payments');
    expect(defaultPermissionsFor('manager')).not.toContain('manage_staff');
  });

  it('flags owner-only permissions', () => {
    expect(isOwnerOnlyPermission('manage_staff')).toBe(true);
    expect(isOwnerOnlyPermission('orders')).toBe(false);
    expect(isKnownPermission('not_a_permission')).toBe(false);
  });
});
