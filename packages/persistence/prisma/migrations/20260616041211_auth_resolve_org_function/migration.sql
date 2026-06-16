-- Phase 4 — API-key → orgId resolution.
--
-- Auth must find which org a key belongs to BEFORE any tenant context exists, so the
-- lookup cannot go through RLS (an un-scoped read returns nothing by design). A
-- SECURITY DEFINER function owned by the superuser performs exactly this one lookup
-- and nothing else, so the app role (provable_app) never needs BYPASSRLS.
CREATE OR REPLACE FUNCTION auth_resolve_org(p_prefix text, p_hash text)
  RETURNS text
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT id FROM "org" WHERE "apiKeyPrefix" = p_prefix AND "apiKeyHash" = p_hash LIMIT 1;
$$;

REVOKE ALL ON FUNCTION auth_resolve_org(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_resolve_org(text, text) TO provable_app;
