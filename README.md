# UZANITE

**Multi-tenant WhatsApp commerce + POS platform for Tanzanian SMEs.**

UZANITE lets small businesses run their shop over WhatsApp: customers browse a catalog, place and track orders, and pay via mobile money; owners approve orders and manage stock, debts, expenses, and customers; staff use a web/POS admin. It is **bilingual (English / Kiswahili, Swahili-first)**, **offline-tolerant**, and built for **low-bandwidth, low-end Android** users.

> This repository contains the current, working product: the live **Express + MongoDB** application *and* the new **NestJS + PostgreSQL** platform it is migrating to (Strangler Fig), plus the **React admin**, **Capacitor Android**, and **Electron** clients.

---

## Table of contents

- [Architecture](#architecture)
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

## Architecture

UZANITE is mid-migration from a single Express app to a modular NestJS platform. Both run side by side:

```
                         ┌───────────────────────────┐
  WhatsApp (Meta Cloud)  │  nginx gateway            │
  Meta webhook ─────────▶│  /webhook        ─────▶   │  LEGACY  Express + MongoDB  (system of record)
                         │  /api/*          ─────▶   │          src/**, server.js  (:3000)
  React admin / Android  │  /api/v1/*       ─────▶   │  PLATFORM NestJS + PostgreSQL (:4000)
  / POS ────────────────▶│                           │          platform/apps/api
                         └───────────────────────────┘          platform/apps/worker
                                                                 (outbox, receipts, WhatsApp, retention)
```

- **Legacy (live)** — Express 4 + MongoDB/Mongoose at the repo root. Serves production today. Hardened with Zod validation, JWT refresh rotation + token versioning, Meta Cloud API transport (Baileys legacy), BullMQ + Redis queues with a dead-letter queue, AES-256-GCM token encryption, private object storage with signed URLs, and PDPA consent/export/erase.
- **Platform (new)** — NestJS + PostgreSQL + Prisma monorepo under `platform/`. Migrated Strangler domains (identity, tenancy, billing, catalog, commerce, finance, notifications, receipts, messaging, conversation flows) exposed under `/api/v1`. Includes FORCE row-level security with a non-owner role, a transactional outbox with `FOR UPDATE SKIP LOCKED` + leases, an append-only double-entry journal, keyset pagination, and a background worker.
- **Clients** — React 19 + Vite admin (`client/`), Capacitor Android (`client/android`), and an Electron desktop shell (`electron/`).

---

## Features

### WhatsApp & conversations
- **Meta WhatsApp Cloud API** transport (default) with HMAC-verified webhooks and per-tenant credentials; **Baileys** legacy transport available via `WHATSAPP_TRANSPORT=baileys`.
- Interactive customer flow: language select → main menu → browse catalog → product detail → cart → checkout (name / location / phone / optional negotiated offer) → order confirmation → tracking; payment-proof submission.
- Admin commands over WhatsApp (see [WhatsApp flows](#whatsapp-flows)).
- Conversation state machine with inactivity reset, idempotent replies, and a shadow/active rollout flag (`flow_mode = off | shadow | active`).

### Commerce & catalog
- Products, categories, barcodes, stock levels, low-stock thresholds, expiry warnings.
- **Single stock-mutation path** with append-only stock movements; stock can never go negative.
- Order lifecycle with optimistic concurrency, order status history, and a recycle bin (soft delete + restore).
- Server-authoritative order pricing with negotiation bounds (`minPrice`).
- Quotes/receipts (PDF and structured), purchase orders, expenses, and debt tracking.

### Payments & finance
- **Manual mobile money** (M-Pesa / Tigo Pesa / Airtel Money proof + reference) plus **ClickPesa** and **AzamPay** provider adapters (enabled only when credentials are set).
- Signature-verified provider webhooks with idempotency and amount/currency integrity checks.
- Append-only **financial ledger** with a balanced **double-entry journal** and a reconciliation invariant.
- Serialized refunds, receipts, and a nightly-style reconciliation sweep in the worker.

### Customers, communication & operations
- Contacts/chat, consent tracking (opt-in/opt-out), broadcast/email, notifications.
- Analytics, reports (PDF/CSV) and dashboards.

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
├── server.js                  # Legacy Express entry point
├── src/                       # Legacy app (routes, models, services, middleware, jobs, queue, whatsapp, payments, lib)
├── tests/                     # Legacy unit + integration tests (vitest)
├── scripts/                   # Legacy migrations, seeds, Mongo backup/restore
├── client/                    # React 19 + Vite admin, Capacitor Android, offline DB
├── electron/                  # Electron desktop shell
├── platform/                  # NestJS + PostgreSQL monorepo (pnpm workspace)
│   ├── apps/api/              # REST API (/api/v1) + Prisma schema/migrations
│   ├── apps/worker/           # Outbox publisher, receipts, WhatsApp sender, retention, reconciliation
│   ├── packages/contracts/    # Shared Zod contracts + OpenAPI
│   ├── packages/messaging/    # Shared Meta client + secret crypto
│   ├── gateway/               # nginx Strangler routing
│   ├── docs/                  # Observability, disaster recovery
│   └── scripts/               # CI, backup/restore, contract check
├── docs/                      # Android signing
├── Dockerfile / docker-compose.yml / render.yaml
└── .env.example               # Legacy env template (platform/ and client/ have their own)
```

---

## Tech stack

| Area | Legacy (live) | Platform (new) |
|---|---|---|
| Runtime | Node.js 20, Express 4 | Node.js 20, NestJS 10 |
| Database | MongoDB / Mongoose | PostgreSQL 16 + Prisma |
| Cache / queues | Redis + BullMQ (in-process fallback) | Redis + BullMQ, transactional outbox |
| Validation | Zod | Zod (`@uzanite/contracts`) |
| WhatsApp | Meta Cloud API + Baileys | Meta Cloud API |
| Client | React 19, Vite, Tailwind, Dexie, Capacitor, Electron | — |

---

## Prerequisites

- **Node.js 20+** and npm (root + client) and **pnpm 9** (platform).
- **MongoDB** (local or Atlas) for the legacy app.
- **PostgreSQL 16** and **Redis 7** for the platform.
- **Docker** (optional, for Postgres/Redis and container builds).

---

## Getting started

### 1. Legacy Express + MongoDB app
```bash
npm install
cp .env.example .env          # set MONGODB_URI and a strong JWT_SECRET (openssl rand -hex 32)
npm run dev                   # nodemon server.js  -> http://localhost:3000
npm run worker                # optional dedicated worker (set REDIS_URL; RUN_WORKER_IN_PROCESS=false)
```
When `WHATSAPP_TRANSPORT=baileys`, a QR code appears in the terminal (Linked Devices → Link a Device). With `meta` (default), configure the Meta webhook instead.

### 2. NestJS platform (PostgreSQL)
```bash
cd platform
cp .env.example .env
docker compose up -d postgres redis          # or point DATABASE_URL/REDIS_URL at your own
pnpm install
pnpm --filter @uzanite/api prisma:generate
pnpm --filter @uzanite/api prisma:deploy     # apply migrations (use prisma:migrate in dev)
pnpm --filter @uzanite/api prisma:seed       # plans + optional bootstrap admin
pnpm api:dev                                 # API      -> http://localhost:4000/api/v1
pnpm worker:dev                              # worker (separate terminal)
```
Production requires a **non-owner** DB role (e.g. `uzanite_app`) and `RLS_ENABLED=true`; see `platform/apps/api/prisma/sql/ci-roles.sql`.

### 3. React admin + Android
```bash
cd client
npm install
cp .env.example .env          # set VITE_API_URL and VITE_GOOGLE_CLIENT_ID if using Google sign-in
npm run dev                   # Vite dev server
npm run build                 # web build
npm run build:mobile && npx cap sync android && npm run cap:build:debug
```

### 4. Electron desktop
```bash
npm run electron:dev
npm run electron:build        # Windows NSIS installer
```

---

## Environment variables

Three templates, one per component — never commit real values:

| File | Component | Highlights |
|---|---|---|
| `.env.example` | Legacy app | `MONGODB_URI`, `JWT_SECRET`, `CORS_ORIGINS`, `WHATSAPP_TRANSPORT`, `META_APP_SECRET`, `ENCRYPTION_KEY`, `REDIS_URL`, payment + storage + SMTP settings |
| `platform/.env.example` | NestJS API + worker | `DATABASE_URL` (non-owner, pool-sized), `REDIS_URL`, `JWT_SECRET`, `RLS_ENABLED`, `TRUST_PROXY_HOPS`, cache TTLs, retention, `METRICS_TOKEN`, `SENTRY_DSN`, `OTEL_*`, `META_*`, SMTP |
| `client/.env.example` | React client | `VITE_API_URL`, `VITE_GOOGLE_CLIENT_ID` |

At least 32 characters and non-placeholder secrets are enforced at boot on both stacks.

---

## Testing

```bash
# Legacy (Express/Mongo) — unit + integration
npm test

# Platform — full CI: typecheck, Prisma drift gate, tests, build
cd platform && bash scripts/ci-local.sh      # needs TEST_DATABASE_URL / TEST_APP_DATABASE_URL / SHADOW_DATABASE_URL / JWT_SECRET
pnpm test                                    # tests only

# Client
cd client && npm test && npm run lint
```

GitHub Actions runs legacy CI, platform CI (Postgres + Redis services), and a security workflow (dependency audit, secret scanning, SAST, image scanning).

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

On the platform, conversation rollout is controlled per tenant via `flow_mode` (`off` = legacy owns the flow, `shadow` = compute only, `active` = NestJS replies) and `bot_paused`.

---

## Payments

- **Manual mobile money** (default): the admin confirms a customer's M-Pesa/Tigo/Airtel reference; a Payment, ledger entry, and balanced journal are written transactionally.
- **ClickPesa / AzamPay**: enabled only when their credentials are configured; webhooks are signature-verified and idempotent, with amount/currency integrity checks.
- Webhook endpoints: `POST /webhook/payments/:provider` (legacy) and `POST /api/v1/payments/webhook/:provider` (platform).

---

## Security

- **Authentication:** JWT access tokens + rotating refresh tokens with reuse detection and token-version revocation; bcrypt password hashing; password policy; account lockout.
- **Tenant isolation:** application-level scoping (AsyncLocalStorage + Mongoose plugin on legacy; Prisma tenant extension on platform) **plus** PostgreSQL **FORCE row-level security** with a non-owner, non-bypass DB role and a boot-time assertion.
- **Input safety:** Zod validation everywhere, parameterised SQL only (a CI guard forbids unsafe raw SQL), regex inputs escaped (ReDoS), rate limiting on auth, APIs, webhooks, and metrics.
- **Secrets & transport:** AES-256-GCM encryption for provider tokens, HMAC webhook verification, Helmet-equivalent security headers, strict CORS allow-list, placeholder-secret rejection at boot.
- **Privacy:** consent tracking, data export, and pseudonymised erasure; financial records are retained but stripped of PII.
- **Access control:** role/permission-based staff access, audited admin impersonation, and cross-tenant admin auditing.

---

## Observability & operations

- Structured JSON logs (Pino) with request/trace correlation; W3C `traceparent` propagation; optional OTLP span export; Sentry-compatible error tracking.
- Prometheus `/metrics` (token-protected) covering HTTP, payment-webhook outcomes, outbox, WhatsApp queue, and business/ledger indicators.
- Worker responsibilities: transactional outbox dispatch, WhatsApp outbound sending, receipt/notification writing, **double-entry reconciliation** with alerts, and **PDPA retention sweeps**.
- Backups: `scripts/backup-mongo.sh` / `restore-mongo.sh` (legacy) and `platform/scripts/backup-postgres.sh` / `restore-postgres.sh` (platform).

---

## Deployment

- **Containers:** root `Dockerfile` (legacy) and `platform/Dockerfile.api` / `Dockerfile.worker` (multi-stage, non-root, health-checked, with a one-shot migration stage). `docker-compose.yml` brings up Postgres/Redis.
- **Gateway:** `platform/gateway/nginx.conf` routes migrated `/api/v1/(auth|tenants|billing|admin)` to NestJS and everything else to Express.
- **PaaS:** `render.yaml` for the legacy app.
- See **[DEPLOYMENT.md](DEPLOYMENT.md)** for process model, environment, migrations, backups, and scaling; **[platform/docs/DISASTER_RECOVERY.md](platform/docs/DISASTER_RECOVERY.md)** for recovery procedures.

---

## Documentation

| Document | Contents |
|---|---|
| [DEPLOYMENT.md](DEPLOYMENT.md) | Deployment, environment, scaling, backups |
| [platform/README.md](platform/README.md) | Platform layout, local run, RLS, outbox, migrations |
| [platform/docs/OBSERVABILITY.md](platform/docs/OBSERVABILITY.md) | Logs, tracing, metrics, alerting |
| [platform/docs/DISASTER_RECOVERY.md](platform/docs/DISASTER_RECOVERY.md) | Backup/restore and recovery drills |
| [docs/ANDROID_SIGNING.md](docs/ANDROID_SIGNING.md) | Android release signing |
| [platform/loadtest/README.md](platform/loadtest/README.md) | Load-test suite usage |
