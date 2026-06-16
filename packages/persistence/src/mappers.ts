import type {
  Decision as DecisionRow,
  Score as ScoreRow,
  Transition as TransitionRow,
  VerdictEvent as VerdictEventRow,
} from '@prisma/client';
import type {
  AgentKey,
  Cost,
  Decision,
  DecisionId,
  ExternalRef,
  Outcome,
  Source,
  Transition,
  Verdict,
  VerdictEvent,
} from '@provable/contracts';
import type { OrgId, TaskKey } from '@provable/contracts';

/**
 * Anti-corruption mappers: Prisma rows → @provable/contracts types. Prisma types
 * never cross this package's boundary.
 */

function toVerdict(kind: DecisionRow['verdictKind'], magnitude: number | null): Verdict {
  if (kind === 'OVERRIDDEN') {
    return magnitude === null ? { kind: 'OVERRIDDEN' } : { kind: 'OVERRIDDEN', magnitude };
  }
  return { kind };
}

function toCost(row: Pick<DecisionRow, 'costTokens' | 'costUsd' | 'costLatencyMs'>): Cost | undefined {
  if (row.costTokens === null && row.costUsd === null && row.costLatencyMs === null) return undefined;
  return {
    ...(row.costTokens !== null ? { tokens: row.costTokens } : {}),
    ...(row.costUsd !== null ? { usd: row.costUsd } : {}),
    ...(row.costLatencyMs !== null ? { latencyMs: row.costLatencyMs } : {}),
  };
}

export function mapDecision(row: DecisionRow): Decision {
  const cost = toCost(row);
  return {
    id: row.id as DecisionId,
    orgId: row.orgId as OrgId,
    agentKey: row.agentKey as AgentKey,
    taskKey: row.taskKey as TaskKey,
    at: row.at.toISOString(),
    action: row.action as unknown,
    verdict: toVerdict(row.verdictKind, row.overrideMagnitude),
    source: row.source as Source,
    ...(row.confidence !== null ? { confidence: row.confidence } : {}),
    ...(cost !== undefined ? { cost } : {}),
    ...(row.outcome !== null ? { outcome: row.outcome as Outcome } : {}),
    ...(row.externalRef !== null ? { externalRef: row.externalRef as ExternalRef } : {}),
    ...(row.metadata !== null ? { metadata: row.metadata as Record<string, unknown> } : {}),
  };
}

export function mapVerdictEvent(row: VerdictEventRow): VerdictEvent {
  return {
    orgId: row.orgId as OrgId,
    source: row.source as Source,
    externalRef: row.externalRef as ExternalRef,
    at: row.at.toISOString(),
    ...(row.verdictKind !== null
      ? { verdict: toVerdict(row.verdictKind, row.overrideMagnitude) }
      : {}),
    ...(row.outcome !== null ? { outcome: row.outcome as Outcome } : {}),
  };
}

export function mapTransition(row: TransitionRow): Transition {
  return {
    orgId: row.orgId as OrgId,
    agentKey: row.agentKey as AgentKey,
    taskKey: row.taskKey as TaskKey,
    fromMode: row.fromMode,
    toMode: row.toMode,
    direction: row.direction,
    trigger: row.trigger,
    status: row.status,
    reason: row.reason,
    at: row.at.toISOString(),
    ...(row.approver !== null ? { approver: row.approver } : {}),
  };
}

/** A score row mapped to a plain record (no contracts type exists for scores yet). */
export interface ScoreRecord {
  orgId: OrgId;
  agentKey: AgentKey;
  taskKey: TaskKey;
  status: ScoreRow['status'];
  readinessScore: number | null;
  impliedBand: string | null;
  missing: string[];
  eventCount: number;
  resolvedCount: number;
  calculatedAt: string;
}

export function mapScore(row: ScoreRow): ScoreRecord {
  return {
    orgId: row.orgId as OrgId,
    agentKey: row.agentKey as AgentKey,
    taskKey: row.taskKey as TaskKey,
    status: row.status,
    readinessScore: row.readinessScore,
    impliedBand: row.impliedBand,
    missing: row.missing,
    eventCount: row.eventCount,
    resolvedCount: row.resolvedCount,
    calculatedAt: row.calculatedAt.toISOString(),
  };
}
