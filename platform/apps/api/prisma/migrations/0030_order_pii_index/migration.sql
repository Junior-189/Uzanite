-- DropIndex
DROP INDEX "orders_tenant_id_customer_phone_created_at_idx";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "customer_phone_idx" TEXT;

-- CreateIndex
CREATE INDEX "orders_tenant_id_customer_phone_idx_idx" ON "orders"("tenant_id", "customer_phone_idx");

