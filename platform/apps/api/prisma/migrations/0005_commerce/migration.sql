-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PENDING_PAYMENT', 'PAID', 'DELIVERED');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('whatsapp', 'cash');

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "legacy_id" TEXT,
    "order_number" TEXT NOT NULL,
    "client_ref" TEXT,
    "customer_phone" TEXT NOT NULL DEFAULT '',
    "customer_name" TEXT NOT NULL DEFAULT 'Customer',
    "customer_email" TEXT NOT NULL DEFAULT '',
    "delivery_location" TEXT NOT NULL DEFAULT '',
    "delivery_phone" TEXT NOT NULL DEFAULT '',
    "source" "OrderSource" NOT NULL DEFAULT 'whatsapp',
    "recorded_by" TEXT NOT NULL DEFAULT '',
    "total" DECIMAL(14,2) NOT NULL,
    "original_total" DECIMAL(14,2),
    "offered_total" DECIMAL(14,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'TZS',
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "admin_note" TEXT NOT NULL DEFAULT '',
    "rejection_reason" TEXT NOT NULL DEFAULT '',
    "payment_method" TEXT NOT NULL DEFAULT '',
    "payment_reference" TEXT NOT NULL DEFAULT '',
    "payment_proof_path" TEXT,
    "payment_confirmed_at" TIMESTAMP(3),
    "delivery_note" TEXT NOT NULL DEFAULT '',
    "delivered_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID,
    "legacy_product_id" TEXT,
    "product_name" TEXT NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'TZS',
    "quantity" INTEGER NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "changed_by" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_counters" (
    "tenant_id" UUID NOT NULL,
    "day" CHAR(8) NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_counters_pkey" PRIMARY KEY ("tenant_id","day")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_legacy_id_key" ON "orders"("legacy_id");

-- CreateIndex
CREATE INDEX "orders_tenant_id_status_created_at_idx" ON "orders"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "orders_tenant_id_customer_phone_created_at_idx" ON "orders"("tenant_id", "customer_phone", "created_at");

-- CreateIndex
CREATE INDEX "orders_tenant_id_deleted_at_id_idx" ON "orders"("tenant_id", "deleted_at", "id");

-- CreateIndex
CREATE INDEX "orders_tenant_id_created_at_idx" ON "orders"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenant_id_order_number_key" ON "orders"("tenant_id", "order_number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenant_id_client_ref_key" ON "orders"("tenant_id", "client_ref");

-- CreateIndex
CREATE INDEX "order_items_tenant_id_order_id_idx" ON "order_items"("tenant_id", "order_id");

-- CreateIndex
CREATE INDEX "order_items_tenant_id_product_id_idx" ON "order_items"("tenant_id", "product_id");

-- CreateIndex
CREATE INDEX "order_status_history_tenant_id_order_id_changed_at_idx" ON "order_status_history"("tenant_id", "order_id", "changed_at");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_counters" ADD CONSTRAINT "order_counters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Commerce hardening (Phase M4) ───────────────────────────────────────────

-- Non-negative financial / quantity invariants (defense in depth; the services
-- also guard these). Mirrors the products_stock_non_negative check from M3.
ALTER TABLE "orders" ADD CONSTRAINT "orders_total_non_negative" CHECK ("total" >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_offered_total_non_negative" CHECK ("offered_total" IS NULL OR "offered_total" >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_original_total_non_negative" CHECK ("original_total" IS NULL OR "original_total" >= 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_price_non_negative" CHECK ("price" >= 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_subtotal_non_negative" CHECK ("subtotal" >= 0);
ALTER TABLE "order_counters" ADD CONSTRAINT "order_counters_seq_non_negative" CHECK ("seq" >= 0);

-- Row Level Security for commerce tables (uses the helpers from 0003_rls).
ALTER TABLE "orders"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_items"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_status_history"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_counters"        ENABLE ROW LEVEL SECURITY;

CREATE POLICY orders_isolation ON "orders"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant());

CREATE POLICY order_items_isolation ON "order_items"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant());

CREATE POLICY order_status_history_isolation ON "order_status_history"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant());

CREATE POLICY order_counters_isolation ON "order_counters"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant());
