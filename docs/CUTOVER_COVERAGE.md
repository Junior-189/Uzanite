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
| Payments (initiate/manual) | `/api/payments/orders/:id/{initiate,manual}` | `/api/v1/payments/orders/:id/{initiate,manual}` | **PARTIAL** | platform now accepts `proofPath` (upload via `/api/v1/files`); client must upload first and send the key |
| Products (CRUD/restock) | `/api/products`, `/products/:id/restock` | `/api/v1/products`, `/products/:id/restock` | **READY** | routed (`/products`); responses alias `_id` + signed `imagePath`; client uploads image via `/api/v1/files`; legacy `/products/bulk` (CSV import) stays legacy-only |
| Categories | (via products) | `/api/v1/categories` | **READY** | client does not call it directly |
| Receipts | `/api/orders/:id/receipt`, `/orders/:id/send-receipt` | same `/api/v1/orders/:id/receipt` (PDF) + `send-receipt` | **READY** | platform renders the receipt PDF (pdfkit + QR) at the legacy path; `send-receipt` queues `receipt.send` |
| Expenses | `/api/expenses*` | `/api/v1/expenses*` | **READY** | routed; platform module built + tested (list/totals, create, hard delete). Legacy shape: `_id`, numeric `total` |
| Purchases | `/api/purchases*` | `/api/v1/purchases*` | **READY** | routed; platform module built + tested (idempotent by `clientRef`, multipart receipt upload + signed `receiptPath`, update, soft delete) |
| Debts | `/api/debts*` | `/api/v1/debts*` | **READY** | routed; platform module built + tested (list/totals, create/update, partial/full payment, reminders queued via outbox, soft delete). Client `apiAction` signature bug fixed |
| Reports | `/api/reports/summary`, `/reports/:key`, `/reports/:key/csv` | `/api/v1/reports/...` (same) | **READY** | routed; platform computes summary metrics + CSV/PDF for orders/products/expenses/purchases/debts/staff/full. PDF layout is a functional table design (legacy cover/chart styling is a visual follow-up), data is complete |
| Messaging / WhatsApp | `/api/whatsapp/{status,qr,connect,disconnect,meta/credentials}` | `/api/v1/whatsapp/{account,templates,messages,conversations}` | **BLOCKED** | legacy QR/Baileys connect flow has no platform equivalent; per-tenant credentials shape differs |
| Contacts | `/api/contacts*` | `/api/v1/contacts` | **READY** | routed; platform module built + tested (CRUD, soft delete/restore, chat history, outbox email) |
| Chat | `/api/chat/*` | — | **BLOCKED** | not implemented |
| Staff | `/api/staff*`, `/staff/me` | `/api/v1/staff*` | **READY** | routed; platform module built + tested (email login with `type:'staff'` tokens, owner-only CRUD, permissions, status, reset-password). Staff sessions use access tokens only (no refresh — `refresh_tokens` is FK-bound to users) |
| Admin (users) | `/api/admin/users*`, `/api/admin/sub-admins*`, `/api/admin/stats`, `/api/admin/impersonate/:id` | `/api/v1/admin/users*` etc. | **READY** | routed sub-paths; platform module built + tested (list/stats, approve/reject/suspend, update name/email, reset-password, delete, impersonate, sub-admin CRUD). Legacy shapes adapted (`_id`, `businessName`, counts) |
| Admin (feature-flags) | `/api/admin/feature-flags*` | `/api/v1/admin/feature-flags*` (legacy keyed shape) | **READY** | routed; global + per-tenant overrides, `{features,global}`/`{flags}` shapes, `/me` for tenants |
| Admin (activity-logs/login-attempts) | `/api/admin/{activity-logs,login-attempts}*` | `/api/v1/admin/...` (same) | **READY** | routed; list (page/page + filters) + summary for both, joined to user name/email |
| Recycle bin | `/api/recycle-bin`, `/restore/:type/:id`, `/:type/:id` | `/api/v1/recycle-bin` (same sub-paths, types: orders/products/contacts/notifications) | **READY** | routed; platform module covers all four client tabs |
| Broadcast / email | `/api/broadcast/*` | — | **BLOCKED** | not implemented |
| Privacy | `/api/privacy/{export,erase}` | `/api/v1/privacy/{requests,consent,erase}` | **BLOCKED** | export path/shape differ |

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
3. Platform: build the **WhatsApp tier — chat, broadcast, WhatsApp account lifecycle** (everything else is migrated: contacts, recycle-bin, products, orders+receipts, staff, admin users, expenses/purchases/debts, reports, admin flags/logs, theme, Google login).
4. Cut over each domain (flag) with parity green + reconciliation.
5. Then delete **Baileys**, then **Mongo/Express** (Batch D completion).
