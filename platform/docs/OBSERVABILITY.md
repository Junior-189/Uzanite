# UZANITE Observability & Alerting

This document is the operational reference for logs, tracing, error tracking and
metrics, and the recommended alerts for the most important failure modes.

## 1. Logs (structured, correlated)

Both the API and worker log JSON via Pino. Every API log line carries correlation
fields sourced from the request context:

| Field | Meaning |
|---|---|
| `requestId` | `X-Request-Id` (echoed to the client) |
| `traceId` | W3C trace id (see §3) |
| `tenantId` | active tenant, once resolved by the guards |
| `userId` | authenticated user id |

Sensitive fields (`authorization`, cookies, passwords, refresh tokens) are
redacted. To debug a client-visible error, take the `requestId`/`traceId` from
the error response body and grep the logs.

## 2. Error tracking

The API (`ErrorTrackerService`) and worker (`WorkerErrorTracker`) submit
server-side errors to a Sentry-compatible endpoint when `SENTRY_DSN` is set
(Sentry Store API over HTTPS — no SDK dependency). When unset, errors are logged
only.

- API: all `5xx`/unhandled exceptions are captured with path, method, status,
  tenant, user, request id and trace id.
- Worker: outbox events that exhaust their attempts are captured.

Configure: `SENTRY_DSN=https://<key>@<host>/<projectId>` and `APP_RELEASE=<git sha>`.

## 3. Tracing (W3C Trace Context)

- Incoming `traceparent` headers are honoured; otherwise a new trace is started.
- The API echoes `traceparent` on every response, so callers can correlate.
- Internal spans are recorded via `TracingService.startSpan(name)` and their
  durations are exported as the Prometheus histogram `uzanite_span_duration_seconds`.
- Optional OTLP/HTTP export: set `OTEL_EXPORTER_OTLP_ENDPOINT` (e.g. an
  OpenTelemetry Collector) and `OTEL_SERVICE_NAME`. Spans are batched and posted
  as OTLP JSON to `<endpoint>/v1/traces`.

## 4. Metrics

`GET /api/v1/metrics` (protected by `METRICS_TOKEN`; denied in production when
unset) exposes Prometheus metrics:

| Metric | Type | Meaning |
|---|---|---|
| `uzanite_http_requests_total{method,status}` | counter | request rate / error rate |
| `uzanite_http_request_duration_seconds{method}` | histogram | latency |
| `uzanite_span_duration_seconds{name}` | histogram | internal span latency |
| `uzanite_payment_webhook_outcomes_total{provider,result}` | counter | webhook results (`succeeded`, `failed`, `duplicate`, `unmatched`, `invalid_signature`, `unknown_provider`, `error`) |
| `uzanite_outbox_events{status}` | gauge | outbox pending/processing/published/failed |
| `uzanite_whatsapp_messages{status}` | gauge | outbound WhatsApp by status |
| `uzanite_operator_actions_unread{type}` | gauge | unread `payment_awaiting_order_approval` notifications |
| `uzanite_outbox_oldest_pending_seconds` | gauge | age of the oldest pending outbox event |
| `uzanite_rate_limit_outcomes_total{prefix,result}` | counter | limiter outcomes. `result="error"` means the limiter itself failed and the request was **allowed through** (fail-open) |
| `uzanite_cache_outcomes_total{cache,result}` | counter | read-through cache hits/misses (`membership`, `billing`, `feature_flags`) |
| `uzanite_provider_calls_total{provider,operation,result}` | counter | outbound provider calls. `result` is an HTTP status, `timeout`, `transport_error` or `circuit_open` |
| `uzanite_provider_call_duration_seconds{provider,operation}` | histogram | outbound provider latency |
| `uzanite_db_pool{state}` | gauge | Prisma pool: `open`, `busy`, `idle`, `queries_active`, `queries_waiting` |
| `uzanite_deprecated_route_calls_total{route}` | counter | calls to routes marked `@ApiDeprecated` — removal is only safe at zero |

