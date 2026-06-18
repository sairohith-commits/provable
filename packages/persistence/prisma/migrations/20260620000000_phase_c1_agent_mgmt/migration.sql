-- AlterTable
ALTER TABLE "agent" ADD COLUMN     "displayName" TEXT;

-- CreateTable
CREATE TABLE "api_key" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "label" TEXT,
    "agentKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "api_key_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_key_prefix_key" ON "api_key"("prefix");

-- CreateIndex
CREATE INDEX "api_key_orgId_idx" ON "api_key"("orgId");

-- AddForeignKey
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Phase C1: app-role grants + RLS for api_key (org-scoped multi-key) ──
-- SELECT/INSERT for mint; UPDATE for soft-revoke (revokedAt). No DELETE (revoke is soft, so
-- the audit trail of issued keys survives).
GRANT SELECT, INSERT, UPDATE ON "api_key" TO provable_app;

-- ENABLE (not FORCE) — same Neon-compat mode as every other table (owner bypass needed for the
-- SECURITY DEFINER auth lookup below; the app role provable_app stays RLS-scoped).
ALTER TABLE "api_key" ENABLE ROW LEVEL SECURITY;

CREATE POLICY api_key_tenant_isolation ON "api_key" FOR ALL
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

-- ── Migrate the existing single org key into api_key (PRESERVE the live org_support key) ──
-- Every org that currently has a key gets an equivalent active api_key row. The legacy
-- org.apiKeyPrefix/apiKeyHash columns are left in place (vestigial) so nothing breaks mid-deploy;
-- all reads/writes move to api_key.
INSERT INTO "api_key" ("id", "orgId", "prefix", "hash", "label", "createdAt")
SELECT gen_random_uuid()::text, o."id", o."apiKeyPrefix", o."apiKeyHash", 'migrated', now()
  FROM "org" AS o
 WHERE o."apiKeyPrefix" IS NOT NULL
   AND o."apiKeyHash" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "api_key" k WHERE k."prefix" = o."apiKeyPrefix");

-- ── Repoint the machine-key resolver at api_key (active keys only) ──
-- Still a SECURITY DEFINER cross-org lookup (runs before any tenant context); pinned
-- search_path; app-role-only EXECUTE. Under ENABLE the function owner bypasses RLS.
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
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.auth_resolve_org(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_resolve_org(text, text) TO provable_app;
