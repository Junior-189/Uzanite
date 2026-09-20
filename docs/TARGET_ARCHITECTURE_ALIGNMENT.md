# UZANITE — Target Architecture Alignment

**Purpose:** map the agreed target architecture (modular NestJS monolith + worker, PostgreSQL system of record, Meta-only WhatsApp, PWA-first clients) to what is actually in this repository, and give an ordered, executable change plan.

**Headline finding:** the **target backend already exists** in `platform/`. The repository still carries a **parallel legacy app** (Express + MongoDB), the **Baileys** transport, and an **Electron** shell, and the **React client still calls the legacy `/api`**. So the work is not "build the target" — it is **cut over to it, then delete the contradicted layers**, plus the auth/client upgrades the plan calls for.

---

## 1. Alignment matrix (target vs. repository)

| Target (from the plan) | Status | Evidence / gap |
|---|---|---|
| NestJS + TypeScript modular monolith | **DONE** | `platform/apps/api/src/modules/{admin,billing,catalog,commerce,conversation,finance,health,identity,messaging,notifications,privacy,receipts,tenancy}` |
| Separate worker process | **DONE** | `platform/apps/worker` (outbox publisher, WhatsApp sender, receipts, notifications, retention, reconciliation) |
| PostgreSQL + Prisma as system of record | **PARTIAL** | Platform is Postgres; **legacy Mongo is still present and authoritative** for the live client |
| Zod shared validation | **PARTIAL** | `platform/packages/contracts` shares Zod with the API; **client is JS with no shared Zod** |
| Redis + BullMQ (queues, lockout, rate-limit) | **DONE** | Platform + legacy both use Redis-backed queues/limits |
| Cache / rate-limit on Redis | **DONE** | `platform/apps/api/src/cache`, sliding-window limiter, `TRUST_PROXY_HOPS` |
| Auth: access 15m + refresh rotation + revoke on suspend | **DONE** | `security/token.service.ts`, `tokenVersion`, `JwtAuthGuard` |
| **argon2id** instead of bcryptjs | **GAP** | Both stacks use `bcryptjs` (`package.json`, `platform/apps/api/package.json`) |
| **Admin TOTP 2FA** | **GAP** | No `otplib`/TOTP anywhere |
| helmet / throttler / CORS allow-list | **DONE (equivalent)** | Platform: custom security-headers (M10) + Redis limiter + strict CORS; legacy: helmet + limiters |
| Signed object storage (S3/R2), no public disk | **PARTIAL** | Legacy `storageService` (local/S3 signed URLs); **platform has no upload endpoint yet** |
| **Meta Cloud API only; drop Baileys** | **PARTIAL** | Platform is Meta-only; **legacy still ships Baileys** (`src/whatsapp/{client,transport}.js`, `@whiskeysockets/baileys`) |
| Payments aggregator + webhooks (ClickPesa/AzamPay; Mixx/Airtel) | **PARTIAL** | Adapters exist (`platform/apps/api/src/modules/finance/payments/*`); certification pending; manual is default |
| Frontend React **+ TypeScript + TanStack Query + RHF + Zod + shadcn** | **GAP** | `client/` is JavaScript React 19 + Vite; no `tsconfig.json` |
| Capacitor Android (package-id repair) | **GAP** | `appId` mismatch (`capacitor.config.json` vs `applicationId`), `allowMixedContent`, `allowBackup` |
| **Drop Electron → ship a PWA** | **CONTRADICTS** | `electron/` + electron-builder present; `manifest.json` not linked in `client/index.html` |
| Observability: Pino + OpenTelemetry + Sentry | **PARTIAL** | Pino + Sentry-compatible Store-API + W3C trace + optional OTLP (M12); **full OTel SDK not wired** |
| REST `/api/v1` + OpenAPI | **DONE** | `platform/apps/api/openapi.json` + `platform/scripts/api-contract-check.mjs` |
| **Move off MongoDB** | **PARTIAL** | Postgres platform exists; **Mongo/Express still present and used by the client** |
| argon2 / jose kid rotation / sanitize-html / Playwright e2e / Dependabot+audit | **PARTIAL** | `security.yml` (audit/secret-scan/SAST/image scan) present; argon2, jose-kid, sanitize-html, Playwright **missing** |
| API rules: tenant from token, idempotency, transactions, server-side flags, impersonation claims | **DONE** | Platform: RLS + ALS tenant context, idempotency keys, `runAsSystem`, `@RequirePlanFeature`, `act`/`typ` impersonation + audit |

