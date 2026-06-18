-- Free-set-mode (MANUAL_OVERRIDE) — doc→code reconciliation + the override action.
-- Additive + a safe enum RENAME (no rows use 'MANUAL'; nothing emits it).

-- 1) Reconcile the trigger enum: MANUAL -> MANUAL_OVERRIDE. RENAME VALUE is in-place and
--    transaction-safe; zero rows carry 'MANUAL' (the lifecycle engine never emitted it).
ALTER TYPE "TransitionTrigger" RENAME VALUE 'MANUAL' TO 'MANUAL_OVERRIDE';

-- 2) Transition.actor — the human who issued a MANUAL_OVERRIDE (distinct from approver).
--    Existing transitions get actor = NULL. Inherits the transition table grants + RLS policy.
ALTER TABLE "transition" ADD COLUMN "actor" TEXT;

-- 3) Task.lastImpliedRank — the regression baseline for score-demotion (a fresh decline, not a
--    static score<band gap). Nullable; existing tasks start NULL (no prior baseline = no decline).
ALTER TABLE "task" ADD COLUMN "lastImpliedRank" INTEGER;
