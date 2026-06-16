-- Phase 3 — Row-Level Security, app-role grants, and verdict_event immutability.
-- Hand-written raw SQL (Prisma's schema language cannot express policies/triggers).
-- Applied by the superuser (DIRECT_URL); the app role `provable_app` is created by
-- docker/initdb/01-app-role.sql.

-- ── App-role privileges (provable_app: non-superuser, NO BYPASSRLS → RLS applies) ──
GRANT USAGE ON SCHEMA public TO provable_app;

GRANT SELECT, INSERT, UPDATE ON
  "org", "agent", "task", "decision", "transition", "score"
  TO provable_app;

-- verdict_event is append-only: SELECT + INSERT only. No UPDATE/DELETE privilege.
GRANT SELECT, INSERT ON "verdict_event" TO provable_app;

-- ── Enable + FORCE Row-Level Security on every table ──
ALTER TABLE "org"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "org"           FORCE  ROW LEVEL SECURITY;
ALTER TABLE "agent"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent"         FORCE  ROW LEVEL SECURITY;
ALTER TABLE "task"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task"          FORCE  ROW LEVEL SECURITY;
ALTER TABLE "decision"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision"      FORCE  ROW LEVEL SECURITY;
ALTER TABLE "verdict_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verdict_event" FORCE  ROW LEVEL SECURITY;
ALTER TABLE "transition"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transition"    FORCE  ROW LEVEL SECURITY;
ALTER TABLE "score"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "score"         FORCE  ROW LEVEL SECURITY;

-- ── One isolation policy per table. Rows are scoped to the tenant id held in the
--    transaction-local GUC `app.current_org_id` (set by withTenant()). With
--    missing_ok = true, an UNSET GUC yields NULL → every row comparison is false →
--    a query with NO tenant context returns nothing. ──
CREATE POLICY org_tenant_isolation ON "org" FOR ALL
  USING (id = current_setting('app.current_org_id', true))
  WITH CHECK (id = current_setting('app.current_org_id', true));

CREATE POLICY agent_tenant_isolation ON "agent" FOR ALL
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

CREATE POLICY task_tenant_isolation ON "task" FOR ALL
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

CREATE POLICY decision_tenant_isolation ON "decision" FOR ALL
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

CREATE POLICY verdict_event_tenant_isolation ON "verdict_event" FOR ALL
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

CREATE POLICY transition_tenant_isolation ON "transition" FOR ALL
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

CREATE POLICY score_tenant_isolation ON "score" FOR ALL
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

-- ── verdict_event immutability: reject UPDATE/DELETE at the DB for EVERY role
--    (triggers fire even for the superuser, so this holds regardless of grants). ──
CREATE OR REPLACE FUNCTION provable_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'verdict_event is append-only and immutable: % is not allowed', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER verdict_event_immutable
  BEFORE UPDATE OR DELETE ON "verdict_event"
  FOR EACH ROW EXECUTE FUNCTION provable_reject_mutation();
