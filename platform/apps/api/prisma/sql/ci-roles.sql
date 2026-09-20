-- Creates the non-owner application role used by the app so PostgreSQL RLS
-- applies. Run as the database owner/superuser (migrations run as the owner).
-- Used by CI and documented for production provisioning.
--
-- Combined with migration 0012 (FORCE ROW LEVEL SECURITY), connecting the app
-- as `uzanite_app` guarantees policies apply even if the role were the table
-- owner. The role deliberately has NOBYPASSRLS and is not a superuser.
--
-- Production note: set DATABASE_URL to this role, and keep a separate
-- owner/superuser URL for `prisma migrate deploy` / seeding only.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'uzanite_app') THEN
    CREATE ROLE uzanite_app LOGIN PASSWORD 'uzanite_app';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO uzanite_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO uzanite_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO uzanite_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO uzanite_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO uzanite_app;

-- Ensure RLS is not bypassed by this role.
ALTER ROLE uzanite_app NOBYPASSRLS;
