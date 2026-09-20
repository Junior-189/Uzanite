-- Phase M16: contact lifecycle fields to match the legacy contacts API
-- (opt-in timestamp, unsubscribe marker, notified flag, soft-delete actor).
ALTER TABLE "whatsapp_contacts" ADD COLUMN "opt_in_at" TIMESTAMP(3);
ALTER TABLE "whatsapp_contacts" ADD COLUMN "unsubscribed_at" TIMESTAMP(3);
ALTER TABLE "whatsapp_contacts" ADD COLUMN "is_notified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "whatsapp_contacts" ADD COLUMN "deleted_by" UUID;
