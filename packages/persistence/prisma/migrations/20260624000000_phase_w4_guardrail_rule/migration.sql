-- Phase W4 — platform-enforced guardrail rule (per-org). Provable evaluates these rules against
-- every ingested decision and trips the guardrail itself on a violation (reusing the existing
-- trip→SUSPENDED lifecycle), independent of what the agent reports.
--
-- Tenant-scoped like every other table: ENABLE (not FORCE) RLS so the owner/SECURITY DEFINER
-- paths keep working while the non-owner app role stays org-scoped. The condition is generic over
-- decision fields (verdict/outcome) — no domain noun.

CREATE TABLE "guardrail_rule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "agentKey" TEXT,
    "taskKey" TEXT,
    "verdict" "VerdictKind",
    "outcome" "Outcome",
    "guardrailId" TEXT NOT NULL,
    "reasonTemplate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guardrail_rule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "guardrail_rule_orgId_idx" ON "guardrail_rule"("orgId");

ALTER TABLE "guardrail_rule"
  ADD CONSTRAINT "guardrail_rule_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- App-role privileges: create/list/enable-disable. (No DELETE — disable via enabled.)
GRANT SELECT, INSERT, UPDATE ON "guardrail_rule" TO provable_app;

-- RLS: ENABLE (Neon-compat) + the standard tenant-isolation policy keyed on app.current_org_id.
ALTER TABLE "guardrail_rule" ENABLE ROW LEVEL SECURITY;

CREATE POLICY guardrail_rule_tenant_isolation ON "guardrail_rule" FOR ALL
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));
