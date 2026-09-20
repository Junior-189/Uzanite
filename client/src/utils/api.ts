import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { getT } from '../context/LangContext';
import { translateApiMessage } from './translateApiMessage';
import { clearSession, getAccessToken, getRefreshToken, saveSession, setAccessToken } from './tokenStore';

const BASE_URL: string = (import.meta.env.VITE_API_URL as string) || '/api';

/**
 * Network policy for this client, tuned for the networks it actually runs on.
 *
 * Tanzanian mobile data is frequently slow and intermittent rather than simply
 * absent. The previous configuration was a flat 15s timeout with no retry, so a
 * single 3G stall surfaced to the user as a hard failure on an operation that
 * would have succeeded a moment later.
 *
 *  - Reads (GET) get a longer timeout and are retried with jittered backoff.
 *    They are idempotent, so retrying is always safe.
 *  - Writes are NEVER retried automatically. A retried order or payment can
 *    duplicate money or stock. The server supports idempotency keys, and a
 *    deliberate retry belongs to the caller that can supply one.
 *  - A 429 is honoured via the server's `Retry-After` header rather than being
 *    retried blindly.
 */
const READ_TIMEOUT_MS = 30000;
const WRITE_TIMEOUT_MS = 20000;
const MAX_READ_RETRIES = 2;

type RetryConfig = InternalAxiosRequestConfig & { _retried?: boolean; _readAttempts?: number };

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: WRITE_TIMEOUT_MS,
});

const isReadMethod = (method?: string): boolean => ['get', 'head', 'options'].includes((method || 'get').toLowerCase());
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential backoff with full jitter, so many clients do not retry in lockstep. */
const backoffMs = (attempt: number): number => Math.floor(Math.random() * Math.min(500 * 2 ** (attempt - 1), 4000));

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  if (isReadMethod(config.method) && !config.timeout) config.timeout = READ_TIMEOUT_MS;
  return config;
});

let refreshing: Promise<string | null> | null = null;

// Exchanges the stored refresh token for a new access token (single-flight, so
// a burst of 401s from parallel requests produces exactly one refresh).
async function refreshSession(): Promise<string | null> {
  if (refreshing) return refreshing;
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  refreshing = (async () => {
    try {
      const res = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken }, { timeout: WRITE_TIMEOUT_MS });
      const data = res.data;
      if (data?.success && data.token) {
        saveSession({ token: data.token, refreshToken: data.refreshToken ?? refreshToken });
        return data.token as string;
      }
      return null;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function hardLogout(): void {
  clearSession();
  // Capacitor has no server-side routing, so a path redirect lands on a blank
  // screen. Previously the native app did nothing at all here and the user was
  // stranded on an authenticated screen that could no longer load data.
  const isCapacitor = typeof window !== 'undefined' && window.Capacitor !== undefined;
  if (isCapacitor) window.location.replace('index.html#/login');
  else window.location.assign('/admin/login.html');
}

api.interceptors.response.use(
  (res) => {
    if (res.data?.message) {
      try {
        res.data.message = translateApiMessage(res.data.message, getT());
      } catch {
        /* translation is best-effort */
      }
    }
    return res.data;
  },
  async (err: AxiosError) => {
    const status = err.response?.status;
    const original = (err.config ?? {}) as RetryConfig;
    const url = original.url || '';

    // ── Transparently refresh an expired access token once, then retry.
    if (status === 401 && !original._retried && !url.includes('/auth/refresh') && !url.includes('/auth/login')) {
      const newToken = await refreshSession();
      if (newToken) {
        original._retried = true;
        original.headers.set('Authorization', `Bearer ${newToken}`);
        return api(original);
      }
      hardLogout();
    }

    // ── Rate limited: surface the server's Retry-After so the UI can say when.
    if (status === 429) {
      const headers = (err.response?.headers ?? {}) as Record<string, unknown>;
      const responseData = (err.response?.data ?? {}) as { error?: string };
      const retryAfter = Number(headers['retry-after']) || undefined;
      return Promise.reject({
        error: 'rate_limited',
        retryAfter,
        message:
          responseData.error ||
          (retryAfter
            ? `Too many requests. Try again in ${retryAfter} second(s).`
            : 'Too many requests. Please slow down.'),
      });
    }

    // ── Retry idempotent reads on transport failures and 5xx.
    const transportFailure = !err.response;
    const retryableStatus = typeof status === 'number' && status >= 500;
    if (isReadMethod(original.method) && (transportFailure || retryableStatus)) {
      original._readAttempts = (original._readAttempts || 0) + 1;
      if (original._readAttempts <= MAX_READ_RETRIES) {
        await sleep(backoffMs(original._readAttempts));
        return api(original);
      }
    }

    // ── Offline. Checked AFTER retries: navigator.onLine reports true on a
    // connected-but-dead network, which is the common failure mode here, so it
    // is a hint for the message rather than a reason to stop trying.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return Promise.reject({
        error: 'offline',
        offline: true,
        message: 'No internet connection. Your changes will sync when you are back online.',
      });
    }

    if (transportFailure) {
      return Promise.reject({
        error: 'network',
        message: 'The network is slow or unavailable. Please try again.',
      });
    }

    const data = (err.response?.data ?? err) as { error?: unknown; [key: string]: unknown };
    if (data.error) {
      try {
        data.error = translateApiMessage(data.error as string, getT());
      } catch {
        /* best-effort */
      }
    }
    return Promise.reject(data);
  }
);

export { setAccessToken };
export default api;
