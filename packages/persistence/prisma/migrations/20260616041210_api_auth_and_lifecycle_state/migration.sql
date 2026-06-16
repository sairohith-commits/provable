-- Phase 4 — machine-key columns on org + materialized lifecycle state on task.
-- (New columns inherit the existing table grants and RLS policies.)

-- AlterTable
ALTER TABLE "org" ADD COLUMN     "apiKeyHash" TEXT,
ADD COLUMN     "apiKeyPrefix" TEXT;

-- AlterTable
ALTER TABLE "task" ADD COLUMN     "consecutivePromotionReady" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "consecutiveSubFloor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pendingAwaitingApproval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pendingToMode" "AutonomyMode";

-- CreateIndex
CREATE UNIQUE INDEX "org_apiKeyPrefix_key" ON "org"("apiKeyPrefix");
