import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  canResume,
  clearSession,
  getAccessToken,
  getRefreshToken,
  getUser,
  restoreAdminSession,
  saveSession,
  setAccessToken,
  setUser,
  stashAdminSession,
} from './tokenStore';

/**
 * These tests encode the security property the store exists to provide: the
 * access token must never be persisted, and the refresh token must never reach
 * durable storage such as IndexedDB.
 */
describe('tokenStore', () => {
  beforeEach(() => {
    clearSession();
    sessionStorage.clear();
  });

  it('keeps the access token in memory and out of storage', () => {
    saveSession({ token: 'access-1', refreshToken: 'refresh-1', user: { id: 'u1' } });

    expect(getAccessToken()).toBe('access-1');
    // The whole point: an XSS reading storage must not find the access token.
    expect(sessionStorage.getItem('token')).toBeNull();
  });

  it('stores only the refresh token in sessionStorage', () => {
    saveSession({ token: 'access-1', refreshToken: 'refresh-1' });
    expect(sessionStorage.getItem('refreshToken')).toBe('refresh-1');
    expect(getRefreshToken()).toBe('refresh-1');
  });

  it('adopts a legacy persisted access token once, then removes it', () => {
    // Simulates a user upgrading from a build that persisted the access token.
    sessionStorage.setItem('token', 'legacy-access');
    expect(getAccessToken()).toBe('legacy-access');
    expect(sessionStorage.getItem('token')).toBeNull();
  });

  it('clears every credential on logout', () => {
    saveSession({ token: 'a', refreshToken: 'r', user: { id: 'u' } });
    clearSession();

    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(getUser()).toEqual({});
    expect(canResume()).toBe(false);
  });

  it('reports whether a session can be resumed', () => {
    expect(canResume()).toBe(false);
    saveSession({ token: 'a', refreshToken: 'r' });
    expect(canResume()).toBe(true);
  });

  it('round-trips the user profile', () => {
    setUser({ id: 'u1', role: 'tenant' });
    expect(getUser()).toEqual({ id: 'u1', role: 'tenant' });
  });

  it('survives storage being unavailable', () => {
    // Private mode / blocked site data: every accessor throws.
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    vi.stubGlobal('sessionStorage', throwing);

    // Must not throw, and the in-memory access token must still work.
    expect(() => saveSession({ token: 'a', refreshToken: 'r', user: { id: 'u' } })).not.toThrow();
    expect(getAccessToken()).toBe('a');
    expect(getUser()).toEqual({});
    expect(() => clearSession()).not.toThrow();
  });

  it('stashes and restores an admin session around impersonation', () => {
    saveSession({ token: 'admin-access', refreshToken: 'admin-refresh', user: { id: 'admin', role: 'super_admin' } });

    stashAdminSession();
    // Switch into the impersonated tenant session.
    setAccessToken('tenant-access');
    setUser({ id: 'tenant', role: 'tenant', impersonating: true });
    expect(getAccessToken()).toBe('tenant-access');

    expect(restoreAdminSession()).toBe(true);
    expect(getAccessToken()).toBe('admin-access');
    expect(getUser().role).toBe('super_admin');
    // The admin token is never left behind in storage.
    expect(sessionStorage.getItem('adminToken')).toBeNull();
  });

  it('reports failure when there is no admin session to restore', () => {
    expect(restoreAdminSession()).toBe(false);
  });
});
