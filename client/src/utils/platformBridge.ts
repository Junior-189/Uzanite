import { isRoutedToPlatform } from './apiRouting';

/**
 * Compatibility bridge between the NestJS platform's auth/user shape and the
 * legacy shape this client was built against.
 *
 * The platform models a user as: platformRole (super_admin|sub_admin|null) plus
 * a tenant membership role (owner|manager|staff) and a canonical permission
 * catalogue. The client expects the legacy vocabulary: role `tenant` for a
 * business owner, `staff` for staff, and legacy permission keys
 * (`manage_orders`, `view_reports`, …). Without this adapter a platform user
 * would appear permissions-less and the entire UI would lock down.
 */

const PLATFORM_TO_STAFF_PAGE: Record<string, string> = {
  orders: 'orders',
  products: 'products',
  contacts: 'contacts',
  whatsapp: 'whatsapp',
  expenses: 'expenses',
  purchases: 'purchases',
  debts: 'debts',
  notifications: 'notifications',
  recycle_bin: 'recycleBin',
  reports: 'reports',
  manage_business: 'business',
  manage_staff: 'staff',
};

const PLATFORM_TO_SUBADMIN: Record<string, string> = {
  orders: 'manage_orders',
  products: 'manage_products',
  contacts: 'manage_contacts',
  whatsapp: 'manage_whatsapp',
  expenses: 'manage_expenses',
  purchases: 'manage_purchases',
  debts: 'manage_debts',
  notifications: 'manage_notifications',
  recycle_bin: 'access_recycle_bin',
  reports: 'view_reports',
  manage_staff: 'manage_staff',
  manage_business: 'manage_business',
};

export interface ClientUser {
  id?: string;
  name?: string;
  email?: string;
  role?: string;
  permissions?: string[];
  tenantId?: string | null;
  [key: string]: unknown;
}

export function mapPlatformPermissions(permissions: string[], role: string): string[] {
  if (role === 'staff') {
    return permissions.map((p) => PLATFORM_TO_STAFF_PAGE[p]).filter((p): p is string => !!p);
  }
  if (role === 'sub_admin') {
    return permissions.map((p) => PLATFORM_TO_SUBADMIN[p]).filter((p): p is string => !!p);
  }
  return permissions;
}

export function adaptPlatformUser(user: Record<string, unknown>): ClientUser {
  const platformRole = (user.platformRole as string | null) ?? null;
  const memberRole = (user.role as string | null) ?? null;
  const rawPermissions = Array.isArray(user.permissions) ? (user.permissions as string[]) : [];

  let role: string;
  if (platformRole === 'super_admin' || platformRole === 'sub_admin') role = platformRole;
  else if (memberRole === 'staff') role = 'staff';
  else role = 'tenant'; // owner / manager → the client treats a business owner as 'tenant'

  return {
    ...user,
    role,
    permissions: mapPlatformPermissions(rawPermissions, role),
  };
}

/**
 * Normalizes an auth response for `path`. When the path is served by the
 * platform, the `user` object (login/me) is adapted to the legacy shape;
 * otherwise the payload is returned untouched (legacy behaviour).
 */
export function adaptAuthResponse<T extends Record<string, unknown>>(path: string, json: T): T {
  if (!isRoutedToPlatform(path) || !json || typeof json !== 'object') return json;
  const user = (json as { user?: unknown }).user;
  if (user && typeof user === 'object') {
    return { ...json, user: adaptPlatformUser(user as Record<string, unknown>) };
  }
  return json;
}
