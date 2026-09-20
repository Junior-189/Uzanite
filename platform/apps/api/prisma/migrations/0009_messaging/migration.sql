-- CreateEnum
CREATE TYPE "WhatsAppAccountStatus" AS ENUM ('pending', 'connected', 'disconnected', 'error');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'received');

-- CreateTable
CREATE TABLE "whatsapp_accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'meta',
    "phone_number_id" TEXT,
    "waba_id" TEXT NOT NULL DEFAULT '',
    "display_phone_number" TEXT NOT NULL DEFAULT '',
    "access_token_enc" TEXT NOT NULL DEFAULT '',
    "verify_token_enc" TEXT NOT NULL DEFAULT '',
    "status" "WhatsAppAccountStatus" NOT NULL DEFAULT 'pending',
    "quality_rating" TEXT NOT NULL DEFAULT '',
    "last_inbound_at" TIMESTAMP(3),
    "last_error" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en_US',
    "category" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '',
    "components" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_contacts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "jid" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "last_message_at" TIMESTAMP(3),
    "last_message" TEXT NOT NULL DEFAULT '',
    "opt_in" BOOLEAN NOT NULL DEFAULT true,
    "consent_status" TEXT NOT NULL DEFAULT 'granted',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "whatsapp_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID,
    "contact_id" UUID,
    "direction" "MessageDirection" NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "message_type" TEXT NOT NULL DEFAULT 'text',
    "text" TEXT NOT NULL DEFAULT '',
    "template_name" TEXT,
    "media_id" TEXT,
    "media_mime_type" TEXT,
    "provider_message_id" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'queued',
    "error_code" TEXT,
    "error_message" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotency_key" TEXT,
    "raw" JSONB NOT NULL DEFAULT '{}',
    "sent_at" TIMESTAMP(3),
    "status_updated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'meta',
    "event_id" TEXT NOT NULL,
    "tenant_id" UUID,
    "type" TEXT NOT NULL DEFAULT 'unknown',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_accounts_tenant_id_key" ON "whatsapp_accounts"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_accounts_phone_number_id_key" ON "whatsapp_accounts"("phone_number_id");

-- CreateIndex
CREATE INDEX "whatsapp_accounts_status_idx" ON "whatsapp_accounts"("status");

-- CreateIndex
CREATE INDEX "whatsapp_templates_tenant_id_idx" ON "whatsapp_templates"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_templates_tenant_id_name_language_key" ON "whatsapp_templates"("tenant_id", "name", "language");

-- CreateIndex
CREATE INDEX "whatsapp_contacts_tenant_id_last_message_at_idx" ON "whatsapp_contacts"("tenant_id", "last_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_contacts_tenant_id_phone_key" ON "whatsapp_contacts"("tenant_id", "phone");

-- CreateIndex
CREATE INDEX "messages_tenant_id_contact_phone_created_at_idx" ON "messages"("tenant_id", "contact_phone", "created_at");

-- CreateIndex
CREATE INDEX "messages_tenant_id_provider_message_id_idx" ON "messages"("tenant_id", "provider_message_id");

-- CreateIndex
CREATE INDEX "messages_tenant_id_status_available_at_idx" ON "messages"("tenant_id", "status", "available_at");

-- CreateIndex
CREATE INDEX "messages_tenant_id_created_at_idx" ON "messages"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "messages_tenant_id_idempotency_key_key" ON "messages"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_event_id_key" ON "webhook_events"("event_id");

-- CreateIndex
CREATE INDEX "webhook_events_provider_created_at_idx" ON "webhook_events"("provider", "created_at");

-- AddForeignKey
ALTER TABLE "whatsapp_accounts" ADD CONSTRAINT "whatsapp_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_contacts" ADD CONSTRAINT "whatsapp_contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "whatsapp_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "whatsapp_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Messaging hardening (Phase M7) ──────────────────────────────────────────

ALTER TABLE "messages" ADD CONSTRAINT "messages_attempts_non_negative" CHECK ("attempts" >= 0);

-- Row Level Security for tenant-owned messaging tables (helpers from 0003_rls).
-- `webhook_events` is intentionally excluded: it is a platform-level dedupe/audit
-- ledger written before/while a tenant is resolved.
ALTER TABLE "whatsapp_accounts"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_contacts"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages"           ENABLE ROW LEVEL SECURITY;

CREATE POLICY whatsapp_accounts_isolation ON "whatsapp_accounts"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant());

CREATE POLICY whatsapp_templates_isolation ON "whatsapp_templates"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant());

CREATE POLICY whatsapp_contacts_isolation ON "whatsapp_contacts"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant());

CREATE POLICY messages_isolation ON "messages"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant());
