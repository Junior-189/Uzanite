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
| **argon2id** instead of bcryptjs | **DONE (platform)** | Platform hashes with argon2id and upgrades legacy bcrypt hashes transparently on login (`security/password.ts`); legacy app still bcryptjs until decommission |
| **Admin TOTP 2FA** | **DONE (platform)** | `security/totp.service.ts` + `/auth/totp/*` + `/auth/login/2fa`; enforced for platform admins via `AdminMfaGuard` |
| helmet / throttler / CORS allow-list | **DONE (equivalent)** | Platform: custom security-headers (M10) + Redis limiter + strict CORS; legacy: helmet + limiters |
| Signed object storage (S3/R2), no public disk | **PARTIAL** | Legacy `storageService` (local/S3 signed URLs); **platform has no upload endpoint yet** |
| **Meta Cloud API only; drop Baileys** | **PARTIAL** | Platform is Meta-only; **legacy still ships Baileys** (`src/whatsapp/{client,transport}.js`, `@whiskeysockets/baileys`) |
| Payments aggregator + webhooks (ClickPesa/AzamPay; Mixx/Airtel) | **PARTIAL** | Adapters exist (`platform/apps/api/src/modules/finance/payments/*`); certification pending; manual is default |
| Frontend React **+ TypeScript + TanStack Query + RHF + Zod + shadcn** | **IN PROGRESS** | TypeScript enabled (`client/tsconfig.json`, `typecheck` gated in CI); `utils/tokenStore.ts` + `utils/api.ts` converted; TanStack Query provider wired; Zod used for session validation. RHF + page-by-page migration pending |
| Capacitor Android (package-id repair) | **DONE** | Unified to `com.uzanite.app` (capacitor config, gradle namespace+applicationId, strings.xml, `MainActivity` package); `allowBackup=false`, `allowMixedContent=false`. **Android build must be verified with `cap sync` + gradle** |
| **Drop Electron → ship a PWA** | **DONE** | Electron removed (`electron/`, deps, scripts, desktop-download route); PWA configured (manifest linked, viewport/theme meta, versioned service worker) |
| Observability: Pino + OpenTelemetry + Sentry | **PARTIAL** | Pino + Sentry-compatible Store-API + W3C trace + optional OTLP (M12); **full OTel SDK not wired** |
| REST `/api/v1` + OpenAPI | **DONE** | `platform/apps/api/openapi.json` + `platform/scripts/api-contract-check.mjs` |
| **Move off MongoDB** | **PARTIAL** | Postgres platform exists; **Mongo/Express still present and used by the client** |
| argon2 / kid rotation / sanitize-html / Playwright e2e / Dependabot+audit | **PARTIAL** | `security.yml` present; **argon2id + HS256 `kid` rotation done** (platform); sanitize-html + Playwright e2e still missing |
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

### Batch B — Auth hardening (Phase 0/1) — ✅ DONE, verified locally (not yet pushed)
1. **argon2id** with transparent rehash: platform now hashes with argon2id (OWASP baseline) and upgrades legacy bcrypt/outdated-argon2 hashes on the next successful login (`security/password.ts`). Covered by unit + integration tests.
2. **Admin TOTP 2FA** (`otplib`): two-step login (`/auth/login` → `mfaRequired` challenge → `/auth/login/2fa`), enrollment (`/auth/totp/enroll|confirm|disable`), 8 single-use recovery codes (hashed), secret AES-256-GCM encrypted. Enforced for platform admins via `AdminMfaGuard`. Migration `0016_totp_2fa`.
3. **JWT key rotation (`kid`)**: `JwtKeyService` supports a `JWT_KEYS` key set with `JWT_ACTIVE_KID`; tokens verify against their header `kid`, so keys rotate without invalidating outstanding sessions. Retains pinned issuer/audience/HS256.
- Verification: platform CI green — **API 180 tests / 31 files, worker 20, contracts 6**, typecheck, Prisma drift gate, build.

### Batch C — Client modernization (Phase 5) — ✅ foundation DONE, verified locally (not pushed)
1. **TypeScript foundation:** added `client/tsconfig.json` (`strict`, `allowJs`, `checkJs:false`) and a `typecheck` script (gated in CI); converted `src/utils/tokenStore.ts` and `src/utils/api.ts` to fully-typed modules. Remaining `.jsx` files are still JS and convert page-by-page.
2. **TanStack Query** provider wired (`src/lib/queryClient.ts`, mounted in `main.jsx`) with mobile-tuned defaults (reads retry, mutations never retry). **Zod** validates the persisted session profile in `tokenStore`. React Hook Form is deferred until a form is migrated (R8: no unused deps).
3. **PWA:** `manifest.json` linked in `index.html` with `%BASE_URL%`, theme/apple meta, and a relative `start_url`/`scope`; service worker rewritten to **versioned caches** that purge only old versions (no more wipe-everything); SW update poll reduced from 60s to 6h + on-focus.
4. **Android:** unified the package id to `com.uzanite.app` across `capacitor.config.json`, `build.gradle` (namespace + applicationId), `strings.xml`, and `MainActivity`; `allowBackup=false` and `allowMixedContent=false` already in place. Verify the native build with `npm run cap:sync` + gradle.
- Verification: client `typecheck` ✅, `lint` ✅, `test` 16/16 ✅, `build` ✅.

