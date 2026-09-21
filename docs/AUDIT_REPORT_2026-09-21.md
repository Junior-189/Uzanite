# UZANITE — Deep Audit Report

Date: 2026-09-21 · Scope: NestJS platform (`platform/`), legacy Express+Mongo (`src/`, `server.js`), React SPA (`client/`) · Method: static evidence review across 5 parallel passes + **runtime verification** (platform API + client dev server + Playwright).

> Evidence convention: `path:line`. Severity is impact-weighted for the Tanzanian SME context (money, WhatsApp, low bandwidth, bilingual, shared/low-end Android devices).

## Legend

- **Critical** — fix before broader production use; money loss, auth bypass, or cross-tenant exposure.
- **High** — fix in the next hardening cycle.
- **Medium** — schedule; real impact but bounded.
- **Low / Nice-to-have** — polish, hygiene, fidelity.

## What was verified at runtime

Ran the platform (`node dist/main.js`) against Postgres+Redis with RLS, plus the SPA dev server (`VITE_API_V1=true`), and drove Playwright:

- ✅ `GET /api/v1/health` 200, `/ready` 200 (`postgres: up, redis: up`), RLS safety check passed (`uzanite_app`, `bypassrls=false`), Helmet headers present, `x-api-version: v1`, unauth `/auth/me` → 401.
- ✅ Full auth flow: `POST /auth/register` → approve → `POST /auth/login` → SPA redirect to `/admin/dashboard` (SW UI renders, empty-state).
- ❌ `GET /api/v1/dashboard/stats?period=alltime` → **400** (contract mismatch, see H-API-1).
- ❌ PWA manifest requested at `/admin/admin/manifest.json` (double base path) → manifest fails to load (see M-UI-1).
- ✅ Client UI: EN/SW render, responsive at 360×640, authenticated shell + sidebar work.

---

## CRITICAL

### C1. MFA challenge token is accepted as a full access token (TOTP bypass)
`signMfaChallenge` mints an ordinary HS256 token with an extra `purpose:'mfa'` claim; `JwtAuthGuard` never rejects that purpose and builds a full principal. Anyone who knows the password can use the returned `mfaToken` as a Bearer token for ~5 minutes — and for a platform admin it even satisfies `AdminMfaGuard`.
Evidence: `platform/apps/api/src/security/token.service.ts:59-64`, `modules/identity/auth.service.ts:181-185`, `guards/jwt-auth.guard.ts:51-56,95-107`.
Fix: reject `purpose:'mfa'` (and `purpose` generally) in `JwtAuthGuard`; only the `/auth/login/2fa` handler may verify it. Add a test that the challenge token gets 401 on `/auth/me`.

### C2. Cross-tenant data leak through the offline store (shared device)
The SPA IndexedDB is not tenant-scoped: `fetchFromCacheOrApi` returns the previous tenant's cached products/orders/contacts **before** any network refresh, and the offline sync queue replays under the new user's token. Logout clears only `dashboardCache`.
Evidence: `client/src/db/index.js:3-20`, `client/src/db/helpers.js:19-23,40-51`, `client/src/db/sync.js:43-99`, `client/src/context/AuthContext.jsx:178-194`.
Fix: namespace Dexie by tenant/user (or clear all entity tables + sync queue on logout/user-change). Add a test asserting no cached rows survive a tenant switch.

### C3. Cash-order settlement can double-count revenue in the ledger
`confirmManual` is idempotent only if a `succeeded` Payment exists. Walk-in cash orders are persisted `PAID` with a `cash_sale` ledger credit but **no Payment row**; confirming payment on such an order creates a second manual payment and posts a **second** `payment_in` credit. Journals stay balanced, so reconciliation won't catch it.
Evidence: `modules/finance/payments.service.ts:207-279`, `modules/commerce/orders.service.ts:272-277,316-336`.
Fix: idempotency must also detect an existing order-level ledger entry / cash settlement before crediting.

### C4. Plan feature/usage limits are bypassable
Limits are enforced only by the HTTP `PlanGuard`. The WhatsApp conversation flow calls `ProductsService.create`/`OrdersService.create` directly, and CSV `bulkImportCsv` loops `create()` under a single guard evaluation — so products/orders can exceed plan caps.
Evidence: `modules/conversation/conversation.service.ts:316-335`, `modules/catalog/products.service.ts:133-187`, `guards/plan.guard.ts:15-53`.
Fix: enforce limits inside the service (single choke point), and enforce a per-request import ceiling.

