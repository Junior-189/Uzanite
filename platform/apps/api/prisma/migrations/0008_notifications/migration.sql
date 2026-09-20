-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('low', 'normal', 'high', 'critical');

-- CreateEnum
CREATE TYPE "ReceiptType" AS ENUM ('order', 'payment');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "priority" "NotificationPriority" NOT NULL DEFAULT 'normal',
    "read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "dedupe_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "ReceiptType" NOT NULL,
    "order_id" UUID,
    "payment_id" UUID,
    "receipt_number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "currency" CHAR(3) NOT NULL DEFAULT 'TZS',
    "amount" DECIMAL(14,2) NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "storage_key" TEXT,
    "dedupe_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_tenant_id_read_created_at_idx" ON "notifications"("tenant_id", "read", "created_at");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_created_at_idx" ON "notifications"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_deleted_at_id_idx" ON "notifications"("tenant_id", "deleted_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_tenant_id_dedupe_key_key" ON "notifications"("tenant_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "receipts_tenant_id_created_at_idx" ON "receipts"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "receipts_tenant_id_order_id_idx" ON "receipts"("tenant_id", "order_id");

-- CreateIndex
CREATE INDEX "receipts_tenant_id_payment_id_idx" ON "receipts"("tenant_id", "payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_tenant_id_receipt_number_key" ON "receipts"("tenant_id", "receipt_number");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_tenant_id_dedupe_key_key" ON "receipts"("tenant_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Notifications & Receipts hardening (Phase M6) ───────────────────────────

-- Receipts are financial records: amounts can never be negative.
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_amount_non_negative" CHECK ("amount" >= 0);

-- Row Level Security (uses the helpers from 0003_rls).
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "receipts"      ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_isolation ON "notifications"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant());

CREATE POLICY receipts_isolation ON "receipts"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant());
