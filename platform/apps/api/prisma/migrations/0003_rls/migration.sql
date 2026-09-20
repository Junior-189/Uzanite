-- Phase M2: Row Level Security (defense-in-depth) for tenant-owned tables.
--
-- Enforcement model:
--   * Migrations run as the table owner (RLS is NOT forced, so the owner bypasses).
--   * The application connects as a NON-owner role (e.g. uzanite_app) which is
--     subject to these policies.
--   * Each request/transaction sets the GUCs:
--       SET LOCAL app.current_tenant = '<tenant-uuid>';   -- tenant-scoped requests
--       SET LOCAL app.bypass_rls    = 'on';               -- platform/system work
--   * If neither is set, policies deny access (fail closed).
--
-- See platform/apps/api/prisma/sql/ci-roles.sql for the app-role grant example.

CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.current_tenant', true), '')::uuid
  $$;

CREATE OR REPLACE FUNCTION app_rls_bypass() RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT COALESCE(current_setting('app.bypass_rls', true), '') = 'on'
  $$;

-- ── Enable RLS on tenant-owned tables ───────────────────────────────────────
ALTER TABLE "tenants"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_settings"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_payment_methods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "usage_counters"         ENABLE ROW LEVEL SECURITY;

-- ── Policies ────────────────────────────────────────────────────────────────
-- tenants: a tenant row is visible when it is the active tenant (or bypass).
CREATE POLICY tenants_isolation ON "tenants"
  USING (app_rls_bypass() OR id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR id = app_current_tenant());

CREATE POLICY memberships_isolation ON "memberships"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant());

CREATE POLICY tenant_settings_isolation ON "tenant_settings"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant());

CREATE POLICY tenant_payment_methods_isolation ON "tenant_payment_methods"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant());

CREATE POLICY subscriptions_isolation ON "subscriptions"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant());

CREATE POLICY usage_counters_isolation ON "usage_counters"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant());