---

## HIGH — Security

### H-SEC-1. RLS `FORCE` missing on newer tenant tables
`staff`, `expenses`, `purchases`, `debts`, `broadcast_logs` `ENABLE` RLS but never `FORCE ROW LEVEL SECURITY`, and the boot assertion only inspects `tenants`. If any deployment connects as the table owner, isolation silently fails for those tables.
Evidence: `prisma/migrations/0019_staff/migration.sql:32`, `0021_finance_ledgers/migration.sql:97-99`, `0023_broadcast/migration.sql:23`, `src/prisma/prisma.service.ts:171-197`.
Fix: `ALTER TABLE … FORCE ROW LEVEL SECURITY` for every tenant table; extend the boot check to all `TENANT_SCOPED_MODELS`.

### H-SEC-2. Google sign-in trusts unverified email
Only `sub/aud/exp` are checked; `email_verified`/`iss` are ignored, and both staff and user lookups are by email → account takeover if the identity provider ever issues an unverified email.
Evidence: `modules/identity/auth.service.ts:369-378,385,408`.
Fix: require `email_verified === true` and verify `iss`; reject otherwise.

### H-SEC-3. Admin MFA is self-defeatable
`AdminMfaGuard` only needs `totpEnabledAt`; enrollment needs only a session. A password-compromised admin can enroll their own authenticator and pass.
Evidence: `guards/admin-mfa.guard.ts:21-32`, `modules/identity/auth.controller.ts:117-127`.
Fix: require MFA setup out-of-band (or admin-only bootstrap), and step-up verification for sensitive actions.

### H-SEC-4. Impersonation tokens are unrestricted owner sessions
`act`/`impersonatedBy` is audit-only; no downstream restriction. An impersonation token carries `role:'owner'` with full permissions for 30 min.
Evidence: `modules/admin/admin.service.ts:116-127`, `modules/admin/admin-users.service.ts:325-336`, `guards/jwt-auth.guard.ts:138`.
Fix: honour a page-permission scope on impersonation (legacy did), block destructive/money actions, shorten TTL.

### H-SEC-5. Manager bypasses `manage_staff` (intra-tenant privilege escalation)
`PermissionsGuard` short-circuits `@RequirePermission` for `owner` **and** `manager`, so a manager can mutate members and grant the manager role.
Evidence: `guards/permissions.guard.ts:6,21-22`, `modules/tenancy/memberships.controller.ts:21`, `contracts/permissions.ts:5-10,35-54`.
Fix: only `owner`/platform-admin bypass owner-only permissions; give manager an explicit permission set.

### H-SEC-6. Rate limiter fails open on Redis outage
On any Redis error the guard logs and returns `true`, disabling throttling (and lockout depends on Redis) for all decorated routes.
Evidence: `guards/rate-limit.guard.ts:83-90`.
Fix: fail closed (or degrade to an in-process limiter) for auth/admin/webhook scopes.

### H-SEC-7. JWT key retirement absent
Unknown/missing `kid` falls back to default/active, and keys in `JWT_KEYS` stay valid forever.
Evidence: `security/jwt-keys.service.ts:94-111`.
Fix: optional `notAfter` per key; reject retired kids.

### H-SEC-8. WhatsApp QR pairing leaked to a third party
The client fallback renders the QR via `api.qrserver.com` with the pairing payload in the URL.
Evidence: `client/src/pages/WhatsApp.jsx:199`.
Context: the platform now returns 400 for `/whatsapp/qr|connect` (Meta has no QR), so this is the legacy path — but ship the client fix regardless.

---

## HIGH — Reliability / correctness / performance

### H-REL-1. Inbound conversation can be permanently lost
The webhook claims the message (dedupes) and commits, then runs the flow inline; the `whatsapp.inbound` outbox event is a **log-only no-op**, so a crash between claim and processing drops the message with no re-drive.
Evidence: `modules/conversation/whatsapp-webhook.controller.ts:68-78`, `modules/messaging/whatsapp-webhook.service.ts:128-134`, `apps/worker/src/consumers/outbox-dispatcher.service.ts:322-324`.
Fix: make the outbox event the durable driver (enqueue with payload; worker re-processes).

### H-REL-2. Worker crash strands outbound WhatsApp in `sending` forever
Claim moves `queued→sending`; the tick only selects `queued`, and `sendOne` skips non-`queued`. No lease/`lockedAt` recovery.
Evidence: `apps/worker/src/messaging/whatsapp-outbound.service.ts:50-65,110-122`.
Fix: lease + timeout reclaim (as the outbox publisher already does).

