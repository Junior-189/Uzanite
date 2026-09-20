// Canonical permission catalogue and role defaults (Phase M12 RBAC maturity).
//
// Roles:
//   owner   — full control; bypasses permission checks in PermissionsGuard and
//             is the only role that can grant/alter ownership.
//   manager — runs day-to-day operations and finance, but not staff/ownership.
//   staff   — counter/POS users: basic operational reads/writes only.
//
// `owner` and `manager` bypass `@RequirePermission` in PermissionsGuard; the
// defaults below matter for `staff` and for any custom role/permission sets.

export const PERMISSIONS = [
  'orders',
  'products',
  'contacts',
  'whatsapp',
  'payments',
  'receipts',
  'expenses',
  'purchases',
  'debts',
  'notifications',
  'recycle_bin',
  'reports',
  'manage_staff',
  'manage_business',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// Permissions that only an owner (or platform admin) may grant.
const OWNER_ONLY_PERMISSIONS: readonly string[] = ['manage_staff'];

export const ROLE_DEFAULT_PERMISSIONS: Record<'owner' | 'manager' | 'staff', string[]> = {
  owner: [...PERMISSIONS],
  manager: [
    'orders',
    'products',
    'contacts',
    'whatsapp',
    'payments',
    'receipts',
    'expenses',
    'purchases',
    'debts',
    'notifications',
    'recycle_bin',
    'reports',
    'manage_business',
  ],
  staff: ['orders', 'products', 'contacts', 'notifications'],
};

export function isKnownPermission(permission: string): boolean {
  return (PERMISSIONS as readonly string[]).includes(permission);
}

export function isOwnerOnlyPermission(permission: string): boolean {
  return OWNER_ONLY_PERMISSIONS.includes(permission);
}

export function defaultPermissionsFor(role: 'owner' | 'manager' | 'staff'): string[] {
  return [...(ROLE_DEFAULT_PERMISSIONS[role] ?? [])];
}
