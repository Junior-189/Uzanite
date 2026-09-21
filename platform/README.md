# UZANITE Platform (NestJS + PostgreSQL)

Phase M1 of the Strangler Fig migration. This workspace runs **alongside** the
existing Express + MongoDB app at the repository root. Nothing here changes the
running system; the gateway routes only the migrated domains to NestJS.

## Layout

```
platform/
├─ apps/api        # NestJS HTTP API (Identity + Tenancy + Billing foundation)
├─ apps/worker     # NestJS standalone BullMQ worker (skeleton)
├─ packages/contracts  # shared Zod schemas (API + SPA)
├─ prisma/         # schema lives at apps/api/prisma
├─ gateway/        # nginx strangler routing example
├─ Dockerfile.api / Dockerfile.worker / docker-compose.yml
└─ .env.example
```

## Prerequisites

- Node 20+, pnpm 9 (`corepack enable`)
- PostgreSQL 16 and Redis 7 (or use `docker compose`)

## Local run

```bash
cd platform
cp .env.example .env         # set DATABASE_URL, JWT_SECRET, etc.
pnpm install
pnpm --filter @uzanite/contracts build

# Database
pnpm prisma:generate
pnpm prisma:migrate          # creates tables
pnpm prisma:seed             # plans + bootstrap super admin

# API
pnpm api:dev                 # http://localhost:4000/api/v1
# Worker (separate terminal)
pnpm worker:dev
```

Health/readiness/metrics: `/api/v1/health`, `/api/v1/ready`, `/api/v1/metrics`.
OpenAPI docs (non-prod): `/api/v1/docs`.

## Docker

```bash
cd platform
cp .env.example .env
docker compose up --build
```

## Strangler routing

See `gateway/nginx.conf`. In short:

- `/api/v1/*` → NestJS
- everything else (`/api/*` without `v1`, `/webhook`, `/uploads`, `/admin`, `/`) → Express

Both apps share the same `JWT_SECRET` so tokens remain valid during the
transition (HS256). The **client** decides whether a migrated domain's calls go
to `/api/v1` or stay on legacy `/api`, via `VITE_API_V1` and the optional
per-domain `VITE_API_V1_DOMAINS` (see `client/src/utils/apiRouting.ts`).

Operational guides:

- [`docs/DEPLOYMENT_RUNBOOK.md`](../docs/DEPLOYMENT_RUNBOOK.md) — topology, env
  matrix, provisioning, migrations/rollback, proxy, worker, storage.
- [`docs/CUTOVER_PLAYBOOK.md`](../docs/CUTOVER_PLAYBOOK.md) — staged per-domain
  rollout, verification, and rollback.
- [`docs/CUTOVER_COVERAGE.md`](../docs/CUTOVER_COVERAGE.md) — per-domain status.

## Row Level Security (optional, recommended in production)

M1 enforced tenant isolation in the app layer (Prisma extension). M2 adds the
PostgreSQL RLS backstop. To enable:

1. Apply migrations (`prisma migrate deploy`) — `0003_rls` creates the policies.
2. Create the non-owner app role: `psql "$DATABASE_URL" -f apps/api/prisma/sql/ci-roles.sql`.
3. Point the app's `DATABASE_URL` at `uzanite_app`.
4. Set `RLS_ENABLED=true`.

With RLS enabled, every request runs in a transaction that sets
`app.current_tenant` (tenant requests) or `app.bypass_rls='on'` (platform work).

## Data migration (Identity & Tenancy)

```bash
MONGODB_URI=... DATABASE_URL=... pnpm --filter @uzanite/api migrate:identity
MONGODB_URI=... DATABASE_URL=... pnpm --filter @uzanite/api migrate:reconcile
```

Idempotent (upserts by `legacy_id`); invalid rows are quarantined to
`apps/api/prisma/migration/reports/`. Plaintext passwords are never migrated;
accounts without a bcrypt hash are forced to reset.

## Outbox & background jobs

State changes that need side effects write to `outbox_events` (same
transaction). The worker (`pnpm worker:dev`) publishes pending events — Phase M2
delivers `email.send` (password reset) via SMTP when configured, else logs.

## Tests

```bash
pnpm test        # unit tests (no DB required); integration tests skip without a DB
pnpm typecheck
```

Integration tests run when `TEST_DATABASE_URL` is set (and RLS tests additionally
with `TEST_APP_DATABASE_URL`). CI provides a Postgres service and runs
`prisma migrate deploy` + `ci-roles.sql` first.
