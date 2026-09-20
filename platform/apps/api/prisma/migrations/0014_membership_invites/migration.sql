-- Phase M12: membership invitations (single-use, expiring). The raw token is
-- emailed to the invitee; only its SHA-256 hash is stored.
CREATE TABLE "membership_invites" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "token_hash" TEXT NOT NULL,
    "invited_by" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "membership_invites_token_hash_key" ON "membership_invites"("token_hash");
CREATE INDEX "membership_invites_tenant_id_idx" ON "membership_invites"("tenant_id");
CREATE INDEX "membership_invites_email_idx" ON "membership_invites"("email");

ALTER TABLE "membership_invites" ADD CONSTRAINT "membership_invites_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "membership_invites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "membership_invites" FORCE ROW LEVEL SECURITY;

CREATE POLICY membership_invites_isolation ON "membership_invites"
  USING (app_rls_bypass() OR tenant_id = app_current_tenant())
  WITH CHECK (app_rls_bypass() OR tenant_id = app_current_tenant());
