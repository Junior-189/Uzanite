-- DropIndex
DROP INDEX "membership_invites_email_idx";

-- AlterTable
ALTER TABLE "membership_invites" ADD COLUMN     "email_idx" TEXT,
ALTER COLUMN "email" SET DATA TYPE TEXT;

-- CreateIndex
CREATE INDEX "membership_invites_tenant_id_email_idx_idx" ON "membership_invites"("tenant_id", "email_idx");

