-- AlterTable
ALTER TABLE "debts" ADD COLUMN     "client_ref" TEXT;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "client_ref" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "debts_tenant_id_client_ref_key" ON "debts"("tenant_id", "client_ref");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_tenant_id_client_ref_key" ON "expenses"("tenant_id", "client_ref");


-- Close an RLS defense-in-depth gap: tables added after 0012 were ENABLE-only,
-- so an owner/privileged connection would bypass policies. FORCE applies RLS to
-- the table owner too.
ALTER TABLE "staff"          FORCE ROW LEVEL SECURITY;
ALTER TABLE "expenses"       FORCE ROW LEVEL SECURITY;
ALTER TABLE "purchases"      FORCE ROW LEVEL SECURITY;
ALTER TABLE "debts"          FORCE ROW LEVEL SECURITY;
ALTER TABLE "broadcast_logs" FORCE ROW LEVEL SECURITY;
