-- Phase 7 — link a Clerk Organization to a Provable org for dashboard auth.

-- Column + unique index (matches what `prisma migrate dev` would generate).
ALTER TABLE "org" ADD COLUMN "clerkOrgId" TEXT;
CREATE UNIQUE INDEX "org_clerkOrgId_key" ON "org"("clerkOrgId");

-- SECURITY DEFINER resolver: the web maps a VERIFIED Clerk session → Provable org
-- before any tenant context exists, so this must read across orgs. Same hardening as
-- auth_resolve_org: pinned search_path, fully-qualified table, app-role-only EXECUTE.
CREATE OR REPLACE FUNCTION public.auth_resolve_org_by_clerk(p_clerk_org_id text)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
  SELECT o.id
    FROM public."org" AS o
   WHERE o."clerkOrgId" = p_clerk_org_id
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.auth_resolve_org_by_clerk(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_resolve_org_by_clerk(text) TO provable_app;
