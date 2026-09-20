-- Phase M11: correctness & resilience hardening.
--
-- 1. Outbox multi-worker claim support: a `processing` state plus a `locked_at`
--    lease so replicas can claim work with SELECT ... FOR UPDATE SKIP LOCKED and
--    crashed claims can be recovered.
-- 2. Double-entry journal foundation written alongside the append-only
--    single-entry `ledger_entries` cash book, with balanced journal lines.
--
-- NOTE: `ALTER TYPE ... ADD VALUE` is permitted inside a transaction on
-- PostgreSQL 12+, provided the new value is not used in the same transaction.
ALTER TYPE "OutboxStatus" ADD VALUE IF NOT EXISTS 'processing' BEFORE 'published';

ALTER TABLE "outbox_events" ADD COLUMN "locked_at" TIMESTAMP(3);
CREATE INDEX "outbox_events_status_locked_at_idx" ON "outbox_events"("status", "locked_at");

-- ── Double-entry journal ─────────────────────────────────────────────────────
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ref_type" TEXT NOT NULL DEFAULT '',
    "ref_id" TEXT NOT NULL DEFAULT '',
    "dedupe_key" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "journal_id" UUID NOT NULL,
    "account" TEXT NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'TZS',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "journal_entries_tenant_id_dedupe_key_key" ON "journal_entries"("tenant_id", "dedupe_key");
CREATE INDEX "journal_entries_tenant_id_created_at_idx" ON "journal_entries"("tenant_id", "created_at");
CREATE INDEX "journal_entries_tenant_id_ref_type_ref_id_idx" ON "journal_entries"("tenant_id", "ref_type", "ref_id");
CREATE INDEX "journal_lines_tenant_id_journal_id_idx" ON "journal_lines"("tenant_id", "journal_id");
CREATE INDEX "journal_lines_tenant_id_account_created_at_idx" ON "journal_lines"("tenant_id", "account", "created_at");

ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_id_fkey"
  FOREIGN KEY ("journal_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Monetary invariant (defense in depth).
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_amount_positive" CHECK ("amount" > 0);

-- Append-only: block UPDATE and DELETE on the journal.
CREATE OR REPLACE FUNCTION journal_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% not permitted)', TG_TABLE_NAME, TG_OP;
END $$;

CREATE TRIGGER journal_entries_no_update BEFORE UPDATE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION journal_append_only();
CREATE TRIGGER journal_entries_no_delete BEFORE DELETE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION journal_append_only();
CREATE TRIGGER journal_lines_no_update BEFORE UPDATE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION journal_append_only();
CREATE TRIGGER journal_lines_no_delete BEFORE DELETE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION journal_append_only();

-- RLS + FORCE (uses helpers from 0003_rls).
ALTER TABLE "journal_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journal_entries" FORCE ROW LEVEL SECURITY;
ALTER TABLE "journal_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journal_lines" FORCE ROW LEVEL SECURITY;

CREATE POLICY journal_entries_isolation ON "journal_entries"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant());

CREATE POLICY journal_lines_isolation ON "journal_lines"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant());
