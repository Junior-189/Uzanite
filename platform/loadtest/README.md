# Load tests

**Written for: engineers sizing or changing the platform.**

No load test existed before M13, which meant every statement about capacity —
including the ones in the audit — was inference from reading code. These are
runnable so the numbers can be facts instead.

## Run

```bash
# Install k6: https://grafana.com/docs/k6/latest/set-up/install-k6/
export API=https://staging-api.example.com/api/v1
export EMAIL=loadtest@example.com
export PASSWORD='...'

k6 run loadtest/smoke.js        # 1 VU, correctness under no load
k6 run loadtest/steady.js       # sustained mixed traffic
k6 run loadtest/webhook-burst.js  # provider webhook spike
k6 run loadtest/soak.js         # 30 min, looks for leaks and drift
```

**Never run these against production.** They create orders and payments.

## What each test asserts

| Test | Simulates | Fails when |
|---|---|---|
| `smoke.js` | One user doing a full POS cycle | Any request errors, or the ledger does not balance afterwards |
| `steady.js` | 50 VUs: browse-heavy with writes mixed in | p95 > 800ms, error rate > 1%, or any 5xx |
| `webhook-burst.js` | 200 webhooks/s arriving at once | Any 5xx, or a duplicate payment is created |
| `soak.js` | 20 VUs for 30 minutes | Latency drifts upward (leak), or errors appear late |

## Interpreting results

The thresholds are starting points, not truth. Record actual numbers per
release in `loadtest/RESULTS.md` so regressions are visible. Watch alongside:

- `uzanite_db_pool` — pool saturation is the first real ceiling
- `uzanite_cache_outcomes_total` — a collapsing hit rate explains latency
- `uzanite_rate_limit_outcomes_total{result="blocked"}` — you are testing the
  limiter, not the app
- `uzanite_outbox_oldest_pending_seconds` — the worker falling behind