### H-REL-3. Payment provider adapters read env before `.env` loads
`cfg` captures `process.env.*` at module eval; `@nestjs/config` loads `.env` later → `enabled()` false in `.env` deployments, and `initiate` silently parks payments as `pending` with no provider call. Keys are also absent from the validated env schema.
Evidence: `modules/finance/payments/clickpesa.adapter.ts:13-18`, `azampay.adapter.ts:12-18`, `payments.service.ts:153-159`.
Fix: read config lazily from `ConfigService`; add keys to `config/env.ts`.

### H-REL-4. Unbounded reads on growing tables
Dashboard, reports, staff, broadcast and debts load whole tenant tables into memory (no `take`).
Evidence: `modules/dashboard/dashboard.service.ts:49-55`, `modules/reports/reports.service.ts:70-77,116-119,…`, `modules/staff/staff.service.ts:147-149`, `modules/broadcast/broadcast.service.ts:102-111`.
Fix: aggregate in SQL (`groupBy`/`$queryRaw`) or add hard ceilings/pagination.

### H-REL-5. N+1 write amplification in order creation
`resolveItems` queries per line item; `changeStock` calls `applyChange` per item (2–5 queries each) inside the request/RLS transaction.
Evidence: `modules/commerce/orders.service.ts:148-216`, `modules/catalog/stock.service.ts:47-157`.
Fix: batch product fetch; batch stock updates or accept per-item with a bounded order size.

### H-REL-6. Plaintext PII + unencrypted backups by default; no PITR
Customer/contact/staff PII and message bodies are plaintext columns; `backup-postgres.sh` writes an **unencrypted** dump if `BACKUP_ENCRYPTION_PASSPHRASE` is unset; PITR is documentation-only.
Evidence: `prisma/schema.prisma:574-578,970-976,1009-1011,1037-1083`, `scripts/backup-postgres.sh:77-90`, `docs/DISASTER_RECOVERY.md:9-16`.
Fix: require the passphrase in production; enable WAL/PITR; evaluate column encryption or tokenisation for phone/email.

### H-REL-7. Usage limits are check-then-increment (TOCTOU)
`checkLimit` reads a 60s-cached snapshot; concurrent requests all pass before counters catch up.
Evidence: `modules/billing/billing.service.ts:179-214`, `guards/plan.guard.ts:38-50`.
Fix: reserve/atomic counter with a DB constraint or `SELECT … FOR UPDATE`.

---

## HIGH — API / client contracts

### H-API-1. Dashboard/orders period enum mismatch (runtime-confirmed)
Platform `orderPeriod` is `['daily','weekly','monthly','yearly','all']`; the client's `PeriodFilter` sends `annually` and `alltime`.
- `GET /api/v1/dashboard/stats?period=alltime` → **400** (observed with Playwright).
- Orders/reports period filters share `orderPeriod`, so `annually` will 400 there too.
Evidence: `contracts src/commerce.ts:8`, `contracts src/dashboard.ts:4-8`, `client/src/components/PeriodFilter.jsx:3-8`, `client/src/pages/Dashboard.jsx`.
Fix: align the enum (accept `annually`/`alltime` as aliases) or normalise client values.

### H-API-2. Product create/update rejects the client's own payload
The SPA posts `clientRef` (and the offline path can send `image`), but `createProductSchema` is `.strict()` and omits `clientRef` → **400**. Confirmed on the routed path.
Evidence: `contracts src/catalog.ts:4-23`, `client/src/pages/Products.jsx:86,98`, `client/src/db/helpers.js:70,91`.
Fix: accept `clientRef` in the schema (or drop it client-side); add `FileInterceptor('image')` support or route uploads through `/files`.

### H-API-3. RBAC absent on core reads
Orders/products/dashboard/notifications list+get carry no `@RequirePermission`, and `PermissionsGuard` allows when no metadata is present.
Evidence: `guards/permissions.guard.ts:17`, `modules/commerce/orders.controller.ts:21-26`, `catalog/products.controller.ts:21-27`.
Fix: annotate reads (or default-deny by role).

### H-API-4. Admin feature-flags endpoints lack MFA
`FeatureFlagsController` is the only admin controller without `@UseGuards(AdminMfaGuard)`.
Evidence: `modules/admin/feature-flags.controller.ts:18-21` vs `admin.controller.ts:24`, etc.
Fix: add the guard.

