import http from 'k6/http';
import { sleep } from 'k6';
import { BASE, login, expectOk, assertLedgerBalanced } from './lib.js';

// Correctness pass: one user, full POS cycle. Any failure here is a real bug,
// not a capacity limit.
export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    checks: ['rate==1.0'],
    http_req_failed: ['rate==0'],
  },
};

export default function () {
  const headers = login();

  expectOk(http.get(`${BASE}/auth/me`, { headers, tags: { name: 'auth/me' } }), 'auth/me');
  expectOk(http.get(`${BASE}/billing/status`, { headers, tags: { name: 'billing/status' } }), 'billing/status');

  // Create a product, then sell it — the path that touches stock and money.
  const sku = `LOAD-${Date.now()}`;
  const product = http.post(
    `${BASE}/products`,
    JSON.stringify({ name: sku, price: 1000, minPrice: 500, stock: 10, lowStockThreshold: 0 }),
    { headers, tags: { name: 'products/create' } }
  );
  expectOk(product, 'products/create');
  const productId = product.json('product.id');

  const order = http.post(
    `${BASE}/orders`,
    JSON.stringify({
      source: 'cash',
      customerPhone: '255700000000',
      customerName: 'Load Test',
      items: [{ productId, quantity: 2 }],
      clientRef: `load-${Date.now()}`,
    }),
    { headers, tags: { name: 'orders/create' } }
  );
  expectOk(order, 'orders/create');

  expectOk(http.get(`${BASE}/orders?limit=25`, { headers, tags: { name: 'orders/list' } }), 'orders/list');
  expectOk(
    http.get(`${BASE}/products/${productId}/movements`, { headers, tags: { name: 'products/movements' } }),
    'products/movements'
  );

  assertLedgerBalanced(headers);
  sleep(1);
}
