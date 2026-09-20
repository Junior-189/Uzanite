# UZANITE — Deployment & Operations

This is the operational reference for running UZANITE in production. It covers
required configuration, container deployment, background workers, migrations,
and backups.

## 1. Requirements

- Node.js 20+ (or Docker)
- MongoDB 7 (replica set recommended — required for transactions; Atlas qualifies)
- Redis 7 (recommended; enables durable BullMQ queues)
- A reverse proxy / load balancer terminating TLS

## 2. Required environment

See `.env.example` for the full list. Minimum to boot:

| Variable | Notes |
|---|---|
| `MONGODB_URI` | Required in production. |
| `JWT_SECRET` | Required, ≥32 chars, non-placeholder. Server refuses to start otherwise. |
| `NODE_ENV` | `production`. |
| `APP_URL` | Public base URL (used in emails and signed file URLs). |

Strongly recommended:

| Variable | Notes |
|---|---|
| `REDIS_URL` | Enables BullMQ; otherwise the in-process queue is used. |
| `ENCRYPTION_KEY` | Required to store per-tenant Meta tokens. |
| `STORAGE_SIGNING_SECRET` | Required for private local storage signed URLs. |
| `STORAGE_PROVIDER` / S3 vars | `s3` for Cloudflare R2 / AWS S3. |
| `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` | Enables the Meta webhook. |
| `METRICS_TOKEN` | Protects `/metrics`. |

## 3. Docker (recommended)

```bash
cp .env.example .env      # fill in the values
docker compose up -d --build
```

This starts:
- `app` — API + admin SPA (port 3000), `RUN_WORKER_IN_PROCESS=false`
- `worker` — background jobs (`node src/worker.js`)
- `mongo` — MongoDB 7
- `redis` — Redis 7

The API is at `http://localhost:3000`; health at `/health`, readiness at `/ready`,
metrics at `/metrics`.

## 4. Non-Docker process model

Run the API and the worker as separate processes sharing MongoDB + Redis:

```bash
# API (in-process workers disabled)
RUN_WORKER_IN_PROCESS=false npm start

# Worker
npm run worker
```

On a single small instance you may instead run only the API with
`RUN_WORKER_IN_PROCESS=true` and no separate worker.

## 5. Database migrations

1. Reconcile indexes (safe to re-run):
   ```bash
   MONGODB_URI="$MONGODB_URI" node scripts/migrate-phase1-indexes.js
   ```
2. Phase 0 plaintext-password cleanup (one-off):
   ```bash
   MONGODB_URI="$MONGODB_URI" node scripts/migrate-phase0.js
   ```
3. Bootstrap the first super admin:
   ```bash
   BOOTSTRAP_ADMIN_EMAIL=you@example.com BOOTSTRAP_ADMIN_PASSWORD='Str0ng!Passw0rd' \
     MONGODB_URI="$MONGODB_URI" npm run seed:admin
   ```

## 6. Backups & restore

```bash
# Backup (requires MongoDB Database Tools)
MONGODB_URI="$MONGODB_URI" BACKUP_DIR=/var/backups/uzanite scripts/backup-mongo.sh

# Restore (add --drop to overwrite existing collections)
MONGODB_URI="$MONGODB_URI" scripts/restore-mongo.sh /var/backups/uzanite/uzanite-<stamp>.archive.gz --drop
```

Recommendation: run the backup on a schedule (cron) and store archives off-host
(object storage with lifecycle rules). Test a restore into a staging database
periodically.

## 7. Observability

- Structured JSON logs (Pino) with request ids (`X-Request-Id`).
- `/health` — liveness; `/ready` — MongoDB + Redis readiness.
- `/metrics` — Prometheus text (process, Mongo state, queue depths). Protect
  with `METRICS_TOKEN`.
- `/api/admin/queues` and `/api/admin/queues/dead-letters` — operator queue view.

## 8. Scaling recommendations

**Statelessness.** With `REDIS_URL` set, the API holds no cross-request state that
matters: login lockouts, bot-pause flags, feature-flag cache invalidation, rate
limits, and queues are all shared via Redis. You can run multiple API replicas
behind a load balancer:

```bash
docker compose up -d --scale app=3
```

Without Redis the API uses in-process state and must run as a **single** instance.

**When to scale what**

| Symptom | Action |
|---|---|
| API CPU/latency rising, p95 up | Add API replicas (stateless). |
| Queue depth (`uzanite_queue_jobs`) or job latency rising | Add worker replicas (`--scale worker=N`). |
| WhatsApp sends backing up | Add workers; the outbound queue is the throttle. |
| Mongo slow queries / high read load | Add indexes first (run the index migration), then a read replica. |
| Dashboard/report latency | Use `/api/analytics` (aggregation); consider a nightly read model. |
| Broadcasts slow | Increase worker concurrency for the `broadcast` queue (carefully — WhatsApp bans). |

**Backpressure.** Rate limits protect the API; the outbound WhatsApp queue
serializes sends to respect provider limits. Prefer scaling workers over
increasing send rate.

**Data growth.** Mongo Atlas can scale vertically first; add a read replica for
read-heavy reporting. Sharding is intentionally out of scope.

## 9. Alerting runbook

Alert on the metrics exposed at `/metrics` (scrape with `METRICS_TOKEN`).

| Signal | Suggested threshold | First response |
|---|---|---|
| `uzanite_up` | `!= 1` for 2m | Instance down; check container logs / restart. |
| `uzanite_mongodb_ready_state` | `!= 1` for 1m | Mongo/Atlas connectivity; check URI + network. |
| `/ready` returns 503 | 2 consecutive | Mongo or Redis down; check both. |
| `uzanite_queue_jobs{state="failed"}` | `> 0` sustained | Inspect `/api/admin/queues/dead-letters`. |
| `uzanite_http_request_duration_ms_sum` rate | p95 climbing | Scale API; check slow queries. |
| `uzanite_payments_succeeded_total` flat while orders rise | — | Payment provider/webhook issue. |
| `uzanite_whatsapp_messages_sent_total` flat | — | WhatsApp account/queue issue; check `/api/whatsapp/status`. |

**Common failure modes**
- **Meta webhook 401** — `META_APP_SECRET` mismatch.
- **Webhook 503** — Meta credentials not configured; set the secret + verify token.
- **Jobs not processing** — worker not running (Redis deployment) or Redis down.
- **Signed file 403** — expired signed URL (increase `STORAGE_URL_TTL_SECONDS`) or missing `STORAGE_SIGNING_SECRET`.
- **All tenants disconnected (legacy)** — Baileys is a singleton; run it on one instance only.

## 10. Zero-downtime notes

- The API is stateless; run multiple replicas behind a load balancer.
- Run the worker separately and scale independently.
- WhatsApp session state for Meta is stateless (webhook); Baileys (legacy) keeps
  local session files and should run as a singleton.
- Run `scripts/migrate-phase1-indexes.js` before rolling out new code that
  depends on new indexes.