### H-API-5. Expenses/debts accept but ignore `clientRef` (retry double-write)
The offline queue always attaches `clientRef`; the service never reads it → duplicate rows on retry.
Evidence: `contracts src/finance-ledger.ts:12,76`, `modules/ledgers/expenses.service.ts:33-45`, `debts.service.ts:50-65`.
Fix: honour `clientRef` (unique `(tenant_id, client_ref)` like purchases) or drop it from the client.

---

## MEDIUM (selected)

- **Offline order actions report false success** and are silently discarded (`client/src/pages/Orders.jsx:97-109`).
- **Payments split-brain**: `Purchases.jsx` writes via raw legacy `fetch` while reads route to the platform (`client/src/pages/Purchases.jsx:76,114,133`).
- **Impersonation exit is a `ReferenceError`** — `restoreAdminSession`/`clearSession` are never imported (`client/src/components/Layout.jsx:41,44`, `Sidebar.jsx:184,187`).
- **Stale `openapi.json`** documents removed routes and omits ~20 modules (`platform/apps/api/openapi.json:540`).
- **Offset vs keyset pagination** mixed (admin logs use `page`); inconsistent max limits (100/200/500).
- **`hasToken`/PWA manifest**: manifest path double-prefixed under base `/admin/` (runtime-confirmed).
- **No CSP on Netlify** (`client/netlify.toml` has no `[[headers]]`), while Express-served SPA has Helmet CSP.
- **Dead weight**: TanStack Query mounted but unused (`client/src/lib/queryClient.ts`).
- **Stock restore fails if the product was soft-deleted** (`modules/catalog/stock.service.ts:88-107`).
- **Duplicate route/prefix surface**: three controllers on `admin`, two on `whatsapp`; duplicate impersonation/confirm-payment/account endpoints.
- **Concurrency**: manual-confirm P2002 unhandled (`payments.service.ts:220-244`); first-message conversation P2002; refresh rotation not atomic.
- **PII retention gaps**: messages/contacts/orders not swept; retention covers only traces/events/logins/activity.
- **Security hygiene**: non-constant-time `META_VERIFY_TOKEN` compare; `STORAGE_SIGNING_SECRET`/`ENCRYPTION_KEY` not strictly validated; metrics token allowed via query string (logged); CSV formula injection in report export; unescaped names in email HTML.
- **Frontend a11y**: labels not associated; clickable rows/cards lack keyboard activation (`ClickableRow` unused); modal has no focus trap; touch targets <44px; no safe-area insets.
- **i18n drift**: catalogues complete but hardcoded English remains (`App.jsx:106-107`, `TopBar.jsx:9-24`, `Sidebar.jsx:9-38`).
- **Bundle/network**: full Font Awesome + 2 Google Fonts render-blocking with no SRI; i18n loads both languages; large vendor chunks.
- **Low-end devices**: continuous `requestAnimationFrame` barcode detection; camera at 1280×720.
- **Logout hash redirect** uses `#/login` with `BrowserRouter` (Capacitor) → wrong screen.

## LOW (selected)

Duplicated FAQ/carousel components; `PAGE_PERMISSION_MAP` duplicated and divergent; `document.write` barcode print blocked under CSP; `imgUrl` allows arbitrary remote https; hardcoded third-party download link; toast div not keyboard dismissible; `AdminPanel.jsx` 1210-line monolith; misc route naming (`ledger`, `dashboard` singular).

---

## Area-by-area index (your checklist 1–16)

