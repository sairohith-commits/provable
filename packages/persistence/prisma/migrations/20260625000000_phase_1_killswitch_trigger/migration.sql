-- Phase 1 Kill Switch (Trigger + Audit) — additive only. NO enforcement (gateway gate is Phase 2).
-- Adds the two dedicated manual-lifecycle triggers and the durable agent-wide suspend marker.

-- 1) Dedicated triggers for the manual kill-switch. SUSPEND parks an agent×task at SUSPENDED;
--    RESUME is the route-only recovery back to OBSERVING. Kept distinct from MANUAL_OVERRIDE
--    (free_set_mode) so Legal/audit can tell a kill-switch apart from a band override.
--    ADD VALUE is in-place; existing rows are untouched.
ALTER TYPE "TransitionTrigger" ADD VALUE IF NOT EXISTS 'SUSPEND' AFTER 'SCHEDULED';
ALTER TYPE "TransitionTrigger" ADD VALUE IF NOT EXISTS 'RESUME' AFTER 'SUSPEND';

-- 2) Agent-wide suspend marker. Two nullable columns, no default, no backfill: existing agents
--    get NULL/NULL (= not agent-suspended). Inherits the agent table grants + RLS policy
--    (additive columns need no GRANT/policy change). ADVISORY in Phase 1 — nothing gates on it.
ALTER TABLE "agent" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "agent" ADD COLUMN "suspendedBy" TEXT;
