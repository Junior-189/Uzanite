-- DropIndex
DROP INDEX "messages_tenant_id_contact_phone_created_at_idx";

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "contact_phone_idx" TEXT;

-- CreateIndex
CREATE INDEX "messages_tenant_id_contact_phone_idx_created_at_idx" ON "messages"("tenant_id", "contact_phone_idx", "created_at");

