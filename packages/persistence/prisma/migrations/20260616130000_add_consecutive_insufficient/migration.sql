-- Backlog hardening — materialize the signal-loss demotion counter on the lifecycle row.
ALTER TABLE "task" ADD COLUMN "consecutiveInsufficient" INTEGER NOT NULL DEFAULT 0;
