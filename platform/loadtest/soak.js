import http from 'k6/http';
import { sleep } from 'k6';
import { BASE, login, expectOk, assertLedgerBalanced } from './lib.js';

/**
 * Soak test: moderate load held long enough for leaks and drift to appear.
 *
 * What this is looking for, which a short test cannot show: connection-pool
 * exhaustion, memory growth, cache hit-rate collapse, and the outbox falling
 * progressively behind. Compare the first and last five minutes of latency —
 * a rising trend is the finding, not the absolute number.
 */
export const options = {
  stages: [
    { duration: '2m', target: 20 },
    { duration: '26m', target: 20 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    http_req_failed: ['rate<0.01'],
  },
};

export function setup() {
  return { headers: login() };
}

export default function (data) {
  const { headers } = data;
  expectOk(http.get(`${BASE}/orders?limit=25`, { headers, tags: { name: 'orders/list' } }), 'orders/list');
  expectOk(http.get(`${BASE}/products?limit=25`, { headers, tags: { name: 'products/list' } }), 'products/list');
  sleep(3);
}

export function teardown(data) {
  assertLedgerBalanced(data.headers);
}
