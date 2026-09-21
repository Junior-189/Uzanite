-- DropIndex
DROP INDEX "login_attempts_email_idx";

-- AlterTable
ALTER TABLE "login_attempts" ADD COLUMN     "email_idx" TEXT,
ALTER COLUMN "email" SET DATA TYPE TEXT;

-- CreateIndex
CREATE INDEX "login_attempts_email_idx_idx" ON "login_attempts"("email_idx");

