-- =============================================================================
-- Phase M13 — Production hardening
--
-- 1. Stock dedupe keys become TENANT-SCOPED. The global unique index meant one
--    tenant's dedupe key could suppress another tenant's stock change (and, with
--    the claim-before-apply ordering in StockService, would silently report the
--    change as already applied). Isolation must extend to idempotency keys.
-- 2. Products gain a real category relation (the Category table previously had
--    no link to Product, leaving it orphaned/dead).
-- 3. WhatsApp contacts gain a consent audit trail (PDPA 2022).
-- 4. New `privacy_requests` table: append-only record of data-subject requests.
-- 5. Keyset index on whatsapp_contacts reordered to cover the compound cursor.
-- =============================================================================

-- ── 1. Tenant-scoped stock dedupe key ───────────────────────────────────────
DROP INDEX IF EXISTS "stock_movements_dedupe_key_key";
CREATE UNIQUE INDEX "stock_movements_tenant_id_dedupe_key_key"
  ON "stock_movements"("tenant_id", "dedupe_key");

-- ── 2. Product → Category relation ──────────────────────────────────────────
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "category_id" UUID;

ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_category_id_fkey";
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "products_tenant_id_category_id_id_idx"
  ON "products"("tenant_id", "category_id", "id");

-- ── 3. Consent audit trail on contacts ──────────────────────────────────────
ALTER TABLE "whatsapp_contacts" ADD COLUMN IF NOT EXISTS "consent_at" TIMESTAMP(3);
ALTER TABLE "whatsapp_contacts" ADD COLUMN IF NOT EXISTS "consent_source" TEXT NOT NULL DEFAULT '';

-- Backfill: existing rows consented implicitly when they were created.
UPDATE "whatsapp_contacts"
   SET "consent_at" = "created_at", "consent_source" = 'implied_pre_m13'
 WHERE "consent_at" IS NULL AND "consent_status" = 'granted';

-- ── 4. Privacy / data-subject request ledger ────────────────────────────────
CREATE TABLE "privacy_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_ref" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "requested_by" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "privacy_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "privacy_requests_tenant_id_created_at_idx" ON "privacy_requests"("tenant_id", "created_at");
CREATE INDEX "privacy_requests_tenant_id_subject_ref_created_at_idx"
  ON "privacy_requests"("tenant_id", "subject_ref", "created_at");

ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "privacy_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "privacy_requests" FORCE ROW LEVEL SECURITY;

CREATE POLICY privacy_requests_isolation ON "privacy_requests"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant());

-- Append-only: a compliance record must never be rewritten or deleted.
CREATE OR REPLACE FUNCTION privacy_requests_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'privacy_requests is append-only (attempted %)', TG_OP;
END;
$$;

CREATE TRIGGER privacy_requests_no_delete BEFORE DELETE ON "privacy_requests"
  FOR EACH ROW EXECUTE FUNCTION privacy_requests_append_only();

-- ── 5. Contacts keyset index covering (last_message_at, id) ─────────────────
DROP INDEX IF EXISTS "whatsapp_contacts_tenant_id_last_message_at_idx";
CREATE INDEX "whatsapp_contacts_tenant_id_last_message_at_id_idx"
  ON "whatsapp_contacts"("tenant_id", "last_message_at", "id");

-- ── Grants for the non-owner application role ───────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'uzanite_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "privacy_requests" TO uzanite_app;
  END IF;
END $$;
