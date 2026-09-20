# UZANITE Platform — Deployment Runbook

Operational guide for deploying the NestJS + PostgreSQL platform (`platform/`)
that is progressively replacing the legacy Express + MongoDB app (repo root).

> **Current production reality.** Production still serves the **legacy** app
> (`server.js`, defined in `render.yaml`). The platform is deployed alongside it
> and the client routes a domain to the platform only when the cutover flag is
> enabled. Nothing in this runbook deletes the legacy app — see
> [`CUTOVER_PLAYBOOK.md`](./CUTOVER_PLAYBOOK.md) for the staged switch-over and
> [`CUTOVER_COVERAGE.md`](./CUTOVER_COVERAGE.md) for what is migrated.

---

## 1. Topology

```
                         ┌──────────────────────────────┐
        browser / PWA ──▶ │  edge (nginx / ALB / CDN)     │
                         │  TLS · gzip · edge rate limit │
                         └───────────────┬──────────────┘
                                         │
                 ┌───────────────────────┴────────────────────────┐
                 │                                                │
        /api/v1/* (migrated)                            everything else
                 ▼                                                ▼
     ┌───────────────────────┐                     ┌────────────────────────┐
     │ platform API (NestJS) │                     │ legacy Express + Mongo │
     │ :4000 prefix /api/v1  │                     │ :3000  /api /upload …  │
     └───────┬───────┬───────┘                     └────────────────────────┘
             │       │
       ┌─────▼──┐  ┌─▼──────────────┐        ┌───────────────────────────────┐
       │Postgres│  │ Redis          │◀──────▶│ platform worker (BullMQ)      │
       │ (RLS)  │  │ rate/queue/…   │        │ outbox · retention · reconcile│
       └────────┘  └────────────────┘        └───────────────────────────────┘
             ▲
       private uploads (signed URLs) ─── local volume, or object storage (S3/R2)
```

Both stacks share the same `JWT_SECRET` (HS256) and identity aliases, so a token
issued by one authenticates against the other during the transition.

---

## 2. Service inventory

| Component | Source | Runs as | Notes |
|---|---|---|---|
| Platform API | `platform/apps/api` (`Dockerfile.api`) | non-owner DB role | Stateless; scale horizontally behind the proxy |
| Platform worker | `platform/apps/worker` (`Dockerfile.worker`) | non-owner DB role | Consumes Redis queues; runs outbox poller, retention, reconciliation |
| PostgreSQL 16 | managed or `docker-compose.yml` | — | System of record; RLS enforced for the app role |
| Redis 7 | managed or compose | — | Rate limits, lockouts, BullMQ queues, read-through cache |
| Private storage | local volume or S3/R2 | — | Bytes served only via short-lived signed URLs |
| Edge proxy | `platform/gateway/nginx.conf` | — | Strangler routing + TLS + edge limits |
| Client SPA | `client/` | static | Netlify (`client/netlify.toml`) or served by the proxy |

---

## 3. Prerequisites

- Node 20+, pnpm 9 (`corepack enable`) for local builds.
- PostgreSQL 16 and Redis 7 reachable from the API/worker.
- A secret manager for `JWT_SECRET`, `ENCRYPTION_KEY`, `STORAGE_SIGNING_SECRET`,
  `BACKUP_ENCRYPTION_PASSPHRASE` (never commit these).
- TLS terminated at the edge; `TRUST_PROXY_HOPS` set to match the number of
  proxies in front of the API.

---

## 4. Environment matrix

Copy `platform/.env.example` → `platform/.env` and populate. Canonical variables:

### 4.1 Core

| Variable | Required (prod) | Purpose |
|---|---|---|
| `NODE_ENV=production` | yes | TLS assumptions, docs disabled |
| `PORT=4000` | yes | API listen port |
| `DATABASE_URL` | yes | **App role** (`uzanite_app`) — RLS-enforced pool URL |
| `REDIS_URL` | yes | Rate limits, lockouts, queues |
| `RLS_ENABLED=true` | yes | Requires the non-owner role to be meaningful |
| `APP_URL` / `PUBLIC_APP_URL` | yes | Links in outbound email and redirects |

### 4.2 Auth / crypto

