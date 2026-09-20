import http from 'k6/http';
import { sleep } from 'k6';
import { BASE, login, expectOk, assertLedgerBalanced } from './lib.js';

// Sustained mixed traffic, weighted the way a real tenant behaves: mostly
// reads (browsing the catalogue, checking orders) with writes mixed in.
export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 50 },
    { duration: '2m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    // Sized for a low-bandwidth market: the server must be fast because the
    // network will not be.
    http_req_duration: ['p(95)<800', 'p(99)<2000'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  return { headers: login() };
}

export default function (data) {
  const { headers } = data;
  const roll = Math.random();

  if (roll < 0.5) {
    expectOk(http.get(`${BASE}/products?limit=25`, { headers, tags: { name: 'products/list' } }), 'products/list');
  } else if (roll < 0.8) {
    expectOk(http.get(`${BASE}/orders?limit=25`, { headers, tags: { name: 'orders/list' } }), 'orders/list');
  } else if (roll < 0.9) {
    expectOk(http.get(`${BASE}/notifications?limit=20`, { headers, tags: { name: 'notifications/list' } }), 'notifications/list');
  } else {
    // Writes: exercises the stock path, the outbox and the usage counters.
    expectOk(
      http.post(
        `${BASE}/products`,
        JSON.stringify({ name: `S-${__VU}-${__ITER}`, price: 500, stock: 1, lowStockThreshold: 0 }),
        { headers, tags: { name: 'products/create' } }
      ),
      'products/create'
    );
  }

  sleep(Math.random() * 2);
}

export function teardown(data) {
  // A load test that corrupts the books has found something important.
  assertLedgerBalanced(data.headers);
}
