-- Phase O3a — Tier-2 connector config (per-org stored mapping + optional pull source).
--
-- Tenant-scoped like every other table: ENABLE (not FORCE) RLS so the owner/SECURITY DEFINER
-- paths keep working while the non-owner app role stays org-scoped. The pull credential lives in
-- sourceAuthHeaderValueEnc as AES-256-GCM ciphertext (encrypted at the API) and is never returned.

CREATE TABLE "connector_config" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "mapping" JSONB NOT NULL,
    "sourceUrl" TEXT,
    "sourceAuthHeaderName" TEXT,
    "sourceAuthHeaderValueEnc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_config_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "connector_config_orgId_idx" ON "connector_config"("orgId");

ALTER TABLE "connector_config"
  ADD CONSTRAINT "connector_config_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- App-role privileges: full DML for create/edit/disable. (No DELETE needed — disable via enabled.)
GRANT SELECT, INSERT, UPDATE ON "connector_config" TO provable_app;

-- RLS: ENABLE (Neon-compat) + the standard tenant-isolation policy keyed on app.current_org_id.
ALTER TABLE "connector_config" ENABLE ROW LEVEL SECURITY;

CREATE POLICY connector_config_tenant_isolation ON "connector_config" FOR ALL
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));
