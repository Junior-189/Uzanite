-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Other',
    "recorded_by" TEXT NOT NULL DEFAULT 'Owner',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID,
    "product_name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "cost_per_unit" DECIMAL(14,2) NOT NULL,
    "total_cost" DECIMAL(14,2) NOT NULL,
    "supplier" TEXT NOT NULL DEFAULT '',
    "recorded_by" TEXT NOT NULL DEFAULT 'Owner',
    "expiry_date" TIMESTAMP(3),
    "expiry_notified" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT NOT NULL DEFAULT '',
    "receipt_key" TEXT,
    "client_ref" TEXT,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT NOT NULL DEFAULT '',
    "amount" DECIMAL(14,2) NOT NULL,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL DEFAULT '',
    "due_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'unpaid',
    "order_id" UUID,
    "notes" TEXT NOT NULL DEFAULT '',
    "recorded_by" TEXT NOT NULL DEFAULT 'Owner',
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "debts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expenses_tenant_id_date_idx" ON "expenses"("tenant_id", "date");

-- CreateIndex
CREATE INDEX "expenses_tenant_id_id_idx" ON "expenses"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "purchases_tenant_id_date_idx" ON "purchases"("tenant_id", "date");

-- CreateIndex
CREATE INDEX "purchases_tenant_id_deleted_at_id_idx" ON "purchases"("tenant_id", "deleted_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_tenant_id_client_ref_key" ON "purchases"("tenant_id", "client_ref");

-- CreateIndex
CREATE INDEX "debts_tenant_id_status_idx" ON "debts"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "debts_tenant_id_deleted_at_idx" ON "debts"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "debts_tenant_id_created_at_idx" ON "debts"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debts" ADD CONSTRAINT "debts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security (helpers from 0003_rls).
ALTER TABLE "expenses"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "debts"     ENABLE ROW LEVEL SECURITY;

CREATE POLICY expenses_isolation ON "expenses"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant());

CREATE POLICY purchases_isolation ON "purchases"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant());

CREATE POLICY debts_isolation ON "debts"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant());
