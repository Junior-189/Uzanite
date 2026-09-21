-- Phase M15: private file metadata for uploaded product images and payment
-- proofs. Bytes are stored out-of-band (local disk or S3/R2); this table holds
-- the tenant-scoped record used to authorize signed downloads.
CREATE TABLE "stored_files" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'other',
    "recorded_by" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stored_files_key_key" ON "stored_files"("key");
CREATE INDEX "stored_files_tenant_id_created_at_idx" ON "stored_files"("tenant_id", "created_at");
CREATE INDEX "stored_files_tenant_id_purpose_idx" ON "stored_files"("tenant_id", "purpose");

ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security (uses helpers from 0003_rls).
ALTER TABLE "stored_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stored_files" FORCE ROW LEVEL SECURITY;

CREATE POLICY stored_files_isolation ON "stored_files"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant());
