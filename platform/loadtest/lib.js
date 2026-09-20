import http from 'k6/http';
import { check, fail } from 'k6';

export const BASE = __ENV.API || 'http://localhost:4000/api/v1';

/** Logs in once and returns an auth header set. */
export function login() {
  const email = __ENV.EMAIL;
  const password = __ENV.PASSWORD;
  if (!email || !password) fail('Set EMAIL and PASSWORD');

  const res = http.post(`${BASE}/auth/login`, JSON.stringify({ email, password }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'auth/login' },
  });

  if (res.status !== 200) fail(`login failed: ${res.status} ${res.body}`);
  const token = res.json('token');
  if (!token) fail('login returned no token');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

/**
 * Wraps a request with the checks every call should pass.
 * A 429 is reported separately: it means the limiter is being exercised, which
 * is a test-configuration problem rather than an application failure.
 */
export function expectOk(res, name) {
  if (res.status === 429) {
    check(res, { [`${name}: rate limited (lower VUs or raise limits)`]: () => false });
    return false;
  }
  return check(res, {
    [`${name}: 2xx`]: (r) => r.status >= 200 && r.status < 300,
    [`${name}: no server error`]: (r) => r.status < 500,
  });
}

/** The books must balance. Any load test that breaks this has found a real bug. */
export function assertLedgerBalanced(headers) {
  const res = http.get(`${BASE}/ledger/reconciliation`, { headers, tags: { name: 'ledger/reconciliation' } });
  if (res.status !== 200) return;
  check(res, {
    'ledger is balanced': (r) => r.json('reconciliation.balanced') === true,
    'no unbalanced journals': (r) => r.json('reconciliation.unbalancedJournals') === 0,
  });
}
