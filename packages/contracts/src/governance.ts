import type { AgentKey, TaskKey } from './identifiers.js';
import type { AutonomyMode, TransitionTrigger } from './lifecycle.js';

/**
 * Governance status (Phase U1) — a CLOSED, derived taxonomy. Each task resolves to EXACTLY ONE
 * status, projected from effectiveMode + score + the lifecycle transition log. It is DERIVED,
 * never authoritative: it never feeds back into the score or the effectiveMode state machine.
 *
 *   PROMOTABLE — scored above its level with a LIVE promotion to act on (actionAvailable=true).
 *   HELD       — manually overridden BELOW the earned band (a standing divergence; review it).
 *   AT_LEVEL   — operating at its sanctioned level; nothing to act on.
 *   OBSERVING  — observe-only (effectiveMode OBSERVING): cost/activity flow but no verdicts, so
 *                readiness is N/A and it is not promotable. Informational, NOT "needs attention".
 *   DEGRADED   — a GOVERNED-mode task that lost signal / auto-demoted (signal-loss/drift). It no
 *                longer catches never-scored observe-only agents (those are OBSERVING).
 *   SUSPENDED  — effectiveMode is SUSPENDED (beats any score).
 */
export const GOVERNANCE_STATUSES = ['PROMOTABLE', 'HELD', 'AT_LEVEL', 'OBSERVING', 'DEGRADED', 'SUSPENDED'] as const;
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
  // The trigger of the transition that set the CURRENT effectiveMode when SUSPENDED — lets the UI
  // distinguish a manual kill-switch (SUSPEND) from a platform GUARDRAIL trip or DRIFT. Only
  // meaningful while status === 'SUSPENDED'; null/absent otherwise.
  readonly suspendTrigger?: TransitionTrigger | null;
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
