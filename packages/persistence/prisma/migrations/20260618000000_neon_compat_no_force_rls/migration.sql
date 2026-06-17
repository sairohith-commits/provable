-- Phase 8 (Neon compatibility) — relax FORCE ROW LEVEL SECURITY to plain ENABLE.
--
-- WHY: the cross-tenant auth lookups (auth_resolve_org / auth_resolve_org_by_clerk) are
-- SECURITY DEFINER functions that MUST read across orgs before any tenant context exists.
-- They work because their OWNER bypasses RLS. Locally the owner is the `postgres` SUPERUSER
-- (always bypasses, even under FORCE). On a managed host like Neon there is NO superuser —
-- migrations run as a normal owner role (e.g. neondb_owner). Under FORCE, that owner is
-- subject to RLS, so the SECURITY DEFINER lookup returns NOTHING and ALL auth breaks.
--
-- ENABLE (not FORCE) restores the intended model on every host:
--   * the table OWNER (migrations + the SECURITY DEFINER auth functions) bypasses RLS,
--   * the app role `provable_app` is a NON-owner with NO BYPASSRLS, so RLS still scopes
--     every app query → two-tenant isolation is unchanged.
-- FORCE only ever mattered for a connection made AS the owner; the app never does that
-- (the owner/DIRECT_URL is used solely for migrations), so nothing real is weakened.
ALTER TABLE "org"           NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "agent"         NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "task"          NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "decision"      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "verdict_event" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "transition"    NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "score"         NO FORCE ROW LEVEL SECURITY;
