-- CreateEnum
CREATE TYPE "WhatsAppFlowMode" AS ENUM ('off', 'shadow', 'active');

-- AlterTable
ALTER TABLE "whatsapp_accounts" ADD COLUMN     "flow_mode" "WhatsAppFlowMode" NOT NULL DEFAULT 'off';

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "step" TEXT NOT NULL DEFAULT 'LANGUAGE_SELECT',
    "language" TEXT NOT NULL DEFAULT '',
    "cart" JSONB NOT NULL DEFAULT '[]',
    "context" JSONB NOT NULL DEFAULT '{}',
    "last_inbound_at" TIMESTAMP(3),
    "last_outbound_at" TIMESTAMP(3),
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_tenant_id_last_activity_at_idx" ON "conversations"("tenant_id", "last_activity_at");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_tenant_id_contact_phone_key" ON "conversations"("tenant_id", "contact_phone");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Conversation hardening (Phase M8) ───────────────────────────────────────
-- Row Level Security (uses the helpers from 0003_rls).
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversations_isolation ON "conversations"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant());
