-- DropIndex
DROP INDEX "staff_email_key";

-- AlterTable
ALTER TABLE "staff" ADD COLUMN     "email_idx" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "staff_email_idx_key" ON "staff"("email_idx");

