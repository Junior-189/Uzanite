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
| Auth: Google / staff login / theme | `/api/auth/google`, `/api/staff/login`, `/api/auth/theme` | — | legacy-only | platform has no equivalent |
| Two-factor | — (new) | `/api/v1/auth/login/2fa`, `/totp/*` | **ROUTED** | client UI added |
| Tenancy profile | `/api/businesses`, `/api/businesses/:id` | `/api/v1/tenants/me`, `/tenants/me/payment-methods` | **ROUTED** | adapter: `tenantBridge.ts` |
| Billing | `/api/billing/plans`, `/billing/status` | `/api/v1/billing/plans`, `/billing/status` | **READY** | client does not call billing yet |
| Notifications | `/api/notifications`, `/read-all`, delete-all | `/api/v1/notifications`, `/read-all`, `/notifications` | **ROUTED** | — (same shape) |
| Orders (list/get/status actions) | `/api/orders`, `/orders/:id/*` | `/api/v1/orders`, `/orders/:id/*` | **BLOCKED** | receipt endpoints (`/orders/:id/receipt`, `/send-receipt`) are legacy-only; confirm-payment proof differs |
| Payments (initiate/manual) | `/api/payments/orders/:id/{initiate,manual}` | `/api/v1/payments/orders/:id/{initiate,manual}` | **BLOCKED** | legacy accepts a multipart **proof image**; platform takes a `proofPath` string and has **no upload endpoint** |
| Products (CRUD/restock) | `/api/products`, `/products/:id/restock` | `/api/v1/products`, `/products/:id/restock` | **BLOCKED** | legacy `/products/bulk` (CSV import) and multipart image upload are not on the platform |
| Categories | (via products) | `/api/v1/categories` | **READY** | client does not call it directly |
| Receipts | `/api/orders/:id/receipt` | `/api/v1/receipts/order/:orderId` | **BLOCKED** | different path + response envelope |
| Messaging / WhatsApp | `/api/whatsapp/{status,qr,connect,disconnect,meta/credentials}` | `/api/v1/whatsapp/{account,templates,messages,conversations}` | **BLOCKED** | legacy QR/Baileys connect flow has no platform equivalent; per-tenant credentials shape differs |
| Contacts | `/api/contacts*` | (WhatsApp contacts only) | **BLOCKED** | dedicated contacts CRUD not implemented on the platform |
| Chat | `/api/chat/*` | — | **BLOCKED** | not implemented |
| Staff | `/api/staff*`, `/staff/me` | — | **BLOCKED** | staff management not implemented (memberships API exists but paths/shape differ) |
| Admin (tenants) | `/api/admin/users*` | `/api/v1/admin/tenants*` | **BLOCKED** | different path + shape; platform has no user/sub-admin CRUD |
| Admin (stats/flags/login-attempts) | `/api/admin/{stats,feature-flags,login-attempts}*` | — | **BLOCKED** | not implemented |
| Dashboard | `/api/dashboard/*` | — | **BLOCKED** | not implemented |
| Reports | `/api/reports/*` | — | **BLOCKED** | not implemented |
| Recycle bin | `/api/recycle-bin/*` | (per-entity restore only) | **BLOCKED** | aggregated recycle-bin API not implemented |
| Broadcast / email | `/api/broadcast/*` | — | **BLOCKED** | not implemented |
| Privacy | `/api/privacy/{export,erase}` | `/api/v1/privacy/{requests,consent,erase}` | **BLOCKED** | export path/shape differ |

## What this means

1. **The cutover cannot "finish" by deletion.** ~14 domains the client uses have **no platform implementation**. Completing the migration requires **building** those platform modules (staff/memberships-aligned, admin users, dashboard, reports, recycle-bin, broadcast, chat, contacts, WhatsApp account lifecycle, file uploads) — a multi-week effort, not a delete.
2. **Batch D is gated on that build.** Baileys can only be deleted once the platform (or a still-present legacy worker) owns WhatsApp; Mongo/Express can only be deleted once every domain above is cut over and reconciled.
3. **Uploads are a cross-cutting blocker.** Products (images) and payments (proof) both depend on a private file-upload endpoint on the platform, which does not exist yet. It should be the next platform build item after the auth/tenancy waves.
4. **Safe next cutovers** once parity passes: billing (already same paths), then products **without** upload/bulk, then orders **without** receipt.

## Recommended order to unblock Batch D

1. Platform: **file uploads** (signed, private) → unblocks products (images) and payments (proof).
2. Platform: **orders receipts** aligned to the client paths (or migrate the client call sites).
3. Platform: build **dashboard, reports, recycle-bin, admin users, staff, contacts, chat, broadcast**.
4. Cut over each domain (flag) with parity green + reconciliation.
5. Then delete **Baileys**, then **Mongo/Express** (Batch D completion).
