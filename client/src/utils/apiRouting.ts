// Strangler cutover routing for the API client.
//
// The NestJS platform serves migrated domains under `/api/v1`; the legacy
// Express app serves everything under `/api`. During the transition the client
// talks to BOTH, domain by domain. This module decides which base a given path
// uses.
//
// Cutover is OFF by default (`VITE_API_V1` unset). It must only be enabled in
// an environment where the platform is actually deployed, because a wave path
// sent to an undeployed platform fails. Endpoints that exist only on the legacy
// app keep using legacy even when the flag is on.

export const LEGACY_BASE: string = (import.meta.env.VITE_API_URL as string) || '/api';
export const PLATFORM_BASE: string = (import.meta.env.VITE_PLATFORM_API_URL as string) || '/api/v1';

// Wave-1 cutover is deliberately narrow: AUTH only. The platform's admin and
// billing APIs do not yet match this client's call shapes (`/admin/users`,
// `/admin/stats`, feature flags, … all remain legacy), so routing them now would
// misroute live requests. Widen this list as each domain's call sites are
// reconciled and proven with the parity harness.
// Domains the platform fully covers AND whose client contract matches. Added
// incrementally as each is proven with the parity harness.
export const PLATFORM_PREFIXES = [
  '/auth',
  '/tenants',
  '/billing',
  '/notifications',
  '/dashboard',
  '/payments',
  '/files',
  '/contacts',
  '/recycle-bin',
] as const;

// Flows the platform does not implement yet — always legacy, even when the
// domain prefix is otherwise routed (e.g. product bulk-CSV import).
export const LEGACY_ONLY_PREFIXES = [
  '/auth/google',
  '/auth/staff',
  '/auth/theme',
  '/staff',
  '/products/bulk',
] as const;

export const platformCutoverEnabled: boolean = (import.meta.env.VITE_API_V1 as string) === 'true';

function normalize(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

export function isLegacyOnly(path: string): boolean {
  const p = normalize(path);
  return LEGACY_ONLY_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

export function isPlatformPath(path: string): boolean {
  const p = normalize(path);
  return PLATFORM_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

/** Returns the base URL to use for `path` under the current cutover flag. */
export function apiBaseFor(path: string): string {
  if (!platformCutoverEnabled) return LEGACY_BASE;
  if (isLegacyOnly(path)) return LEGACY_BASE;
  if (isPlatformPath(path)) return PLATFORM_BASE;
  return LEGACY_BASE;
}

/** Absolute URL for a path, honoring the cutover routing. */
export function resolveApiUrl(path: string): string {
  const p = normalize(path);
  return `${apiBaseFor(p)}${p}`;
}

/** True when `path` would be served by the platform right now. */
export function isRoutedToPlatform(path: string): boolean {
  return platformCutoverEnabled && !isLegacyOnly(path) && isPlatformPath(path);
}
