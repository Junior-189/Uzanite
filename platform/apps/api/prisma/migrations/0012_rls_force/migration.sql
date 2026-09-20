-- Phase M10: Production hardening — FORCE Row Level Security.
--
-- Migrations 0003–0011 ENABLE RLS on every tenant-owned table. That is not
-- sufficient on its own: PostgreSQL exempts the table owner from policies
-- unless RLS is FORCED. FORCE makes the owner subject to the same policies as
-- a normal role, so a leaked/misconfigured owner connection is still contained
-- by RLS.
--
-- Enforcement model after this migration:
--   * The application connects as a NON-owner role (e.g. `uzanite_app`,
--     NOBYPASSRLS). See prisma/sql/ci-roles.sql.
--   * Migrations/ops run as the owner (or a superuser), which legitimately
--     bypasses policies.
--   * Every request/transaction sets `app.current_tenant` (tenant work) or
--     `app.bypass_rls = 'on'` (platform/system work). With neither set the
--     policies deny all rows (fail closed).
--   * Superusers and roles with BYPASSRLS still bypass RLS by PostgreSQL
--     design — the app role must NOT have either attribute.

-- ── Tenancy ──────────────────────────────────────────────────────────────────
ALTER TABLE "tenants"                FORCE ROW LEVEL SECURITY;
ALTER TABLE "memberships"            FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_settings"        FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_payment_methods" FORCE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions"          FORCE ROW LEVEL SECURITY;
ALTER TABLE "usage_counters"         FORCE ROW LEVEL SECURITY;

-- ── Catalog ──────────────────────────────────────────────────────────────────
ALTER TABLE "products"        FORCE ROW LEVEL SECURITY;
ALTER TABLE "stock_movements" FORCE ROW LEVEL SECURITY;
ALTER TABLE "categories"      FORCE ROW LEVEL SECURITY;

-- ── Commerce ─────────────────────────────────────────────────────────────────
ALTER TABLE "orders"               FORCE ROW LEVEL SECURITY;
ALTER TABLE "order_items"          FORCE ROW LEVEL SECURITY;
ALTER TABLE "order_status_history" FORCE ROW LEVEL SECURITY;
ALTER TABLE "order_counters"       FORCE ROW LEVEL SECURITY;

-- ── Finance ──────────────────────────────────────────────────────────────────
ALTER TABLE "payments"         FORCE ROW LEVEL SECURITY;
ALTER TABLE "payment_attempts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ledger_entries"   FORCE ROW LEVEL SECURITY;
ALTER TABLE "refunds"          FORCE ROW LEVEL SECURITY;

-- ── Notifications & Receipts ─────────────────────────────────────────────────
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
ALTER TABLE "receipts"      FORCE ROW LEVEL SECURITY;

-- ── Messaging ────────────────────────────────────────────────────────────────
ALTER TABLE "whatsapp_accounts"  FORCE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_templates" FORCE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_contacts"  FORCE ROW LEVEL SECURITY;
ALTER TABLE "messages"           FORCE ROW LEVEL SECURITY;

-- ── Conversations & Flow traces ──────────────────────────────────────────────
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "flow_traces"   FORCE ROW LEVEL SECURITY;
