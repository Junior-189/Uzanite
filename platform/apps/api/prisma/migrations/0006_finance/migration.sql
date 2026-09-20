-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('initiated', 'pending', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('manual', 'clickpesa', 'azampay');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('payment_in', 'cash_sale', 'refund', 'adjustment');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('credit', 'debit');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('succeeded', 'failed');

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "legacy_id" TEXT,
    "order_id" UUID,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'manual',
    "method" TEXT NOT NULL DEFAULT 'manual',
    "provider_ref" TEXT,
    "idempotency_key" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'TZS',
    "phone" TEXT NOT NULL DEFAULT '',
    "status" "PaymentStatus" NOT NULL DEFAULT 'initiated',
    "failure_reason" TEXT NOT NULL DEFAULT '',
    "proof_path" TEXT,
    "raw" JSONB NOT NULL DEFAULT '{}',
    "initiated_by" TEXT NOT NULL DEFAULT '',
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "request" JSONB NOT NULL DEFAULT '{}',
    "response" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'TZS',
    "ref_type" TEXT NOT NULL DEFAULT '',
    "ref_id" TEXT NOT NULL DEFAULT '',
    "dedupe_key" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "meta" JSONB NOT NULL DEFAULT '{}',
    "recorded_by" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "order_id" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'TZS',
    "reason" TEXT NOT NULL DEFAULT '',
    "status" "RefundStatus" NOT NULL DEFAULT 'succeeded',
    "provider_ref" TEXT,
    "idempotency_key" TEXT,
    "recorded_by" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_legacy_id_key" ON "payments"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_ref_key" ON "payments"("provider_ref");

-- CreateIndex
CREATE INDEX "payments_tenant_id_status_created_at_idx" ON "payments"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "payments_tenant_id_order_id_created_at_idx" ON "payments"("tenant_id", "order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenant_id_idempotency_key_key" ON "payments"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "payment_attempts_tenant_id_payment_id_created_at_idx" ON "payment_attempts"("tenant_id", "payment_id", "created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_tenant_id_created_at_idx" ON "ledger_entries"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_tenant_id_type_created_at_idx" ON "ledger_entries"("tenant_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_tenant_id_ref_type_ref_id_idx" ON "ledger_entries"("tenant_id", "ref_type", "ref_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_tenant_id_dedupe_key_key" ON "ledger_entries"("tenant_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "refunds_tenant_id_payment_id_created_at_idx" ON "refunds"("tenant_id", "payment_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_tenant_id_idempotency_key_key" ON "refunds"("tenant_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Finance hardening (Phase M5) ────────────────────────────────────────────

-- Non-negative monetary invariants (defense in depth).
ALTER TABLE "payments"        ADD CONSTRAINT "payments_amount_non_negative" CHECK ("amount" >= 0);
ALTER TABLE "ledger_entries"  ADD CONSTRAINT "ledger_entries_amount_non_negative" CHECK ("amount" >= 0);
ALTER TABLE "refunds"         ADD CONSTRAINT "refunds_amount_positive" CHECK ("amount" > 0);

-- Payments: financial fields are immutable, and status can only progress
-- forward (a succeeded payment may only become refunded; refunded is terminal).
CREATE OR REPLACE FUNCTION payments_guard_immutable() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.order_id        IS DISTINCT FROM OLD.order_id
     OR NEW.provider     IS DISTINCT FROM OLD.provider
     OR NEW.amount       IS DISTINCT FROM OLD.amount
     OR NEW.currency     IS DISTINCT FROM OLD.currency
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.created_at   IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'payments: financial fields are immutable';
  END IF;

  IF OLD.status = 'succeeded' AND NEW.status NOT IN ('succeeded', 'refunded') THEN
    RAISE EXCEPTION 'payments: cannot move a succeeded payment to %', NEW.status;
  END IF;
  IF OLD.status = 'refunded' AND NEW.status <> 'refunded' THEN
    RAISE EXCEPTION 'payments: a refunded payment is terminal';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER payments_immutable
  BEFORE UPDATE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION payments_guard_immutable();

-- Ledger entries are strictly append-only.
CREATE OR REPLACE FUNCTION ledger_entries_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only (% not permitted)', TG_OP;
END $$;

CREATE TRIGGER ledger_entries_no_update
  BEFORE UPDATE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_append_only();

CREATE TRIGGER ledger_entries_no_delete
  BEFORE DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_append_only();

-- Row Level Security for finance tables (uses the helpers from 0003_rls).
ALTER TABLE "payments"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_attempts"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ledger_entries"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refunds"           ENABLE ROW LEVEL SECURITY;

CREATE POLICY payments_isolation ON "payments"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant());

CREATE POLICY payment_attempts_isolation ON "payment_attempts"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant());

CREATE POLICY ledger_entries_isolation ON "ledger_entries"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant());

CREATE POLICY refunds_isolation ON "refunds"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant());