| # | Area | Headline findings |
|---|---|---|
| 1 | API design/endpoints | H-API-3/4, duplicate prefixes/endpoints, response-envelope inconsistency, stale OpenAPI |
| 2 | Security | C1, H-SEC-1…8, MFA/RBAC/impersonation, webhook HMAC OK, no SSRF, CORS/CSRF OK |
| 3 | Rate limiting/abuse | Redis-backed (multi-instance OK) but **fails open**; missing limits on files/tenants; no lockout on 2FA step |
| 4 | Database | Strong money/ledger/stock invariants; RLS FORCE gaps, missing `(tenant_id,id)` indexes, unbounded reads, plaintext PII |
| 5 | Pagination | Keyset generally; offset in admin logs; helper ignores `orderBy`; limits inconsistent |
| 6 | Caching/CDN | Redis read-through (membership/billing/flags) with explicit invalidation; no pub/sub; static assets missing CSP/immutable headers on Netlify |
| 7 | Business logic | C3 cash double-credit, C4 limit bypass, stock/conversation edge cases, refund doesn't restore stock |
| 8 | Long-term architecture | Coherent modular monolith; `OrdersService`/`PaymentsService` god-objects; Commerce↔Finance coupling |
| 9 | Scale/high load | API stateless; worker per-replica sweeps + multiple Prisma pools + blocking Redis; N+1; missing pool sizing |
| 10 | Load balancing | Stateless, no affinity needed; nginx `least_conn` configured; storage is the only stateful coupling |
| 11 | Versioning | `/api/v1` global prefix; no v2/deprecation path actually applied (`ApiDeprecated` unused) |
| 12 | Vulnerabilities | MFA bypass (C1), Google email trust, dependency risk (legacy baileys), secret/default-cred hygiene |
| 13 | Frontend/UI | Solid routing/lazy splitting; dead react-query; duplicate components; monolith admin page |
| 14 | UX/security | C2 cache leak, third-party QR, offline false success, native dialogs, EN/SW drift |
| 15 | Data protection | RLS design strong; PII plaintext; backups unencrypted by default; retention partial |
| 16 | Low bandwidth/devices | Good lazy-splitting, but heavy vendor/i18n, render-blocking external assets, no offline image strategy |

## Areas you didn't list (senior additions)

- **Compliance/PDPA**: you have erasure/consent/export endpoints and retention sweeps — add a DPIA record, consent-version tracking, and a documented lawful-basis matrix; the admin "erase" is intentionally subject-scoped (documented).
- **PCI scope**: card data is not stored (provider-hosted) — keep it that way; never log provider payloads with PANs.
- **Backup/DR drills**: schedule a quarterly restore drill; verify RPO/PITR, not just dump success.
- **Dependency/SBOM**: no automated SCA/SBOM in CI; add `pnpm audit`/OSV + Dependabot; retire the legacy `baileys` dependency.
- **Secret rotation**: `ENCRYPTION_KEY` has no rotation envelope (key-id + re-encrypt job needed).
- **SLOs/on-call**: define availability/latency SLOs; worker has no health endpoint; no alert catalogue wired to the metrics you already expose.
- **Cost efficiency**: unbounded queries + per-replica workers are the main cost/pressure levers.
- **Support tooling**: no impersonation-scoped support view safeguards beyond audit.
- **Localization QA**: EN/SW key parity is enforced, but screenshots/overflow and hardcoded strings need a lint rule.
- **Kill switches**: feature flags exist — wire them to the WhatsApp/payments paths as emergency switches.
- **Developer experience**: excellent runbooks/CI for the platform; document legacy-vs-platform run modes to reduce onboarding confusion.

## Prioritised remediation roadmap

**Now (Critical/High security + money)**
1. Reject `purpose:'mfa'` tokens in `JwtAuthGuard` (+test). (C1)
2. Tenant-scope the offline store and clear it on logout. (C2)
3. Fix cash-order settle idempotency. (C3)
4. Enforce plan limits in services; cap CSV import. (C4)
5. `FORCE RLS` on the 5 newer tables + extend the boot assertion. (H-SEC-1)
6. Require Google `email_verified`; fix `PermissionsGuard` manager bypass. (H-SEC-2/5)
7. Fix `period` enum mismatch (`alltime`/`annually`) and product `clientRef`. (H-API-1/2)

**Next (reliability/scale)**
8. Durable inbound recovery + outbound lease reclaim. (H-REL-1/2)
9. Lazy provider config; require backup passphrase + PITR. (H-REL-3/6)
10. Bound dashboard/report/broadcast queries; batch order stock writes. (H-REL-4/5)

**Then (hardening/polish)**
11. MFA guard on feature-flags; impersonation scoping; atomic refresh/manual-confirm.
12. Retire TanStack Query or adopt it; fix impersonation exit; add Netlify CSP; manifest path.
13. A11y pass (labels, keyboard rows, modal focus, 44px targets) + i18n hardcoded-string lint.
14. Add SCA/SBOM + destructive-migration gate to CI.

---

## Remediation log (2026-09-21)

**Fixed (commits on `feat/platform-strangler-migration`):**

