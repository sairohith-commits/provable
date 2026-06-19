import type { AgentKey, TaskKey } from './identifiers.js';
import type { AutonomyMode } from './lifecycle.js';

/**
 * Governance status (Phase U1) — a CLOSED, derived taxonomy. Each task resolves to EXACTLY ONE
 * status, projected from effectiveMode + score + the lifecycle transition log. It is DERIVED,
 * never authoritative: it never feeds back into the score or the effectiveMode state machine.
 *
 *   PROMOTABLE — scored above its level with a LIVE promotion to act on (actionAvailable=true).
 *   HELD       — manually overridden BELOW the earned band (a standing divergence; review it).
 *   AT_LEVEL   — operating at its sanctioned level; nothing to act on.
 *   DEGRADED   — unscored, or just auto-demoted by signal-loss/drift.
 *   SUSPENDED  — effectiveMode is SUSPENDED (beats any score).
 */
export const GOVERNANCE_STATUSES = ['PROMOTABLE', 'HELD', 'AT_LEVEL', 'DEGRADED', 'SUSPENDED'] as const;
export type GovernanceStatus = (typeof GOVERNANCE_STATUSES)[number];

/** One row of the fleet read-model — exactly one status per task. `Mode` = AutonomyMode. */
export interface TaskGovernanceView {
  readonly agentKey: AgentKey;
  readonly taskKey: TaskKey;
  readonly score: number | null; // null ⇒ unscored
  readonly impliedBand: AutonomyMode | null; // band the score implies; null ⇒ unscored
  readonly effectiveMode: AutonomyMode; // the governed operating mode
  readonly status: GovernanceStatus;
  readonly headroomTo: AutonomyMode | null; // next band up if PROMOTABLE/HELD, else null
  readonly actionAvailable: boolean; // true ONLY for a live, valid promotion
  readonly reasonNote: string; // short human sub-line
}

/** Overview KPIs DERIVED from the same views — counts can never disagree with the rows. */
export interface FleetKpis {
  readonly promotableNow: number; // count(status == PROMOTABLE)
  readonly needsAttention: number; // count(DEGRADED) + count(SUSPENDED)
  readonly tasksGoverned: number; // total task views
}

export interface FleetOverview {
  readonly tasks: readonly TaskGovernanceView[];
  readonly kpis: FleetKpis;
}
