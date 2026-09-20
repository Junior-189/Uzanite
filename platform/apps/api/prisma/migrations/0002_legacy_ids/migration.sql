-- Phase M2: stable legacy identifiers for idempotent MongoDB -> PostgreSQL backfill.
ALTER TABLE "tenants" ADD COLUMN "legacy_id" TEXT;
CREATE UNIQUE INDEX "tenants_legacy_id_key" ON "tenants"("legacy_id");

ALTER TABLE "users" ADD COLUMN "legacy_id" TEXT;
CREATE UNIQUE INDEX "users_legacy_id_key" ON "users"("legacy_id");

ALTER TABLE "feature_flags" ADD COLUMN "legacy_id" TEXT;
CREATE UNIQUE INDEX "feature_flags_legacy_id_key" ON "feature_flags"("legacy_id");
