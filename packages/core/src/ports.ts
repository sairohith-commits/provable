import type { AgentKey, Decision, OrgId, TaskKey, Transition } from '@provable/contracts';
import type { LifecycleState } from './lifecycle.js';
import type { ReadinessResult } from './readiness.js';

/**
 * Outbound port interfaces — what the recompute orchestration (apps/api) needs from
 * the data layer. PURE: declared here in core, importing only contracts + core types.
 * persistence IMPLEMENTS these; core never does I/O.
 */

export interface TaskScope {
  readonly orgId: OrgId;
  readonly agentKey: AgentKey;
  readonly taskKey: TaskKey;
}

/** Reads the decisions computeReadiness should window over (it filters by `asOf` itself). */
export interface DecisionWindowReader {
  listForScope(scope: TaskScope): Promise<readonly Decision[]>;
}

/** Reads the materialized lifecycle state: effectiveMode + hysteresis counters + pending promotion. */
export interface LifecycleStateReader {
  read(scope: TaskScope): Promise<LifecycleState>;
}

/** Materializes the lifecycle state after a step (the transition log remains the immutable history). */
export interface LifecycleStateWriter {
  write(scope: TaskScope, state: LifecycleState): Promise<void>;
}

/** Persists a readiness result (SCORED | INSUFFICIENT). */
export interface ScoreWriter {
  write(scope: TaskScope, result: ReadinessResult, calculatedAt: string): Promise<void>;
}

/** Appends an immutable transition record. */
export interface TransitionWriter {
  append(transition: Transition): Promise<void>;
}
