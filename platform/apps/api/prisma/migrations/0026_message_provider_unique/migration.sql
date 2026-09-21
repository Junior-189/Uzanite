-- DropIndex
DROP INDEX "messages_tenant_id_provider_message_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "messages_tenant_id_provider_message_id_key" ON "messages"("tenant_id", "provider_message_id");

