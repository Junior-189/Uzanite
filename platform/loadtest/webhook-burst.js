import http from 'k6/http';
import { check } from 'k6';
import { BASE } from './lib.js';

/**
 * Provider webhook spike.
 *
 * Webhooks are unauthenticated and signature-verified, and the conversation
 * flow runs inside the request, so this is the path most likely to saturate the
 * API. Signatures are intentionally invalid here: we are measuring that
 * rejection is cheap and correct, not that processing succeeds. A 5xx means the
 * rejection path itself is broken.
 */
export const options = {
  scenarios: {
    burst: {
      executor: 'constant-arrival-rate',
      rate: 200,
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
  thresholds: {
    // Rejection must be fast; it happens before any database work.
    'http_req_duration{name:webhook}': ['p(95)<300'],
    // No server errors: an invalid signature is a 401, never a 500.
    'http_req_failed{expected_response:true}': ['rate<0.01'],
  },
};

export default function () {
  const res = http.post(
    `${BASE}/payments/webhook/clickpesa`,
    JSON.stringify({ orderReference: `burst-${__VU}-${__ITER}`, status: 'success', amount: 1000 }),
    {
      headers: { 'Content-Type': 'application/json', 'X-ClickPesa-Signature': 'deadbeef' },
      tags: { name: 'webhook' },
    }
  );

  check(res, {
    'invalid signature rejected, not 500': (r) => r.status === 401 || r.status === 404 || r.status === 429,
    'never a server error': (r) => r.status < 500,
  });
}