- **Critical:** C1 MFA-token bypass; C2 cross-tenant offline cache; C3 cash-order double-credit; C4 plan-limit bypass (service choke point + CSV cap). Plus the runtime-found period-enum 400 and product `clientRef`/image 400.
- **High security:** FORCE RLS on all tenant tables + boot assertion; Google `email_verified`/issuer; TOTP enrol step-up (password); impersonation read-only; PermissionsGuard owner-only; rate limiter fails closed for auth/admin/webhook/payments; JWT `notAfter`; third-party QR removed; RBAC on core reads; expenses/debts `clientRef` idempotency.
- **High reliability/perf:** durable inbound (claim release + idempotent message insert via unique `(tenant_id, provider_message_id)`); worker outbound lease reclaim; lazy provider config; dashboard SQL aggregates + report/broadcast/staff caps; batched order item lookup; atomic order plan-limit; backup refuses unencrypted dumps.
- **Medium/Low (selected):** constant-time verify-token; metrics token header-only; CSV formula-injection; atomic refresh rotation; env requires `STORAGE_SIGNING_SECRET`; `(tenant_id,id)` keyset indexes + finance CHECK constraints; feature-flag global cache generation; optional message-body redaction; frontend (impersonation exit, offline false-success, purchases routed writes, Netlify CSP, Modal focus trap, keyboard rows, labels, safe-area, TanStack removal, barcode throttle, Reports invalid-date/XHR).
- Regenerated `openapi.json`.

### Second remediation pass (all remaining tracked items, tested)

- **Correctness:** conversation optimistic concurrency (upsert + version, migration 0028); full refund restores stock (StockReason.refund, migration 0029); provider amount/currency mismatch raises an operator notification + outbox event.
- **Worker/infra:** single shared Prisma pool; Redis leader election for retention/reconciliation; outbox dead-letters now land on the `dlq` queue with an admin replay endpoint.
- **Consolidation:** removed the duplicate tenant impersonation route and the admin tenant-erase stub.
- **Security:** `ENCRYPTION_KEY` rotation via `ENCRYPTION_KEYS_PREVIOUS` (decrypt-only fallback) + test.
- **Frontend:** approval routes i18n (EN/SW); self-hosted Font Awesome + dropped the Google Fonts CDN (no third-party render-blocking assets).

### Genuinely remaining (documented, low risk or structural)

These are **accepted risks / structural work**, not defects, and are tracked here rather than rushed:

- **PII column-level encryption** for order/contact PII: conflicts with the platform's server-side search/filter predicates (would need blind indexes). Compensating controls in place: RLS + FORCE, non-owner app role, at-rest disk encryption, and secret-field encryption with a rotation path.
- **`OrdersService`/`PaymentsService` god-object extraction** into narrower domain services (structural; behavior already covered by tests).
- **Client list pagination UI** on contacts/expenses/debts/purchases/staff (the platform caps/paginates reads; the pages currently render the first page). No data loss — follow-up UX work.
- **Replace native `confirm`/`prompt` dialogs** (~20 sites) with in-app modals for embedded-webview reliability.
- **De-duplicate frontend components** (`FAQAccordion`, `TestimonialCarousel`, `ClickableRow` vs `rowActivate`) and finish i18n for the remaining hardcoded label maps (TopBar/Sidebar/Reports).
- **PWA PNG/maskable icons** (currently SVG).


### Structural pass (third) — completed

- **PII framework**: `pii.ts` (AES-256-GCM + keyed blind index) with unit tests; applied to `Order.customerEmail`/`deliveryLocation`/`deliveryPhone` (encrypted at rest, decrypted on read). `ENCRYPTION_KEY` rotation via `ENCRYPTION_KEYS_PREVIOUS`.
- **God-object**: extracted `OrderIntakeService` (race-free numbering + server-authoritative item pricing) out of `OrdersService`.
- **Worker**: single shared Prisma client; Redis leader election for sweeps; outbox dead-letter queue + admin replay.
- **Frontend**: cursor pagination (Load more) on contacts/expenses/debts/purchases via a reusable hook; in-app confirm/prompt dialogs replacing all native call sites (webview-safe); removed duplicate components; nav labels moved to i18n; self-hosted Font Awesome (dropped the Google Fonts CDN); 192/512 + maskable PNG icons.

### One remaining, decision-gated item

- **Blind-index encryption for *searchable* PII** (`Order.customerName/Phone`, `WhatsAppContact.name/phone/email`, `Staff/User.email`): the framework is in place (`blindIndex`), but switching these columns to ciphertext changes search semantics from substring (`contains`) to exact match. That is a product decision (do operators need partial-name search?). Recommended path: add `*_idx` blind-index columns, move equality lookups (login, contact upsert, order-by-phone) to them, and confirm/drop `contains` search. Deliberately not forced here.
