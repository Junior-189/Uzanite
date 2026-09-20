import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import api from '../utils/api';
import { resolveApiUrl } from '../utils/apiRouting';
import { adaptAuthResponse } from '../utils/platformBridge';
import db from '../db';
import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  getUser,
  saveSession,
  setUser as setStoredUser,
} from '../utils/tokenStore';

const AuthContext = createContext(null);

// Credential handling lives in utils/tokenStore: the access token stays in
// memory and only the refresh token touches sessionStorage. Tokens are no
// longer mirrored into IndexedDB, which had made the refresh token a durable
// XSS-readable credential (see tokenStore.js for the full rationale).
async function saveAuth(token, user, refreshToken) {
  saveSession({ token, user, refreshToken });
}

async function clearAuth() {
  clearSession();
  try {
    // Remove any token material written by older builds.
    await db.settings.delete('auth');
  } catch { /* silent */ }
}

/**
 * Restores a session after a reload using the refresh token, so the user is not
 * bounced to the login screen. The access token is intentionally not persisted,
 * so it is re-minted here instead of read from storage.
 */
async function resumeSession() {
  try {
    // One-time cleanup: purge tokens persisted by a previous version.
    const legacy = await db.settings.get('auth');
    if (legacy) await db.settings.delete('auth');
  } catch { /* silent */ }

  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  try {
    const res = await fetch(resolveApiUrl('/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    const json = adaptAuthResponse('/auth/refresh', await res.json());
    if (!json?.success || !json.token) {
      clearSession();
      return null;
    }
    saveSession({ token: json.token, refreshToken: json.refreshToken ?? refreshToken, user: json.user ?? getUser() });
    return { token: json.token, user: json.user ?? getUser() };
  } catch {
    // Offline: keep the refresh token so a later attempt can succeed.
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getUser());
  const [token, setToken] = useState(() => getAccessToken());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (token) { setHydrated(true); return; }
    resumeSession().then((session) => {
      if (session) {
        setToken(session.token);
        setUser(session.user);
      }
      setHydrated(true);
    });
  }, []);

  // Poll effective feature flags for tenants so admin enable/disable changes
  // apply without requiring a re-login. (No-op for admins/staff.)
  useEffect(() => {
    if (!token || user?.role !== 'tenant') return;
    let active = true;
    const poll = async () => {
      try {
        const res = await api.get('/admin/feature-flags/me');
        if (active && res.success && res.flags) {
          setUser((prev) => {
            if (JSON.stringify(prev.featureFlags) === JSON.stringify(res.flags)) return prev;
            const updated = { ...prev, featureFlags: res.flags };
            setStoredUser(updated);
            return updated;
          });
        }
      } catch {}
    };
    poll();
    const id = setInterval(poll, 30000);
    return () => { active = false; clearInterval(id); };
  }, [token, user?.role]);

  const login = useCallback(async (email, password) => {
    const res = await fetch(resolveApiUrl('/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const json = adaptAuthResponse('/auth/login', await res.json());
    if (json.pending) {
      return json;
    }
    // Two-factor: the platform returns a short-lived challenge instead of a session.
    if (json.mfaRequired) {
      return { mfaRequired: true, mfaToken: json.mfaToken };
    }
    if (json.success) {
      await saveAuth(json.token, json.user, json.refreshToken);
      setToken(json.token);
      setUser(json.user);
      return json;
    }
    throw Object.assign(new Error(json.error || 'Login failed'), { lockout: json.lockout, retryAfter: json.retryAfter });
  }, []);

  const completeMfa = useCallback(async (mfaToken, code) => {
    const res = await fetch(resolveApiUrl('/auth/login/2fa'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mfaToken, code }),
    });
    const json = adaptAuthResponse('/auth/login/2fa', await res.json());
    if (json.success) {
      await saveAuth(json.token, json.user, json.refreshToken);
      setToken(json.token);
      setUser(json.user);
      return json;
    }
    throw new Error(json.error || 'Invalid authentication code');
  }, []);

  const googleLogin = useCallback(async (credential) => {
    const apiUrl = import.meta.env.VITE_API_URL || '/api';
    const res = await fetch(`${apiUrl}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: credential }),
    });
    const json = await res.json();
    if (json.pending) return json;
    if (json.success) {
      await saveAuth(json.token, json.user, json.refreshToken);
      setToken(json.token);
      setUser(json.user);
      return json;
    }
    throw new Error(json.error || 'Google login failed');
  }, []);

  const staffLogin = useCallback(async (email, password) => {
    const res = await fetch(resolveApiUrl('/staff/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json();
    if (json.success) {
      await saveAuth(json.token, json.user, json.refreshToken);
      setToken(json.token);
      setUser(json.user);
      return json;
    }
    throw Object.assign(new Error(json.error || 'Login failed'), { lockout: json.lockout, retryAfter: json.retryAfter });
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      try {
        await fetch(resolveApiUrl('/auth/logout'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
      } catch { /* best-effort */ }
    }
    await clearAuth();
    try { await db.dashboardCache.clear(); } catch { /* silent */ }
    setToken(null);
    setUser({});
    window.location.hash = '#/admin/login.html';
  }, []);

  const refreshPermissions = useCallback(async () => {
    if (!token || user.role !== 'staff') return;
    try {
      const res = await api.get('/staff/me');
      if (res.success) {
        const updated = { ...user, permissions: res.user.permissions };
        await saveAuth(token, updated);
        setUser(updated);
      }
    } catch { /* silent */ }
  }, [token, user]);

  const PAGE_PERMISSION_MAP = {
    dashboard: 'view_dashboard',
    orders: 'manage_orders',
    products: 'manage_products',
    contacts: 'manage_contacts',
    business: 'manage_business',
    whatsapp: 'manage_whatsapp',
    broadcast: 'manage_broadcast',
    expenses: 'manage_expenses',
    purchases: 'manage_purchases',
    debts: 'manage_debts',
    staff: 'manage_staff',
    reports: 'view_reports',
    notifications: 'manage_notifications',
    recycleBin: 'access_recycle_bin',
    adminPanel: 'view_tenants',
  };

  const TENANT_PAGE_KEYS = ['view_dashboard','manage_orders','manage_products','manage_contacts','manage_whatsapp','manage_broadcast','manage_expenses','manage_purchases','manage_debts','manage_staff','manage_business','manage_notifications','view_reports','access_recycle_bin'];

  const hasPermission = useCallback((page) => {
    if (!user) return false;
    if (user.role === 'super_admin') return true;
    // Check impersonation restrictions FIRST (before tenant check)
    if (user.impersonating && user.impersonatorPermissions) {
      const perm = PAGE_PERMISSION_MAP[page] || page;
      return user.impersonatorPermissions.includes(perm);
    }
    if (user.role === 'tenant') return true;
    if (user.role === 'sub_admin') {
      const perm = PAGE_PERMISSION_MAP[page] || page;
      return (user.permissions || []).includes(perm);
    }
    if (user.role === 'staff') return (user.permissions || []).includes(page);
    return false;
  }, [user]);

  const toggleLanguage = useCallback(() => {
    const newLang = user.lang === 'sw' ? 'en' : 'sw';
    const updated = { ...user, lang: newLang };
    saveAuth(token, updated);
    setUser(updated);
  }, [user, token]);

  return (
    <AuthContext.Provider value={{ user, token, login, completeMfa, googleLogin, staffLogin, logout, refreshPermissions, hasPermission, toggleLanguage, hydrated }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
