# UZANITE

**Multi-tenant WhatsApp commerce + POS platform for Tanzanian SMEs.**

UZANITE lets small businesses run their shop over WhatsApp: customers browse a catalog, place and track orders, and pay via mobile money; owners approve orders and manage stock, debts, expenses, and customers; staff use a web/POS admin. It is **bilingual (English / Kiswahili, Swahili-first)**, **offline-tolerant**, and built for **low-bandwidth, low-end Android** users.

## Target architecture

UZANITE is a **modular monolith (NestJS) with a separate worker process**, backed by **PostgreSQL as the system of record**, with **Meta WhatsApp Cloud API**, **Redis/BullMQ**, and **signed object storage**. Clients are a **React admin/PWA** and a **Capacitor Android** app.

```
        ┌─────────────┐   ┌──────────────────┐
        │ React PWA   │   │ Capacitor Android│
        └──────┬──────┘   └────────┬─────────┘
               └─────────┬─────────┘
                         ▼
                 ┌───────────────┐        ┌──────────────────────────────┐
     Meta Cloud  │  NestJS API   │  ────▶ │ PostgreSQL · Redis · S3/R2    │
     WhatsApp ──▶│  /api/v1      │        │ BullMQ worker (outbox, send,  │
     webhook     │  (modular)    │        │ receipts, reconciliation,     │
                 └───────────────┘        │ retention)                    │
                                          └──────────────────────────────┘
```

- **API + worker:** `platform/apps/api`, `platform/apps/worker` (NestJS 10, TypeScript).
- **Data:** PostgreSQL 16 + Prisma; Redis for cache, rate limits, lockouts, and BullMQ queues; S3/Cloudflare R2 for private files.
- **Messaging:** Meta WhatsApp Cloud API only, with HMAC-verified webhooks and per-tenant credentials.
- **Contracts:** shared Zod schemas + OpenAPI (`platform/packages/contracts`, `platform/apps/api/openapi.json`).
- **Security:** JWT access + rotating refresh with token-version revocation, tenant isolation via Prisma scoping **and** PostgreSQL FORCE row-level security (non-owner role), Redis sliding-window rate limiting, secret validation at boot.
- **Observability:** Pino structured logs with request/trace correlation, W3C `traceparent`, Sentry-compatible error tracking, Prometheus `/metrics`, worker reconciliation of a double-entry ledger.

> **Migration status.** The platform above is implemented under `platform/`. The repository still contains the original **Express + MongoDB** application at the repo root, which remains the live system of record while the client is cut over to `/api/v1`. See **[docs/TARGET_ARCHITECTURE_ALIGNMENT.md](docs/TARGET_ARCHITECTURE_ALIGNMENT.md)** for the item-by-item gap analysis and the ordered cutover/decommission plan.

---

## Table of contents

