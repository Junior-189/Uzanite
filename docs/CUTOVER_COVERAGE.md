# UZANITE — Strangler Cutover Coverage Matrix

**Purpose:** the honest, per-domain status of moving the React client from the legacy
Express API (`/api`) to the NestJS platform (`/api/v1`). It exists because the
platform does **not** implement every endpoint the client uses, so "finish the
cutover / delete the legacy app" is gated on building those domains — not on a
deletion step.

Legend: **ROUTED** = flag routes it today, contract matches · **READY** = covered
by the platform, safe to route once parity passes · **BLOCKED** = platform does
not implement (or does not match) the endpoint the client calls.

Cutover flag: `VITE_API_V1` (default **off**). See `client/src/utils/apiRouting.ts`.

| Client surface | Legacy endpoint(s) | Platform endpoint(s) | Status | Blocker |
|---|---|---|---|---|
| Auth (login/refresh/logout/register/forgot/reset/change-password/me) | `/api/auth/*` | `/api/v1/auth/*` | **ROUTED** | — (adapter: `platformBridge.ts`) |
| Auth: Google / staff login / theme | `/api/auth/google`, `/api/staff/login`, `/api/auth/theme` | `/api/v1/auth/google`, `/api/v1/staff/login`, `/api/v1/auth/theme` | **READY** | routed; Google ID-token sign-in (tokeninfo verify) incl. staff-by-email and pending tenant sign-ups |
| Two-factor | — (new) | `/api/v1/auth/login/2fa`, `/totp/*` | **ROUTED** | client UI added |
| Tenancy profile | `/api/businesses`, `/api/businesses/:id` | `/api/v1/tenants/me`, `/tenants/me/payment-methods` | **ROUTED** | adapter: `tenantBridge.ts` |
| Billing | `/api/billing/plans`, `/billing/status` | `/api/v1/billing/plans`, `/billing/status` | **READY** | client does not call billing yet |
| Notifications | `/api/notifications`, `/read-all`, delete-all | `/api/v1/notifications`, `/read-all`, `/notifications` | **ROUTED** | — (same shape) |
| Dashboard | `/api/dashboard/stats` | `/api/v1/dashboard/stats` | **ROUTED** | — (platform module built; same `{success, stats}` shape) |
| File uploads | — | `POST /api/v1/files` (+ signed `GET /files/:key`) | **READY** | platform module built (`files`); client upload call sites wired during products/payments cutover |
| Orders (list/get/status actions) | `/api/orders`, `/orders/:id/*` | `/api/v1/orders`, `/orders/:id/*` | **READY** | routed; `_id` alias; legacy POS extras accepted (cash → PAID/DELIVERED via manual path); receipts now platform-served |
| Payments (initiate/manual) | `/api/payments/orders/:id/{initiate,manual}` | `/api/v1/payments/orders/:id/{initiate,manual}` | **READY** | routed; client uploads the proof via `/api/v1/files` and sends `proofPath` |
| Products (CRUD/restock/import) | `/api/products`, `/products/:id/restock`, `/products/bulk` | `/api/v1/products`, `/products/:id/restock`, `/products/bulk` | **READY** | routed (`/products`); responses alias `_id` + signed `imagePath`; image + CSV bulk import handled by the platform |
| Categories | (via products) | `/api/v1/categories` | **READY** | client does not call it directly |
| Receipts | `/api/orders/:id/receipt`, `/orders/:id/send-receipt` | same `/api/v1/orders/:id/receipt` (PDF) + `send-receipt` | **READY** | platform renders the receipt PDF (pdfkit + QR) at the legacy path; `send-receipt` queues `receipt.send` |
| Expenses | `/api/expenses*` | `/api/v1/expenses*` | **READY** | routed; platform module built + tested (list/totals, create, hard delete). Legacy shape: `_id`, numeric `total` |
| Purchases | `/api/purchases*` | `/api/v1/purchases*` | **READY** | routed; platform module built + tested (idempotent by `clientRef`, multipart receipt upload + signed `receiptPath`, update, soft delete) |
| Debts | `/api/debts*` | `/api/v1/debts*` | **READY** | routed; platform module built + tested (list/totals, create/update, partial/full payment, reminders queued via outbox, soft delete). Client `apiAction` signature bug fixed |
| Reports | `/api/reports/summary`, `/reports/:key`, `/reports/:key/csv` | `/api/v1/reports/...` (same) | **READY** | routed; platform computes summary metrics + CSV/PDF for orders/products/expenses/purchases/debts/staff/full. PDF layout is a functional table design (legacy cover/chart styling is a visual follow-up), data is complete |
| Messaging / WhatsApp | `/api/whatsapp/{status,meta/credentials,disconnect,pause,resume}` | `/api/v1/whatsapp/*` | **READY** | routed; legacy adapters over the platform account (`status`, `meta/credentials` GET/POST, `disconnect`, `pause/resume`). `/connect` + `/qr` are Baileys-only and return 400 — the client uses the Meta credentials path |
| Contacts | `/api/contacts*` | `/api/v1/contacts` | **READY** | routed; platform module built + tested (CRUD, soft delete/restore, chat history, outbox email) |
| Chat | `/api/chat/:phone`, `/api/chat/send` | `/api/v1/chat/:phone`, `/api/v1/chat/send` | **READY** | routed; `/chat/:phone` maps to message history, `/chat/send` enqueues over the Meta send path |
| Staff | `/api/staff*`, `/staff/me` | `/api/v1/staff*` | **READY** | routed; platform module built + tested (email login with `type:'staff'` tokens, owner-only CRUD, permissions, status, reset-password). Staff sessions now refresh (polymorphic `refresh_tokens`) |
| Admin (users) | `/api/admin/users*`, `/api/admin/sub-admins*`, `/api/admin/stats`, `/api/admin/impersonate/:id` | `/api/v1/admin/users*` etc. | **READY** | routed sub-paths; platform module built + tested (list/stats, approve/reject/suspend, update name/email, reset-password, delete, impersonate, sub-admin CRUD). Legacy shapes adapted (`_id`, `businessName`, counts) |
| Admin (feature-flags) | `/api/admin/feature-flags*` | `/api/v1/admin/feature-flags*` (legacy keyed shape) | **READY** | routed; global + per-tenant overrides, `{features,global}`/`{flags}` shapes, `/me` for tenants |
| Admin (activity-logs/login-attempts) | `/api/admin/{activity-logs,login-attempts}*` | `/api/v1/admin/...` (same) | **READY** | routed; list (page/page + filters) + summary for both, joined to user name/email |
| Admin (queues) | `/api/admin/queues`, `/api/admin/queues/dead-letters` | `/api/v1/admin/queues` (same) | **READY** | platform exposes queue job counts + dead letters |
| Admin (privacy) | `/api/admin/privacy/tenants/:id/{export,erase}` | `/api/v1/admin/privacy/tenants/:id/export` | **PARTIAL** | export ported; tenant-wide erasure intentionally not supported (subject-scoped `/privacy/erase` instead) |
| Recycle bin | `/api/recycle-bin`, `/restore/:type/:id`, `/:type/:id` | `/api/v1/recycle-bin` (same sub-paths, types: orders/products/contacts/notifications) | **READY** | routed; platform module covers all four client tabs |
| Broadcast / email | `/api/broadcast/*` | `/api/v1/broadcast/*` (same) | **READY** | routed; send (whatsapp/email/both) fans out to opted-in contacts via the messaging outbox, contacts list/count/add/import, `/sent` log; gated by `broadcast` feature + `broadcastsPerMonth` |
| Privacy | `/api/privacy/{export,erase}` | `/api/v1/privacy/{export,erase,consent,requests}` | **READY** | routed; export returns a JSON download, erase is subject-scoped (`phone`/`email`) and pseudonymises financial records |

