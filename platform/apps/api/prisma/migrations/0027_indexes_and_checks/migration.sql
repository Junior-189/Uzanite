-- CreateIndex
CREATE INDEX "debts_tenant_id_id_idx" ON "debts"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "flow_traces_tenant_id_id_idx" ON "flow_traces"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "ledger_entries_tenant_id_id_idx" ON "ledger_entries"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "messages_tenant_id_id_idx" ON "messages"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_id_idx" ON "payments"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "privacy_requests_tenant_id_id_idx" ON "privacy_requests"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "receipts_tenant_id_id_idx" ON "receipts"("tenant_id", "id");


-- Non-negative / positive invariants for the finance ledgers (defense in depth;
-- the services also validate these).
ALTER TABLE "expenses"  ADD CONSTRAINT "expenses_amount_non_negative" CHECK ("amount" >= 0);
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_cost_per_unit_non_negative" CHECK ("cost_per_unit" >= 0);
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_total_cost_non_negative" CHECK ("total_cost" >= 0);
ALTER TABLE "debts"     ADD CONSTRAINT "debts_amount_non_negative" CHECK ("amount" >= 0);
ALTER TABLE "debts"     ADD CONSTRAINT "debts_paid_amount_non_negative" CHECK ("paid_amount" >= 0);