### Batch D — Retire contradicted layers (destructive)
1. **Drop Electron — ✅ DONE.** Removed `electron/`, its scripts/devDependencies, the electron-builder config, and the `/admin/UZANITE-Setup.exe` download route. The PWA (Batch C) replaces it.
2. **Drop Baileys — ⛔ BLOCKED.** The legacy app is still the live system of record and its transport is env-controlled (`WHATSAPP_TRANSPORT`); deleting Baileys (`src/whatsapp/{client,transport}.js` + the dependency) is only safe once production is confirmed Meta-only and the legacy app is being decommissioned.
3. **Remove the Express/Mongo app — ⛔ BLOCKED.** The client still calls legacy `/api` for every domain except auth/tenants (orders, products, payments, reports, staff, whatsapp, notifications, …). Deleting Mongo/Express now would break the running product. This is gated on **finishing Batch E** (cut over the remaining domains + reconciliation green).

> Deletion order is therefore: **Electron (done) → finish cutover → Baileys → Mongo/Express.** Do not invert it.

### Batch E — Cutover to the target backend (the real project) — 🔄 first increment DONE (auth wave), verified locally (not pushed)
1. **Dual-stack client routing + auth wave:** `client/src/utils/apiRouting.ts` routes a path to `/api/v1` or `/api` based on the `VITE_API_V1` flag (**default off**). The axios client applies it per request; auth call sites use `resolveApiUrl`. Live auth flows the platform does not implement (`/auth/google`, `/auth/staff`, `/auth/theme`) are pinned to legacy.
2. **Shape compatibility bridge:** `client/src/utils/platformBridge.ts` adapts the platform's `{platformRole, membership role, permission catalogue}` user to the legacy client shape (`role: tenant|staff|sub_admin|super_admin`, `manage_orders`-style permissions), so a flipped cutover does not lock the UI down. Unit-tested.
3. **Parity harness:** `platform/scripts/api-parity-check.mjs` compares the same authenticated GET against both stacks and reports shape differences — the shadow-compare gate before flipping `VITE_API_V1=true`.
4. **Not yet cut over:** tenants/billing/admin (their client call sites and platform endpoints do not match yet — e.g. `/admin/users`, `/admin/stats`, feature flags), and commerce/catalog/finance/messaging. Widen `PLATFORM_PREFIXES` one domain at a time once parity is green. Then Batch D (delete legacy/Baileys/Electron).
- Verification: client `typecheck` ✅, `lint` ✅, `test` 24/24 ✅, `build` ✅. Cutover flag defaults off, so production (legacy) behaviour is unchanged.

### Batch F — Scale & ops (Phase 6)
- Read replicas for reports, per-tenant send worker, PgBouncer when replicas ≥ 2, full OTel SDK, load-test gates.

---

## 4. What NOT to do (from the plan, confirmed)
- No microservices, GraphQL, Kubernetes, or Kafka yet.
- Don't keep Baileys in production; don't run WhatsApp sockets on ephemeral-disk PaaS.
- Don't build a third frontend; finish the web app first.
- Don't store "admin convenience" passwords — use audited impersonation.

---

## 5. Batch status & recommended next batch

- **Batch A (positioning/docs):** ✅ done.
- **Batch B (auth hardening):** ✅ done, verified locally (argon2id, admin TOTP 2FA, JWT `kid` rotation). **Not pushed** per operator instruction.
- **Batch C (client TypeScript foundation + TanStack Query/Zod + PWA + Android package-id repair):** ✅ foundation done, verified locally. Remaining: page-by-page TSX conversion, TanStack Query adoption per page, React Hook Form for forms, component library (shadcn/ui).
- **Batch D (delete Electron/Baileys/Mongo):** 🔄 Electron **removed**; Baileys + Mongo/Express **blocked** until the remaining Batch E cutover is complete (client still uses legacy `/api` for most domains).
- **Batch E (client cutover to `/api/v1`):** 🔄 first increment done — auth-wave routing flag (`VITE_API_V1`, default off) + platform→legacy user/permission bridge + parity harness; verified locally, not pushed. Remaining: cut over tenants/billing/admin and then commerce/catalog/finance/messaging. Prerequisite for Batch D.
