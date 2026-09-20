/**
 * Credential storage for the admin client.
 *
 * WHAT CHANGED AND WHY
 *
 * Tokens used to be written to BOTH sessionStorage and IndexedDB, and restored
 * from IndexedDB on every mount. That made the refresh token a durable,
 * XSS-readable credential: any script injected anywhere in the app could read a
 * long-lived token out of IndexedDB, and it survived tab closes and app
 * restarts. It also defeated the server's careful refresh-token rotation and
 * reuse detection — stealing the stored token is strictly easier than racing a
 * rotation.
 *
 * The model now:
 *
 *   - ACCESS token: memory only. Never persisted. It lives ~15 minutes, so an
 *     XSS has to exfiltrate it live rather than harvest it from storage later.
 *   - REFRESH token: sessionStorage only. Scoped to the tab/session, cleared on
 *     close, and never in IndexedDB. Gives us a working page-reload without a
 *     durable on-disk credential.
 *   - USER profile: sessionStorage. Not a secret; it only drives UI.
 *
 * RESIDUAL RISK, stated plainly: any storage reachable from JavaScript is
 * reachable from XSS. sessionStorage is a smaller window than IndexedDB, not a
 * safe one. The controls that actually contain this are the Content Security
 * Policy on the serving origin, refresh rotation with reuse detection, and
 * short access-token TTLs — all of which are in place. A future improvement is
 * moving the refresh token to an HttpOnly, SameSite cookie so JavaScript cannot
 * read it at all; that needs a server-side session endpoint and CSRF handling.
 */

const ACCESS_KEY = 'token';
const REFRESH_KEY = 'refreshToken';
const USER_KEY = 'user';

// Access token: module-scoped, so it is gone on reload and never serialised.
let accessToken = null;

function safeSession() {
  try {
    // Availability varies: private mode, blocked site data, embedded webviews.
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

export function getAccessToken() {
  if (accessToken) return accessToken;
  // Legacy sessions may still have one from before this change; adopt it once
  // into memory and remove the persisted copy.
  const store = safeSession();
  const legacy = store?.getItem(ACCESS_KEY) ?? null;
  if (legacy) {
    accessToken = legacy;
    try {
      store.removeItem(ACCESS_KEY);
    } catch {
      /* best effort */
    }
  }
  return accessToken;
}

export function setAccessToken(token) {
  accessToken = token || null;
}

export function getRefreshToken() {
  return safeSession()?.getItem(REFRESH_KEY) ?? null;
}

export function setRefreshToken(token) {
  const store = safeSession();
  if (!store) return;
  try {
    if (token) store.setItem(REFRESH_KEY, token);
    else store.removeItem(REFRESH_KEY);
  } catch {
    /* storage unavailable: the session simply will not survive a reload */
  }
}

export function getUser() {
  try {
    return JSON.parse(safeSession()?.getItem(USER_KEY) || '{}');
  } catch {
    return {};
  }
}

export function setUser(user) {
  const store = safeSession();
  if (!store) return;
  try {
    if (user) store.setItem(USER_KEY, JSON.stringify(user));
    else store.removeItem(USER_KEY);
  } catch {
    /* non-fatal */
  }
}

export function saveSession({ token, refreshToken, user }) {
  setAccessToken(token);
  if (refreshToken !== undefined) setRefreshToken(refreshToken);
  if (user !== undefined) setUser(user);
}

export function clearSession() {
  accessToken = null;
  const store = safeSession();
  try {
    store?.removeItem(ACCESS_KEY);
    store?.removeItem(REFRESH_KEY);
    store?.removeItem(USER_KEY);
  } catch {
    /* best effort */
  }
}

/** True when a refresh is possible without re-entering credentials. */
export function canResume() {
  return !!getRefreshToken();
}

// ── Impersonation: stash and restore the admin's own session ────────────────
// Kept in memory alongside the access token for the same reason: it IS an
// admin credential, and persisting it would leave a privileged token on disk
// for the whole impersonation session.
const ADMIN_USER_KEY = 'adminUser';
let stashedAdminToken = null;
let stashedAdminRefresh = null;

/** Call before switching into an impersonated session. */
export function stashAdminSession() {
  stashedAdminToken = getAccessToken();
  stashedAdminRefresh = getRefreshToken();
  const store = safeSession();
  try {
    // The profile is not a secret and is needed to rebuild the admin UI.
    store?.setItem(ADMIN_USER_KEY, JSON.stringify(getUser()));
  } catch {
    /* non-fatal */
  }
}

/**
 * Restores the stashed admin session. Returns false when there is nothing to
 * restore (e.g. the tab was reloaded mid-impersonation), so the caller can
 * fall back to the login screen.
 */
export function restoreAdminSession() {
  if (!stashedAdminToken && !stashedAdminRefresh) return false;
  const store = safeSession();
  let adminUser = {};
  try {
    adminUser = JSON.parse(store?.getItem(ADMIN_USER_KEY) || '{}');
  } catch {
    adminUser = {};
  }
  setAccessToken(stashedAdminToken);
  setRefreshToken(stashedAdminRefresh);
  setUser(adminUser);
  stashedAdminToken = null;
  stashedAdminRefresh = null;
  try {
    store?.removeItem(ADMIN_USER_KEY);
  } catch {
    /* non-fatal */
  }
  return true;
}
