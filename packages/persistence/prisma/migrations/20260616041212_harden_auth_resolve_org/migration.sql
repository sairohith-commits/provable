-- Phase 4 hardening — lock down the SECURITY DEFINER auth lookup.
--
-- A SECURITY DEFINER function runs as its owner (the superuser), so an attacker who
-- can influence name resolution could hijack it. Defenses:
--   * pin search_path to NON-user-writable schemas only (pg_catalog, pg_temp last),
--   * fully-qualify every referenced object (public."org"),
--   * STABLE (it only reads), returns just the orgId,
--   * EXECUTE granted to the app role only; revoked from PUBLIC.
CREATE OR REPLACE FUNCTION public.auth_resolve_org(p_prefix text, p_hash text)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
  SELECT o.id
    FROM public."org" AS o
   WHERE o."apiKeyPrefix" = p_prefix
     AND o."apiKeyHash" = p_hash
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.auth_resolve_org(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_resolve_org(text, text) TO provable_app;