## What this means

1. **The cutover cannot "finish" by deletion.** Three domains the client uses still have **no platform implementation**: **broadcast, chat, WhatsApp account lifecycle** — all blocked on the Meta Cloud API transport (the platform deliberately has no Baileys). Completing the migration requires building those plus deciding the transport architecture.
2. **Batch D is gated on that build.** Baileys can only be deleted once the platform (or a still-present legacy worker) owns WhatsApp; Mongo/Express can only be deleted once every domain above is cut over and reconciled.
3. **Uploads are now resolved.** ✅ Platform `POST /api/v1/files` (private, content-sniffed, HMAC-signed downloads) unblocks product images and payment proofs. Wiring the client upload call sites is the remaining client work.
4. **Dashboard is now resolved.** ✅ Platform `GET /api/v1/dashboard/stats` mirrors the legacy shape and is routed.
5. **Cutovers landed so far**: auth, tenants, billing, notifications, dashboard, payments (proof upload), files, contacts, recycle-bin, products (bulk CSV stays legacy-only).

## Progress log

| Item | Status |
|---|---|
| Electron | ✅ removed |
| Platform file uploads (`/api/v1/files`) | ✅ built + tested (migration 0017, `stored_files` RLS) |
| Platform dashboard (`/api/v1/dashboard/stats`) | ✅ built + tested + routed |
| Platform recycle bin (`/api/v1/recycle-bin`) | ✅ built + tested (orders/products/contacts/notifications) — routed |
| Payment-proof uploads wired (client) | ✅ `/api/v1/files` upload → `proofPath` |
| Notifications cutover | ✅ routed |
| Auth / tenancy / billing | ✅ routed / ready |
| Baileys, Mongo/Express | ⛔ blocked on the remaining platform domains |

## Recommended order to unblock Batch D

1. ✅ Platform: file uploads.
2. ✅ Platform: dashboard.
3. **All client-facing domains + admin/ops surface are migrated.** The remaining work is the final legacy removal (Baileys transport, MongoDB models, Express routes) once the platform runs production traffic for a soak period — see `docs/LEGACY_REMOVAL_PLAN.md`.
4. Cut over each domain (flag) with parity green + reconciliation.
5. Then delete **Baileys**, then **Mongo/Express** (Batch D completion).
