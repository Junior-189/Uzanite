-- Phase M14 / Batch B: TOTP two-factor authentication for user accounts.
-- The TOTP secret is stored AES-256-GCM encrypted (see @uzanite/messaging
-- crypto); recovery codes are stored as SHA-256 hashes and consumed on use.
ALTER TABLE "users" ADD COLUMN "totp_secret_enc" TEXT;
ALTER TABLE "users" ADD COLUMN "totp_enabled_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "totp_recovery_hashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
