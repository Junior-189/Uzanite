-- DropIndex
DROP INDEX "whatsapp_contacts_tenant_id_phone_key";

-- AlterTable
ALTER TABLE "whatsapp_contacts" ADD COLUMN     "phone_idx" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_contacts_tenant_id_phone_idx_key" ON "whatsapp_contacts"("tenant_id", "phone_idx");

