-- Phase O2 — per-agent gateway keys (Tier-1 Anthropic /v1/messages proxy).
--
-- Adds a `kind` discriminator (SDK | GATEWAY) and a per-agent `taskKey` to api_key, a SECURITY
-- DEFINER resolver for gateway keys (org + agent + task), and restricts the existing machine-key
-- resolver to SDK keys so the two kinds can never be used interchangeably.

-- ── api_key: kind + taskKey ──
CREATE TYPE "ApiKeyKind" AS ENUM ('SDK', 'GATEWAY');

ALTER TABLE "api_key" ADD COLUMN "kind" "ApiKeyKind" NOT NULL DEFAULT 'SDK';
ALTER TABLE "api_key" ADD COLUMN "taskKey" TEXT;
-- Existing rows are SDK machine keys (the column default already stamps them); explicit for clarity.
UPDATE "api_key" SET "kind" = 'SDK' WHERE "kind" IS NULL;

-- ── Restrict the SDK machine-key resolver to kind='SDK' (a gateway key can't auth /track etc.) ──
-- Still SECURITY DEFINER (pre-tenant cross-org lookup); pinned search_path; app-role-only EXECUTE.
CREATE OR REPLACE FUNCTION public.auth_resolve_org(p_prefix text, p_hash text)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
  SELECT k."orgId"
    FROM public."api_key" AS k
   WHERE k."prefix" = p_prefix
     AND k."hash" = p_hash
     AND k."revokedAt" IS NULL
     AND k."kind" = 'SDK'
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.auth_resolve_org(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_resolve_org(text, text) TO provable_app;

-- ── Gateway-key resolver: prefix+hash → (orgId, agentKey, taskKey) for ACTIVE GATEWAY keys ──
-- Runs before any tenant context (the proxy resolves the agent from the URL key), so it is a
-- SECURITY DEFINER cross-org lookup like auth_resolve_org. Returns nothing for unknown/revoked/
-- non-gateway keys → the proxy 401s.
CREATE OR REPLACE FUNCTION public.auth_resolve_gateway(p_prefix text, p_hash text)
  RETURNS TABLE(org_id text, agent_key text, task_key text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
  SELECT k."orgId", k."agentKey", k."taskKey"
    FROM public."api_key" AS k
   WHERE k."prefix" = p_prefix
     AND k."hash" = p_hash
     AND k."revokedAt" IS NULL
     AND k."kind" = 'GATEWAY'
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.auth_resolve_gateway(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_resolve_gateway(text, text) TO provable_app;
