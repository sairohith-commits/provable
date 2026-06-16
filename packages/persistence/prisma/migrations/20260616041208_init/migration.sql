-- CreateEnum
CREATE TYPE "AgentIdentityState" AS ENUM ('DISCOVERED', 'ACTIVE', 'DORMANT', 'RETIRED');

-- CreateEnum
CREATE TYPE "AutonomyMode" AS ENUM ('OBSERVING', 'SHADOW', 'CO_PILOT', 'SOLO', 'SUSPENDED', 'RETIRED');

-- CreateEnum
CREATE TYPE "VerdictKind" AS ENUM ('PENDING', 'ACCEPTED', 'OVERRIDDEN', 'ESCALATED', 'FAILED');

-- CreateEnum
CREATE TYPE "Outcome" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILURE');

-- CreateEnum
CREATE TYPE "Source" AS ENUM ('gateway', 'sdk', 'connector', 'otel');

-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('PENDING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "TransitionDirection" AS ENUM ('PROMOTION', 'DEMOTION', 'LATERAL');

-- CreateEnum
CREATE TYPE "TransitionTrigger" AS ENUM ('SCORE_CROSS', 'DRIFT', 'GUARDRAIL', 'MANUAL', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "TransitionStatus" AS ENUM ('PROPOSED', 'PENDING_APPROVAL', 'APPLIED', 'AUTO_APPLIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ScoreStatus" AS ENUM ('SCORED', 'INSUFFICIENT');

-- CreateTable
CREATE TABLE "org" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent" (
    "orgId" TEXT NOT NULL,
    "agentKey" TEXT NOT NULL,
    "identityState" "AgentIdentityState" NOT NULL DEFAULT 'DISCOVERED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_pkey" PRIMARY KEY ("orgId","agentKey")
);

-- CreateTable
CREATE TABLE "task" (
    "orgId" TEXT NOT NULL,
    "agentKey" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "effectiveMode" "AutonomyMode" NOT NULL DEFAULT 'OBSERVING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_pkey" PRIMARY KEY ("orgId","agentKey","taskKey")
);

-- CreateTable
CREATE TABLE "decision" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "agentKey" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "action" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION,
    "costTokens" INTEGER,
    "costUsd" DOUBLE PRECISION,
    "costLatencyMs" INTEGER,
    "verdictKind" "VerdictKind" NOT NULL DEFAULT 'PENDING',
    "overrideMagnitude" DOUBLE PRECISION,
    "outcome" "Outcome",
    "status" "DecisionStatus" NOT NULL DEFAULT 'PENDING',
    "source" "Source" NOT NULL,
    "externalRef" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verdict_event" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "source" "Source" NOT NULL,
    "externalRef" TEXT NOT NULL,
    "verdictKind" "VerdictKind",
    "overrideMagnitude" DOUBLE PRECISION,
    "outcome" "Outcome",
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verdict_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transition" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "agentKey" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "fromMode" "AutonomyMode" NOT NULL,
    "toMode" "AutonomyMode" NOT NULL,
    "direction" "TransitionDirection" NOT NULL,
    "trigger" "TransitionTrigger" NOT NULL,
    "status" "TransitionStatus" NOT NULL,
    "approver" TEXT,
    "reason" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "agentKey" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "status" "ScoreStatus" NOT NULL,
    "readinessScore" DOUBLE PRECISION,
    "accuracyRate" DOUBLE PRECISION,
    "confidenceAvg" DOUBLE PRECISION,
    "overrideRate" DOUBLE PRECISION,
    "escalationRate" DOUBLE PRECISION,
    "impliedBand" TEXT,
    "missing" TEXT[],
    "eventCount" INTEGER NOT NULL,
    "resolvedCount" INTEGER NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_orgId_idx" ON "agent"("orgId");

-- CreateIndex
CREATE INDEX "task_orgId_idx" ON "task"("orgId");

-- CreateIndex
CREATE INDEX "task_orgId_agentKey_idx" ON "task"("orgId", "agentKey");

-- CreateIndex
CREATE INDEX "decision_orgId_agentKey_taskKey_idx" ON "decision"("orgId", "agentKey", "taskKey");

-- CreateIndex
CREATE INDEX "decision_orgId_externalRef_idx" ON "decision"("orgId", "externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "decision_orgId_externalRef_key" ON "decision"("orgId", "externalRef");

-- CreateIndex
CREATE INDEX "verdict_event_orgId_externalRef_idx" ON "verdict_event"("orgId", "externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "verdict_event_orgId_source_externalRef_at_key" ON "verdict_event"("orgId", "source", "externalRef", "at");

-- CreateIndex
CREATE INDEX "transition_orgId_agentKey_taskKey_idx" ON "transition"("orgId", "agentKey", "taskKey");

-- CreateIndex
CREATE INDEX "score_orgId_agentKey_taskKey_idx" ON "score"("orgId", "agentKey", "taskKey");

-- CreateIndex
CREATE INDEX "score_orgId_calculatedAt_idx" ON "score"("orgId", "calculatedAt");

-- AddForeignKey
ALTER TABLE "agent" ADD CONSTRAINT "agent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_orgId_agentKey_fkey" FOREIGN KEY ("orgId", "agentKey") REFERENCES "agent"("orgId", "agentKey") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision" ADD CONSTRAINT "decision_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision" ADD CONSTRAINT "decision_orgId_agentKey_fkey" FOREIGN KEY ("orgId", "agentKey") REFERENCES "agent"("orgId", "agentKey") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision" ADD CONSTRAINT "decision_orgId_agentKey_taskKey_fkey" FOREIGN KEY ("orgId", "agentKey", "taskKey") REFERENCES "task"("orgId", "agentKey", "taskKey") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verdict_event" ADD CONSTRAINT "verdict_event_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transition" ADD CONSTRAINT "transition_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score" ADD CONSTRAINT "score_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
