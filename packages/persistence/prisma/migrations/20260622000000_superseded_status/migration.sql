-- Phase U1 — add the terminal SUPERSEDED transition status (additive enum value).
-- A PROPOSED/PENDING_APPROVAL promotion that is overtaken by a demotion/suspend/override is
-- recorded as SUPERSEDED so the fleet read-model never treats a stale pending as live.
-- Additive only; no existing rows change. PG12+ allows ADD VALUE outside an explicit txn-use.
ALTER TYPE "TransitionStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED';