| Variable | Required | Purpose |
|---|---|---|
| `JWT_SECRET` | yes | ≥32 chars, `openssl rand -hex 32`; shared with legacy during cutover |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL_DAYS` | recommended | Session lifetimes |
| `JWT_KEYS` / `JWT_ACTIVE_KID` | optional | `kid`-based key rotation (zero-downtime) |
| `ENCRYPTION_KEY` | yes | Encrypts per-tenant Meta tokens; **not recoverable from a DB backup** |

### 4.3 Database guard rails & proxy

| Variable | Required | Purpose |
|---|---|---|
| `DB_STATEMENT_TIMEOUT_MS` / `DB_LOCK_TIMEOUT_MS` / `DB_IDLE_TX_TIMEOUT_MS` | yes | Applied on the server, verified at boot |
| `TRUST_PROXY_HOPS` | yes | **Security-critical** — must equal the proxy chain length, or rate-limit/lockout buckets collapse |
| `CORS_ORIGINS` | yes | Explicit https origins |
| `CACHE_MEMBERSHIP_TTL` / `CACHE_BILLING_TTL` | optional | Read-through cache TTLs (seconds; 0 disables) |
| `PROVIDER_TIMEOUT_MS` | optional | Outbound HTTP ceiling (ms) |

### 4.4 Storage

| Variable | Required | Purpose |
|---|---|---|
| `STORAGE_PROVIDER=local` | yes | Or `s3`/`r2` when implemented |
| `STORAGE_LOCAL_DIR` | yes | Default `private_uploads_platform`; mount a volume here |
| `STORAGE_SIGNING_SECRET` | yes | Signs download URLs; falls back to `ENCRYPTION_KEY` → `JWT_SECRET` |
| `STORAGE_URL_TTL_SECONDS` | optional | Signed-URL lifetime (default 900) |
| `MAX_UPLOAD_BYTES` | optional | Upload ceiling (default 5242880) |

### 4.5 Integrations & observability

| Variable | Required | Purpose |
|---|---|---|
| `SMTP_*`, `EMAIL_FROM` | for email | Password resets, staff reset notices |
| `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_GRAPH_VERSION`, `WHATSAPP_FLOW_MODE` | for WhatsApp | Messaging endpoints disabled without them |
| `RETENTION_*` | recommended | PDPA retention sweeps (worker) |
| `METRICS_TOKEN` | yes (prod) | Protects `GET /api/v1/metrics`; denied when unset |
| `SENTRY_DSN`, `APP_RELEASE` | optional | Error tracking |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME` | optional | OTLP span export |
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` | seeding only | Strong password; changed on first login |
| `BACKUP_ENCRYPTION_PASSPHRASE`, `BACKUP_RETENTION_DAYS` | yes | Used by `scripts/backup-postgres.sh` |

`platform/docker-compose.yml` additionally needs `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `POSTGRES_DB`, `REDIS_PASSWORD`, and `APP_DB_PASSWORD`.

---

## 5. Provisioning

### 5.1 PostgreSQL + RLS

1. Create the database and an **owner** role (migrations/DDL only).
2. Create the **non-owner app role** and grant DML:

   ```bash
   psql "$OWNER_DATABASE_URL" -f platform/apps/api/prisma/sql/ci-roles.sql
   # then set a real password and store it in the secret manager:
   psql "$OWNER_DATABASE_URL" -c "ALTER ROLE uzanite_app PASSWORD '…';"
   ```

   The app role is `NOBYPASSRLS`; migration `0012` uses `FORCE ROW LEVEL
   SECURITY`, so policies apply even for a table owner.
3. Apply the server-level guard rails (`statement_timeout`, `lock_timeout`,
   `idle_in_transaction_session_timeout`) via `ALTER ROLE` or the compose
   `command:` block.
4. Point `DATABASE_URL` at `uzanite_app`; keep a separate owner URL **only** for
   `prisma migrate deploy` and seeding.

### 5.2 Redis

Require a password (`requirepass`) and never expose it publicly. Redis holds
rate limits, lockouts, and queues — it is rebuilt from empty after a restart
with no data loss (the outbox lives in PostgreSQL).

### 5.3 Storage

Mount a persistent volume at `<cwd>/private_uploads_platform` (compose does this
via the `uploads` volume). For **multiple API replicas across hosts**, a local
volume is not shared — use object storage with replication and switch
`STORAGE_PROVIDER`. Never serve the upload directory directly; bytes are only
fetched through the signed URL endpoint.

---

## 6. Build & release

The API image has three stages (`Dockerfile.api`): `build` (compiles contracts,
messaging, Prisma client and API), `migrate` (keeps the Prisma CLI), and
`runtime` (pruned, non-root, `tini` as PID 1). The worker has its own image.

Local build check:

```bash
cd platform
pnpm install --frozen-lockfile
pnpm --filter @uzanite/contracts build
pnpm --filter @uzanite/api exec prisma generate
pnpm -r typecheck
```

Release order:

1. **Backup** the database (see §8) before any migration.
2. Run the **one-shot migrate job** with the owner URL:
   `npx prisma migrate deploy` (compose service `migrate`).
3. Roll out the **API** replicas, then the **worker**.
4. Roll out the **client** only after the API is healthy.

---

## 7. Migrations & rollback

Prisma migrations are **forward-only** (no down migrations). The rollback
strategy is therefore: restore from a verified backup or PITR point.

| Situation | Action |
|---|---|
| A migration fails mid-way | Stop, do not retry blindly. Restore from the pre-deploy backup (or PITR), fix the migration, redeploy. |
| A release must be reverted | Redeploy the previous **image** (schema stays). Only restore the DB if the release's migration was destructive/incorrect. |
| Schema drifted from `schema.prisma` | The CI drift gate (`scripts/ci-local.sh`) fails the build. Fix the migration, never edit an applied one. |

Before every production migration:

