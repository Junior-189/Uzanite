-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "rejection_reason" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[];
