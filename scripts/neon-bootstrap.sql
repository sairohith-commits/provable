-- ── Neon one-time bootstrap — run BEFORE the first `prisma migrate deploy` ──────────
-- Run this ONCE against the Neon DIRECT (non-pooled) connection, as the database OWNER
-- (neondb_owner). It creates the RLS-scoped application role the API connects as.
--
-- WHY this is a manual step and NOT a migration: the app role needs a LOGIN password that
-- must match DATABASE_URL, and a real password must never live in the repo. Migration
-- 20260616041209 GRANTs to this role, so it MUST exist before migrations run.
--
-- The role is deliberately a PLAIN login role: NOT a superuser, NO BYPASSRLS — so
-- Row-Level Security fully applies to it (this is what enforces tenant isolation). The
-- owner (neondb_owner) is used only for migrations + the SECURITY DEFINER auth lookups.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'provable_app') THEN
    -- ▼▼ replace with a strong password; use the SAME one in DATABASE_URL ▼▼
    CREATE ROLE provable_app WITH LOGIN PASSWORD 'REPLACE_WITH_STRONG_PASSWORD';
  END IF;
END
$$;

-- Replace `neondb` with your actual Neon database name if different.
GRANT CONNECT ON DATABASE neondb TO provable_app;
GRANT USAGE  ON SCHEMA   public TO provable_app;

-- (Table/function privileges + RLS policies are granted by the migration chain.)
