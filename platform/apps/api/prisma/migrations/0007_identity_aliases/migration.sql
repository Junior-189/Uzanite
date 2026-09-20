-- CreateEnum
CREATE TYPE "IdentityAliasKind" AS ENUM ('user', 'staff', 'tenant');

-- CreateTable
CREATE TABLE "identity_aliases" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "tenant_id" UUID,
    "kind" "IdentityAliasKind" NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'legacy_mongo',
    "external_id" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "identity_aliases_user_id_idx" ON "identity_aliases"("user_id");

-- CreateIndex
CREATE INDEX "identity_aliases_tenant_id_idx" ON "identity_aliases"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "identity_aliases_provider_kind_external_id_key" ON "identity_aliases"("provider", "kind", "external_id");

-- AddForeignKey
ALTER TABLE "identity_aliases" ADD CONSTRAINT "identity_aliases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_aliases" ADD CONSTRAINT "identity_aliases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Identity bridge hardening (M2 gate C4) ──────────────────────────────────
-- A mapping must point at a user OR a tenant (never neither).
ALTER TABLE "identity_aliases" ADD CONSTRAINT "identity_aliases_target_present"
  CHECK ("user_id" IS NOT NULL OR "tenant_id" IS NOT NULL);

-- NOTE: identity_aliases is a platform-level lookup table used during
-- authentication (before a tenant context exists), so it deliberately has NO
-- Row Level Security. It contains only id mappings (no secrets) and is readable
-- solely by the application role.