---

## 2. The critical dependency (do not skip)

The React admin's base URL is the **legacy** `'/api'` (`client/src/utils/api.js`), and the live data is in **MongoDB**. Therefore:

- **Do not delete the Express/Mongo app yet.** The plan's "Phase 4 (platform)" and "Phase 9 (cutover)" are prerequisites for "move off Mongo".
- The correct order is: **upgrade auth → cut the client over to `/api/v1` domain-by-domain → run reconciliation until clean → then decommission Mongo/Baileys/Electron.**

---

## 3. Ordered change plan (mapped to the plan's phases)

### Batch A — Positioning & truth (safe, no runtime change) — **this commit**
- This alignment document.
- README rewritten **Postgres/NestJS-first**, with Express/Mongo labelled *transitional legacy*.

### Batch B — Auth hardening (Phase 0/1; additive, non-destructive)
1. **argon2id** with transparent rehash: verify existing `bcrypt` hashes, rehash to argon2id on next successful login; keep the `passwordHash` column. Applies to the platform first (legacy second).
2. **Admin TOTP 2FA** (`otplib`): enroll/verify endpoints, recovery codes, enforced for `platformRole` admins; audit events.
3. **jose / key rotation (`kid`)** for JWT signing (replace the single HS256 secret with a key set).

### Batch C — Client modernization (Phase 5)
1. **TypeScript** migration (incremental: `allowJs`, start with `utils/`, `context/`, `db/`).
2. **TanStack Query** for server state; **React Hook Form + Zod** for forms.
3. **PWA**: link `manifest.json`, versioned service-worker caches, `start_url` fix.
4. Android: one `applicationId`, `allowBackup=false`, `allowMixedContent=false`.

### Batch D — Retire contradicted layers (destructive — needs sign-off, only after cutover)
1. **Drop Electron** (the plan says PWA instead; Electron only wraps `uzanite.shop`).
2. **Drop Baileys** (Meta-only; delete `src/whatsapp/{client,transport}.js` + dependency).
3. **Remove the Express/Mongo app** once every domain is cut over and reconciled.

### Batch E — Cutover to the target backend (the real project)
1. Point the client at `/api/v1` for wave 1 (auth, tenants, billing, admin) behind a per-tenant flag; shadow-compare reads.
2. Migrate commerce/catalog/finance/messaging; keep the reconciliation job green.
3. Retire legacy routes domain by domain; then run Batch D.

### Batch F — Scale & ops (Phase 6)
- Read replicas for reports, per-tenant send worker, PgBouncer when replicas ≥ 2, full OTel SDK, load-test gates.

---

## 4. What NOT to do (from the plan, confirmed)
- No microservices, GraphQL, Kubernetes, or Kafka yet.
- Don't keep Baileys in production; don't run WhatsApp sockets on ephemeral-disk PaaS.
- Don't build a third frontend; finish the web app first.
- Don't store "admin convenience" passwords — use audited impersonation.

---

## 5. Recommended next batch

**Batch B (auth hardening)** is the highest-value, lowest-risk step that directly matches the plan and does not depend on cutover:
- argon2id (with backward-compatible rehash),
- admin TOTP 2FA,
- JWT key rotation (`kid`).

Ask the operator to confirm Batch B before implementation; Batch D must not start until Batch E's reconciliation is green.