```bash
DATABASE_URL="$OWNER_DATABASE_URL" \
BACKUP_DIR=/var/backups/uzanite \
BACKUP_ENCRYPTION_PASSPHRASE="$UZANITE_BACKUP_PASSPHRASE" \
platform/scripts/backup-postgres.sh
```

See [`platform/docs/DISASTER_RECOVERY.md`](../platform/docs/DISASTER_RECOVERY.md)
for RPO/RTO targets and PITR setup.

---

## 8. Reverse proxy routing

`platform/gateway/nginx.conf` is the reference. Routing table:

| Request path | Upstream |
|---|---|
| `/api/v1/auth/(login\|register\|forgot-password\|reset-password\|accept-invite)` | platform (edge auth rate limit) |
| `/api/v1/(payments\|whatsapp)/webhook` | platform (webhook rate limit) |
| `/api/v1/*` | platform |
| `/api/v1/health`, `/api/v1/ready`, `/api/v1/metrics` | platform (metrics token-gated) |
| everything else (`/api/*` without `v1`, `/webhook`, `/uploads`, `/admin`, `/`) | legacy |

Notes:

- Keep `X-Real-IP` / `X-Forwarded-For` set and `TRUST_PROXY_HOPS` **in sync**;
  otherwise every request shares one rate-limit/lockout bucket.
- The API is stateless (JWT + shared Redis) — no session affinity. Do **not**
  add `ip_hash`.
- Edge rate limits sit **above** the in-app limits so the app stays
  authoritative and the edge only absorbs volumetric floods.
- `client_max_body_size` must exceed `MAX_UPLOAD_BYTES` (nginx default 8m vs 5MB
  uploads).

---

## 9. Worker

The worker (`platform/apps/worker`, entry `dist/main.js`) runs:

- **Outbox publisher** — delivers `email.send` and other side effects.
- **Retention sweep** — PDPA (`RETENTION_*`).
- **Ledger reconciliation** — `RECONCILE_INTERVAL_MS` (default 15 min).

It needs `DATABASE_URL` (app role), `REDIS_URL`, and the same secrets as the
API. Scale worker replicas independently; the outbox uses leases so multiple
workers are safe. The worker has no HTTP health endpoint — liveness is the
process; alert on outbox backlog and error-tracker events instead
(see [`platform/docs/OBSERVABILITY.md`](../platform/docs/OBSERVABILITY.md)).

---

## 10. Health, readiness & observability

| Endpoint | Meaning |
|---|---|
| `GET /api/v1/health` | Liveness |
| `GET /api/v1/ready` | Readiness (DB/Redis reachable) |
| `GET /api/v1/metrics` | Prometheus (requires `x-metrics-token` or `?token=`) |

Both API and worker emit correlated JSON logs (`requestId`, `traceId`,
`tenantId`, `userId`). Wire alerts per OBSERVABILITY.md (error rate, p95
latency, outbox backlog, 429 spikes, readiness failures).

---

## 11. Client deployment

The SPA is static (`client/`). Configure at build time:

| Variable | Purpose |
|---|---|
| `VITE_API_URL=/api` | Legacy base (same origin behind the proxy) |
| `VITE_PLATFORM_API_URL=/api/v1` | Platform base for migrated domains |
| `VITE_API_V1=false` | Master cutover switch. `false`/unset = all traffic stays legacy |
| `VITE_API_V1_DOMAINS=` | Optional comma-separated subset (`auth,billing`). When set, **only** these domains route to the platform |

Build:

```bash
cd client
npm install
VITE_API_V1=true VITE_API_V1_DOMAINS=auth,billing npm run build
```

Because these are compile-time, changing the cutover scope is a client rebuild +
redeploy (fast, static). Roll back a domain by removing it from
`VITE_API_V1_DOMAINS`, or roll back everything with `VITE_API_V1=false`.

---

## 12. Post-deploy verification

```bash
# Liveness / readiness
curl -fsS https://<host>/api/v1/health
curl -fsS https://<host>/api/v1/ready

# Migrated domain reachable through the proxy (expect 401, not 502/404)
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/api/v1/auth/me

# Shadow-compare legacy vs platform shapes before widening the cutover
LEGACY_BASE=https://<host>/api \
PLATFORM_BASE=https://<host>/api/v1 \
API_TOKEN=<token> \
node platform/scripts/api-parity-check.mjs
```

Checklist: readiness green · no 5xx spike · logs correlated · metrics scraped ·
outbox draining · a real login and one write per enabled domain succeed · legacy
paths still served.

---

## 13. Known gaps

- **Staff sessions** use access tokens only; `refresh_tokens` is FK-bound to
  `users`, so staff must re-authenticate when the access token expires.
- **Local storage is single-host.** Multi-host/autoscaled API requires object
  storage.
- **No down migrations.** Rollback is restore/PITR based by design.
- Reports, broadcast, chat, WhatsApp account lifecycle, Google/theme auth, and
  the admin feature-flags/activity-logs pages remain **legacy-only** — see
  `CUTOVER_COVERAGE.md`.
- Receipt PDFs are generated in the API process (pdfkit + qrcode); `send-receipt`
  queues a `receipt.send` outbox event for the worker to deliver.