- [Features](#features)
- [Repository layout](#repository-layout)
- [Tech stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Testing](#testing)
- [Order lifecycle](#order-lifecycle)
- [WhatsApp flows](#whatsapp-flows)
- [Payments](#payments)
- [Security](#security)
- [Observability & operations](#observability--operations)
- [Deployment](#deployment)
- [Documentation](#documentation)

---

## Features

### WhatsApp & conversations
- **Meta WhatsApp Cloud API** transport with HMAC-verified webhooks and per-tenant credentials.
- Interactive customer flow: language select → main menu → browse catalog → product detail → cart → checkout (name / location / phone / optional negotiated offer) → order confirmation → tracking; payment-proof submission.
- Admin commands over WhatsApp (see [WhatsApp flows](#whatsapp-flows)).
- Conversation state machine with inactivity reset, idempotent replies, and a shadow/active rollout flag (`flow_mode = off | shadow | active`).

### Commerce & catalog
- Products, categories, barcodes, stock levels, low-stock thresholds, expiry warnings.
- **Single stock-mutation path** with append-only stock movements; stock can never go negative.
- Order lifecycle with optimistic concurrency, order status history, and a recycle bin (soft delete + restore).
- Server-authoritative order pricing with negotiation bounds (`minPrice`).
- Receipts (PDF and structured), purchase orders, expenses, and debt tracking.

### Payments & finance
- **Manual mobile money** (M-Pesa / Mixx / Airtel proof + reference) plus **ClickPesa** and **AzamPay** provider adapters (enabled only when credentials are set).
- Signature-verified provider webhooks with idempotency and amount/currency integrity checks.
- Append-only **financial ledger** with a balanced **double-entry journal** and a reconciliation invariant.
- Serialized refunds and a background reconciliation sweep in the worker.

### Customers, communication & operations
- Contacts/chat, consent tracking (opt-in/opt-out), broadcast/email, notifications.
- Analytics, reports (PDF/CSV), and dashboards.

### Admin, staff & SaaS
- Multi-tenant businesses with plans, usage counters, feature flags, and billing.
- Staff accounts with scoped permissions; platform-admin approval, suspension, and audited impersonation.
- Privacy/DSP rights: consent log, data export, and pseudonymised erasure (PDPA-oriented).

### Clients & offline
- Bilingual **EN/SW** UI with full key parity (Swahili default).
- Offline-first: IndexedDB (Dexie) cache + a durable background sync queue; service worker with stale-while-revalidate.
- Barcode scanning / POS, bulk CSV import, and low-bandwidth-friendly payloads.

---

## Repository layout

```
.
├── platform/                  # TARGET architecture: NestJS + PostgreSQL monorepo (pnpm workspace)
│   ├── apps/api/              # REST API (/api/v1), Prisma schema + migrations, RLS, outbox, observability
│   ├── apps/worker/           # Outbox publisher, WhatsApp sender, receipts, retention, reconciliation
│   ├── packages/contracts/    # Shared Zod contracts + OpenAPI
│   ├── packages/messaging/    # Shared Meta client + secrets crypto
│   ├── gateway/               # nginx Strangler routing
│   ├── docs/                  # Observability, disaster recovery
│   └── scripts/               # CI, backup/restore, contract check
├── client/                    # React 19 + Vite admin/PWA, Capacitor Android, offline DB (Dexie)
├── docs/                      # Target-architecture alignment, Android signing
├── server.js, src/, tests/    # LEGACY (transitional): Express + MongoDB app, live system of record
├── scripts/                   # Legacy migrations/seeds + Mongo backup/restore
├── electron/                  # Legacy desktop shell (planned to be dropped in favour of the PWA)
├── Dockerfile / docker-compose.yml / render.yaml
└── .env.example               # Legacy env template (platform/ and client/ have their own)
```

---

## Tech stack

| Layer | Target (implemented in `platform/`) |
|---|---|
| API | NestJS 10 + TypeScript, modular monolith, OpenAPI |
| Worker | NestJS + BullMQ, transactional outbox |
| Database | PostgreSQL 16 + Prisma (system of record) |
| Cache / queues | Redis + BullMQ |
| Validation | Zod (`@uzanite/contracts`) |
| WhatsApp | Meta Cloud API |
| Payments | Manual mobile money + ClickPesa / AzamPay adapters |
| Files | S3 / Cloudflare R2 signed URLs |
| Observability | Pino, OpenTelemetry/W3C trace, Sentry-compatible, Prometheus |
| Client | React 19, Vite, Tailwind, Dexie, Capacitor Android |
| Legacy (transitional) | Express 4 + MongoDB/Mongoose + Baileys |

---

## Prerequisites

- **Node.js 20+**, npm, and **pnpm 9** (platform).
- **PostgreSQL 16** and **Redis 7** (platform).
- **Docker** (optional, for Postgres/Redis and container builds).
- **MongoDB** (local or Atlas) — only for the transitional legacy app.

---

## Getting started

### 1. Platform — API + worker (the target backend)
```bash
cd platform
cp .env.example .env
docker compose up -d postgres redis          # or point DATABASE_URL/REDIS_URL at your own
pnpm install
pnpm --filter @uzanite/api prisma:generate
pnpm --filter @uzanite/api prisma:deploy     # apply migrations (prisma:migrate in dev)
pnpm --filter @uzanite/api prisma:seed       # plans + optional bootstrap admin
pnpm api:dev                                 # API      -> http://localhost:4000/api/v1
pnpm worker:dev                              # worker (separate terminal)
```
Production requires a **non-owner** DB role (e.g. `uzanite_app`) and `RLS_ENABLED=true`; see `platform/apps/api/prisma/sql/ci-roles.sql`.

### 2. React admin / PWA + Android
```bash
cd client
npm install
cp .env.example .env          # set VITE_API_URL and VITE_GOOGLE_CLIENT_ID if using Google sign-in
npm run dev                   # Vite dev server
npm run build                 # web build
npm run build:mobile && npx cap sync android && npm run cap:build:debug
```

> The client currently points at the legacy `/api`. The cutover to `/api/v1` is part of the migration plan.

### 3. Legacy Express + MongoDB app (transitional)
```bash
npm install
cp .env.example .env          # set MONGODB_URI and a strong JWT_SECRET (openssl rand -hex 32)
npm run dev                   # nodemon server.js -> http://localhost:3000
npm run worker                # optional dedicated worker (set REDIS_URL; RUN_WORKER_IN_PROCESS=false)
```

---

## Environment variables

Templates per component — never commit real values:

| File | Component | Highlights |
|---|---|---|
| `platform/.env.example` | NestJS API + worker | `DATABASE_URL` (non-owner, pool-sized), `REDIS_URL`, `JWT_SECRET`, `RLS_ENABLED`, `TRUST_PROXY_HOPS`, cache TTLs, retention, `METRICS_TOKEN`, `SENTRY_DSN`, `OTEL_*`, `META_*`, SMTP |
| `client/.env.example` | React client | `VITE_API_URL`, `VITE_GOOGLE_CLIENT_ID` |
| `.env.example` | Legacy app (transitional) | `MONGODB_URI`, `JWT_SECRET`, `CORS_ORIGINS`, `WHATSAPP_TRANSPORT`, `META_APP_SECRET`, `ENCRYPTION_KEY`, `REDIS_URL`, payment/storage/SMTP settings |

At least 32 characters and non-placeholder secrets are enforced at boot on both backends.

---

## Testing

```bash
# Platform — full CI: typecheck, Prisma drift gate, tests, build
cd platform && bash scripts/ci-local.sh      # needs TEST_DATABASE_URL / TEST_APP_DATABASE_URL / SHADOW_DATABASE_URL / JWT_SECRET
pnpm test                                    # tests only

# Client
cd client && npm test && npm run lint

# Legacy (transitional)
npm test
```

GitHub Actions runs platform CI (Postgres + Redis services), legacy CI, and a security workflow (dependency audit, secret scanning, SAST, image scanning).

---

## Order lifecycle

```
PENDING ──▶ APPROVED ──▶ PENDING_PAYMENT ──▶ PAID ──▶ DELIVERED
      └──▶ REJECTED (restores stock)
```

---

## WhatsApp flows

**Customer** (interactive): language selection → main menu → browse → product detail → cart → checkout → order placed → track with `TRACK ORD-...`; payment references are captured at the menu or the payment step.

**Admin** commands:

| Command | Description |
|---|---|
| `HELP` | Show all commands |
| `PRODUCTS` | List products |
| `QUICK_ADD name\|description\|price\|stock` | Quickly add a product |
| `ORDERS [STATUS]` | List orders (optionally filtered) |
| `TRACK ORD-...` | Show an order |
| `APPROVE ORD-... [note]` | Approve an order |
| `REJECT ORD-... [reason]` | Reject an order |
| `PAY ORD-...` | Request payment from the customer |
| `CONFIRM_PAYMENT ORD-... [method] [reference]` | Confirm payment |
| `DELIVER ORD-... [note]` | Mark delivered |

Conversation rollout is controlled per tenant via `flow_mode` (`off` = legacy owns the flow, `shadow` = compute only, `active` = NestJS replies) and `bot_paused`.

---

## Payments

- **Manual mobile money** (default): the admin confirms a customer's M-Pesa/Mixx/Airtel reference; a Payment, ledger entry, and balanced journal are written transactionally.
- **ClickPesa / AzamPay**: enabled only when their credentials are configured; webhooks are signature-verified and idempotent, with amount/currency integrity checks.
- Webhook endpoints: `POST /api/v1/payments/webhook/:provider` (platform), `POST /webhook/payments/:provider` (legacy).

---

## Security

- **Authentication:** JWT access tokens + rotating refresh tokens with reuse detection and token-version revocation; **argon2id** password hashing with transparent upgrade of legacy hashes; **TOTP two-factor** (enforced for platform admins) with single-use recovery codes; **`kid`-based JWT key rotation** (`JWT_KEYS`).
- **Tenant isolation:** application-level scoping (Prisma tenant extension) **plus** PostgreSQL **FORCE row-level security** with a non-owner, non-bypass DB role and a boot-time assertion.
- **Input safety:** Zod validation everywhere, parameterised SQL only (a CI guard forbids unsafe raw SQL), regex inputs escaped (ReDoS), rate limiting on auth, APIs, webhooks, and metrics.
- **Secrets & transport:** AES-256-GCM encryption for provider tokens, HMAC webhook verification, Helmet-equivalent security headers, strict CORS allow-list, placeholder-secret rejection at boot.
- **Privacy:** consent tracking, data export, and pseudonymised erasure; financial records are retained but stripped of PII.
- **Access control:** role/permission-based staff access, audited admin impersonation, and cross-tenant admin auditing.

---

## Observability & operations

- Structured JSON logs (Pino) with request/trace correlation; W3C `traceparent`; optional OTLP span export; Sentry-compatible error tracking.
- Prometheus `/metrics` (token-protected) covering HTTP, payment-webhook outcomes, outbox, WhatsApp queue, and business/ledger indicators.
- Worker responsibilities: transactional outbox dispatch, WhatsApp outbound sending, receipt/notification writing, **double-entry reconciliation** with alerts, and **PDPA retention sweeps**.
- Backups: `platform/scripts/backup-postgres.sh` / `restore-postgres.sh`; legacy `scripts/backup-mongo.sh` / `restore-mongo.sh`.

---

## Deployment

- **Containers:** `platform/Dockerfile.api` / `Dockerfile.worker` (multi-stage, non-root, health-checked, with a one-shot migration stage); root `Dockerfile` for the legacy app. `docker-compose.yml` brings up Postgres/Redis.
- **Gateway:** `platform/gateway/nginx.conf` routes migrated `/api/v1/(auth|tenants|billing|admin)` to NestJS and everything else to Express during the transition.
- See **[DEPLOYMENT.md](DEPLOYMENT.md)** and **[platform/docs/DISASTER_RECOVERY.md](platform/docs/DISASTER_RECOVERY.md)**.

---

## Documentation

| Document | Contents |
|---|---|
| [docs/TARGET_ARCHITECTURE_ALIGNMENT.md](docs/TARGET_ARCHITECTURE_ALIGNMENT.md) | Target vs. current gap analysis + ordered change plan |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Deployment, environment, scaling, backups |
| [platform/README.md](platform/README.md) | Platform layout, local run, RLS, outbox, migrations |
| [platform/docs/OBSERVABILITY.md](platform/docs/OBSERVABILITY.md) | Logs, tracing, metrics, alerting |
| [platform/docs/DISASTER_RECOVERY.md](platform/docs/DISASTER_RECOVERY.md) | Backup/restore and recovery drills |
| [docs/ANDROID_SIGNING.md](docs/ANDROID_SIGNING.md) | Android release signing |
| [platform/loadtest/README.md](platform/loadtest/README.md) | Load-test suite usage |
