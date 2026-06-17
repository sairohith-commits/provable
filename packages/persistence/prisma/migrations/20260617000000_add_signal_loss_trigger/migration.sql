-- Deliverable 6 (Phase 7b): add the ratified SIGNAL_LOSS lifecycle trigger.
-- A governed task auto-demotes when its verdict/outcome signal goes absent (readiness
-- INSUFFICIENT for a grace window). Distinct from DRIFT so Legal/audit can tell
-- "we lost visibility" apart from "the agent got worse".
ALTER TYPE "TransitionTrigger" ADD VALUE IF NOT EXISTS 'SIGNAL_LOSS' AFTER 'GUARDRAIL';
