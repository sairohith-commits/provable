import type {
  DecisionWindowReader,
  LifecycleState,
  LifecycleStateReader,
  LifecycleStateWriter,
  ReadinessResult,
  ScoreWriter,
  TaskScope,
  TransitionWriter,
} from '@provable/core';
import { INITIAL_LIFECYCLE_STATE } from '@provable/core';
import { mapDecision } from './mappers.js';
import { transitionRepo } from './repositories.js';
import type { TenantClient } from './tenant.js';

/**
 * Concrete implementations of core's outbound ports, bound to one withTenant tx.
 * This is where persistence implements `@provable/core` interfaces (the doc-sanctioned
 * persistence → core edge). apps/api wires these into the recompute loop.
 */
export interface RecomputePorts {
  readonly decisions: DecisionWindowReader;
  readonly lifecycle: LifecycleStateReader & LifecycleStateWriter;
  readonly scores: ScoreWriter;
  readonly transitions: TransitionWriter;
}

function scoreData(scope: TaskScope, result: ReadinessResult, calculatedAt: string) {
  const base = {
    orgId: scope.orgId,
    agentKey: scope.agentKey,
    taskKey: scope.taskKey,
    eventCount: result.eventCount,
    resolvedCount: result.resolvedCount,
    calculatedAt: new Date(calculatedAt),
  };
  if (result.status === 'SCORED') {
    return {
      ...base,
      status: 'SCORED' as const,
      readinessScore: result.readinessScore,
      accuracyRate: result.components.accuracyRate,
      confidenceAvg: result.components.confidenceAvg,
      overrideRate: result.components.overrideRate,
      escalationRate: result.components.escalationRate,
      impliedBand: result.impliedBand,
      missing: [],
    };
  }
  return { ...base, status: 'INSUFFICIENT' as const, missing: [...result.missing] };
}

export function makeRecomputePorts(tx: TenantClient): RecomputePorts {
  return {
    decisions: {
      async listForScope(scope) {
        const rows = await tx.decision.findMany({
          where: { agentKey: scope.agentKey, taskKey: scope.taskKey },
          orderBy: { createdAt: 'asc' },
        });
        return rows.map(mapDecision);
      },
    },

    lifecycle: {
      async read(scope): Promise<LifecycleState> {
        const row = await tx.task.findUnique({
          where: {
            orgId_agentKey_taskKey: {
              orgId: scope.orgId,
              agentKey: scope.agentKey,
              taskKey: scope.taskKey,
            },
          },
        });
        if (row === null) return INITIAL_LIFECYCLE_STATE;
        return {
          effectiveMode: row.effectiveMode,
          consecutivePromotionReady: row.consecutivePromotionReady,
          consecutiveSubFloor: row.consecutiveSubFloor,
          consecutiveInsufficient: row.consecutiveInsufficient,
          ...(row.lastImpliedRank !== null ? { lastImpliedRank: row.lastImpliedRank } : {}),
          ...(row.pendingToMode !== null
            ? {
                pendingPromotion: {
                  toMode: row.pendingToMode,
                  awaitingApproval: row.pendingAwaitingApproval,
                },
              }
            : {}),
        };
      },

      async write(scope, state): Promise<void> {
        await tx.task.update({
          where: {
            orgId_agentKey_taskKey: {
              orgId: scope.orgId,
              agentKey: scope.agentKey,
              taskKey: scope.taskKey,
            },
          },
          data: {
            effectiveMode: state.effectiveMode,
            consecutivePromotionReady: state.consecutivePromotionReady,
            consecutiveSubFloor: state.consecutiveSubFloor,
            consecutiveInsufficient: state.consecutiveInsufficient,
            lastImpliedRank: state.lastImpliedRank ?? null,
            pendingToMode: state.pendingPromotion?.toMode ?? null,
            pendingAwaitingApproval: state.pendingPromotion?.awaitingApproval ?? false,
          },
        });
      },
    },

    scores: {
      async write(scope, result, calculatedAt): Promise<void> {
        await tx.score.create({ data: scoreData(scope, result, calculatedAt) });
      },
    },

    transitions: {
      async append(transition): Promise<void> {
        await transitionRepo.record(tx, transition);
      },
    },
  };
}
