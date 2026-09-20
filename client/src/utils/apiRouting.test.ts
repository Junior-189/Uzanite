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

describe('apiRouting (Strangler cutover)', () => {
  it('routes auth to /api/v1 when VITE_API_V1=true', async () => {
    const m = await loadWithFlag('true');
    expect(m.isRoutedToPlatform('/auth/login')).toBe(true);
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
    expect(m.isRoutedToPlatform('/auth/google')).toBe(false);
    expect(m.isRoutedToPlatform('/auth/staff/login')).toBe(false);
    expect(m.apiBaseFor('/auth/google')).toBe('/api');
  });

  it('routes fully-covered domains when enabled', async () => {
    const m = await loadWithFlag('true');
    expect(m.isRoutedToPlatform('/notifications')).toBe(true);
    expect(m.isRoutedToPlatform('/tenants/me')).toBe(true);
    expect(m.isRoutedToPlatform('/billing/plans')).toBe(true);
    expect(m.isRoutedToPlatform('/dashboard/stats')).toBe(true);
  });

  it('does not route domains the platform does not implement yet', async () => {
    const m = await loadWithFlag('true');
    expect(m.isRoutedToPlatform('/orders')).toBe(false);
    expect(m.isRoutedToPlatform('/admin/users')).toBe(false);
    expect(m.isRoutedToPlatform('/products')).toBe(false);
    expect(m.isRoutedToPlatform('/staff')).toBe(false);
    expect(m.isRoutedToPlatform('/broadcast/send')).toBe(false);
    expect(m.isRoutedToPlatform('/chat/send')).toBe(false);
  });
});
