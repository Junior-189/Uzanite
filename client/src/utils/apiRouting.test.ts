import { describe, it, expect, afterEach, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadWithFlag(value: string) {
  vi.stubEnv('VITE_API_V1', value);
  vi.resetModules();
  return import('./apiRouting');
}

async function loadWith(value: string, domains?: string) {
  vi.stubEnv('VITE_API_V1', value);
  vi.stubEnv('VITE_API_V1_DOMAINS', domains ?? '');
  vi.resetModules();
  return import('./apiRouting');
}

describe('apiRouting (Strangler cutover)', () => {
  it('routes auth to /api/v1 when VITE_API_V1=true', async () => {
    const m = await loadWithFlag('true');
    expect(m.isRoutedToPlatform('/auth/login')).toBe(true);
    expect(m.isRoutedToPlatform('/auth/google')).toBe(true);
    expect(m.apiBaseFor('/auth/refresh')).toBe('/api/v1');
    expect(m.resolveApiUrl('/auth/me')).toBe('/api/v1/auth/me');
  });

  it('keeps everything on legacy when the flag is off', async () => {
    const m = await loadWithFlag('false');
    expect(m.isRoutedToPlatform('/auth/login')).toBe(false);
    expect(m.apiBaseFor('/auth/login')).toBe('/api');
    expect(m.apiBaseFor('/orders')).toBe('/api');
  });

  it('never routes legacy-only auth flows to the platform', async () => {
    const m = await loadWithFlag('true');
    expect(m.isRoutedToPlatform('/auth/staff/login')).toBe(false);
    expect(m.apiBaseFor('/auth/staff/login')).toBe('/api');
    expect(m.isRoutedToPlatform('/products/bulk')).toBe(false);
  });

  it('routes fully-covered domains when enabled', async () => {
    const m = await loadWithFlag('true');
    expect(m.isRoutedToPlatform('/notifications')).toBe(true);
    expect(m.isRoutedToPlatform('/tenants/me')).toBe(true);
    expect(m.isRoutedToPlatform('/billing/plans')).toBe(true);
    expect(m.isRoutedToPlatform('/dashboard/stats')).toBe(true);
    expect(m.isRoutedToPlatform('/payments/orders/x/manual')).toBe(true);
    expect(m.isRoutedToPlatform('/files')).toBe(true);
    expect(m.isRoutedToPlatform('/contacts')).toBe(true);
    expect(m.isRoutedToPlatform('/recycle-bin')).toBe(true);
    expect(m.isRoutedToPlatform('/products')).toBe(true);
    expect(m.isRoutedToPlatform('/orders')).toBe(true);
    expect(m.isRoutedToPlatform('/orders/abc/receipt')).toBe(true);
    expect(m.isRoutedToPlatform('/expenses')).toBe(true);
    expect(m.isRoutedToPlatform('/purchases')).toBe(true);
    expect(m.isRoutedToPlatform('/debts')).toBe(true);
    expect(m.isRoutedToPlatform('/debts/abc/pay')).toBe(true);
    expect(m.isRoutedToPlatform('/reports')).toBe(true);
    expect(m.isRoutedToPlatform('/reports/summary')).toBe(true);
    expect(m.isRoutedToPlatform('/staff')).toBe(true);
    expect(m.isRoutedToPlatform('/staff/login')).toBe(true);
    expect(m.isRoutedToPlatform('/admin/users')).toBe(true);
    expect(m.isRoutedToPlatform('/admin/users/abc/approve')).toBe(true);
    expect(m.isRoutedToPlatform('/admin/sub-admins')).toBe(true);
    expect(m.isRoutedToPlatform('/admin/stats')).toBe(true);
    expect(m.isRoutedToPlatform('/admin/impersonate/abc')).toBe(true);
    expect(m.isRoutedToPlatform('/admin/feature-flags')).toBe(true);
    expect(m.isRoutedToPlatform('/admin/feature-flags/me')).toBe(true);
    expect(m.isRoutedToPlatform('/admin/activity-logs')).toBe(true);
    expect(m.isRoutedToPlatform('/admin/login-attempts')).toBe(true);
    expect(m.isRoutedToPlatform('/auth/theme')).toBe(true);
  });

  it('restricts routing to VITE_API_V1_DOMAINS when set (per-domain rollout)', async () => {
    const m = await loadWith('true', 'auth,billing');
    expect(m.isRoutedToPlatform('/auth/login')).toBe(true);
    expect(m.isRoutedToPlatform('/billing/plans')).toBe(true);
    expect(m.isRoutedToPlatform('/products')).toBe(false);
    expect(m.isRoutedToPlatform('/staff')).toBe(false);
  });

  it('accepts bare or rooted domain names in VITE_API_V1_DOMAINS', async () => {
    const m = await loadWith('true', '/staff,/products');
    expect(m.isRoutedToPlatform('/staff')).toBe(true);
    expect(m.isRoutedToPlatform('/products')).toBe(true);
    expect(m.isRoutedToPlatform('/auth/login')).toBe(false);
  });

  it('ignores the domain override when the cutover flag is off', async () => {
    const m = await loadWith('false', 'auth,billing');
    expect(m.isRoutedToPlatform('/auth/login')).toBe(false);
    expect(m.apiBaseFor('/billing/plans')).toBe('/api');
  });

  it('keeps legacy-only sub-paths on legacy even when the prefix is routed', async () => {
    const m = await loadWithFlag('true');
    expect(m.isRoutedToPlatform('/products/bulk')).toBe(false);
    expect(m.apiBaseFor('/products/bulk')).toBe('/api');
  });

  it('does not route domains the platform does not implement yet', async () => {
    const m = await loadWithFlag('true');
    expect(m.isRoutedToPlatform('/broadcast/send')).toBe(false);
    expect(m.isRoutedToPlatform('/chat/send')).toBe(false);
  });
});
