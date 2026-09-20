-- AlterTable
ALTER TABLE "whatsapp_accounts" ADD COLUMN     "bot_paused" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "flow_traces" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID,
    "contact_phone" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "admin" BOOLEAN NOT NULL DEFAULT false,
    "input" TEXT NOT NULL,
    "step_from" TEXT NOT NULL,
    "step_to" TEXT NOT NULL,
    "replies" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flow_traces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "flow_traces_tenant_id_created_at_idx" ON "flow_traces"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "flow_traces_tenant_id_contact_phone_created_at_idx" ON "flow_traces"("tenant_id", "contact_phone", "created_at");

-- AddForeignKey
ALTER TABLE "flow_traces" ADD CONSTRAINT "flow_traces_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Flow traces hardening (Phase M9) ────────────────────────────────────────
-- Row Level Security (uses the helpers from 0003_rls).
ALTER TABLE "flow_traces" ENABLE ROW LEVEL SECURITY;

CREATE POLICY flow_traces_isolation ON "flow_traces"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant());