## 5. Recommended alerts

| Severity | Condition | Why / action |
|---|---|---|
| Critical | `uzanite_operator_actions_unread{type="payment_awaiting_order_approval"} > 0` for 15m | Money received for an unapproved order — approve/settle it |
| Critical | Any `ledger_unbalanced` in-app notification, or reconciliation `unbalancedJournals > 0` | Double-entry invariant violated — finance integrity at risk |
| Critical | `uzanite_payment_webhook_outcomes_total{result="error"}` rate spike | Webhook processing failures — payments may be delayed |
| High | `uzanite_outbox_events{status="failed"} > 0` | Events permanently failed after retries |
| High | `uzanite_outbox_oldest_pending_seconds > 300` | Publisher stalled / workers down |
| High | `uzanite_whatsapp_messages{status="failed"}` increasing | WhatsApp delivery failing (account/token/quality) |
| High | `histogram_quantile(0.99, rate(uzanite_http_request_duration_seconds_bucket[5m])) > 2` | API latency degradation |
| High | `rate(uzanite_http_requests_total{status=~"5.."}[5m])` elevated | Server errors |
| Medium | `uzanite_payment_webhook_outcomes_total{result="invalid_signature"}` > 0 | Misconfigured provider secret or spoofing attempt |
| Medium | `uzanite_http_requests_total{status="429"}` sustained | Rate-limit pressure / abuse |
| **Critical** | `rate(uzanite_rate_limit_outcomes_total{result="error"}[5m]) > 0` | **The limiter is failing open.** Redis is unreachable, so the API is currently unprotected against abuse |
| High | `uzanite_db_pool{state="queries_waiting"} > 0` for 5m | Connection pool saturated. Raise `connection_limit` or add PgBouncer — this is the first real capacity ceiling |
| High | `rate(uzanite_provider_calls_total{result="circuit_open"}[5m]) > 0` | A payment provider is failing; the breaker is shedding load. Customers cannot pay by that method |
| High | `rate(uzanite_provider_calls_total{result="timeout"}[5m])` elevated | Provider degraded. Requests are bounded, so this shows as failed payments rather than an outage |
| Medium | cache hit ratio `< 0.5` on `membership` or `billing` | Caching is not working (Redis evictions, or invalidation churn). Expect database load and latency to rise |
| Medium | `uzanite_deprecated_route_calls_total` non-zero near a sunset date | Clients still call an endpoint due for removal. Do not remove it yet |
| Low | `uzanite_db_pool{state="busy"} / uzanite_db_pool{state="open"} > 0.8` | Pool trending toward saturation; size it before it bites |

The worker runs a reconciliation sweep every `RECONCILE_INTERVAL_MS` (default 15
min) that raises a critical `ledger_unbalanced` notification per tenant
(daily-deduped) when any journal does not balance.

## 5b. What is still NOT instrumented

Stated so nobody assumes coverage that does not exist:

- **Per-replica metrics only.** Every counter is local to one process. Scaling out
  makes the raw numbers less meaningful, not more — aggregate with Prometheus
  federation or a remote-write target before relying on them.
- **No client-side telemetry.** There is no Core Web Vitals or JavaScript error
  reporting from the admin UI, so a broken frontend on a low-end Android device
  is invisible here.
- **No business KPIs.** Orders per tenant, payment success rate and WhatsApp
  delivery rate are all derivable from the database but are not exported.
- **No dashboards committed.** The metrics exist and the alerts are specified;
  wiring them to a Prometheus scrape and a notification channel is deployment
  work that has not been done. Instrumentation without consumption is cost
  without benefit.

## 6. Readiness & health

- `GET /api/v1/health` — liveness.
- `GET /api/v1/ready` — readiness (Postgres + Redis).
- Worker: `Outbox publisher started`, `WhatsApp outbound sender started`, and the
  reconciliation scheduler log line confirm background jobs are running.
