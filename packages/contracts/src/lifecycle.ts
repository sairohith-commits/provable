import type { AgentKey, OrgId, TaskKey } from './identifiers.js';

/**
 * Lifecycle — TYPES ONLY (PROVABLE_CORE_ARCHITECTURE.md §2A).
 *
 * No logic lives here in Phase 1. The state machines, hysteresis, promote-gating
 * and auto-demotion are `core/lifecycle` (Phase 2). This file is only the closed
 * vocabulary those engines will operate over.
 */

/** Agent identity state machine (per agent): DISCOVERED → ACTIVE → DORMANT → RETIRED. */
export const AGENT_IDENTITY_STATES = ['DISCOVERED', 'ACTIVE', 'DORMANT', 'RETIRED'] as const;
export type AgentIdentityState = (typeof AGENT_IDENTITY_STATES)[number];

/**
 * Autonomy mode (per agent × task — the real lifecycle):
 * OBSERVING → SHADOW → CO_PILOT → SOLO  (+ SUSPENDED, RETIRED).
 *
 * The doc (§2A) names this union `Mode`; we expose the single name `AutonomyMode`.
 */
export const AUTONOMY_MODES = [
  'OBSERVING',
  'SHADOW',
  'CO_PILOT',
  'SOLO',
  'SUSPENDED',
  'RETIRED',
] as const;
export type AutonomyMode = (typeof AUTONOMY_MODES)[number];

export const TRANSITION_DIRECTIONS = ['PROMOTION', 'DEMOTION', 'LATERAL'] as const;
export type TransitionDirection = (typeof TRANSITION_DIRECTIONS)[number];

export const TRANSITION_TRIGGERS = [
  'SCORE_CROSS',
  'DRIFT',
  'GUARDRAIL',
  'MANUAL',
  'SCHEDULED',
] as const;
export type TransitionTrigger = (typeof TRANSITION_TRIGGERS)[number];

export const TRANSITION_STATUSES = [
  'PROPOSED',
  'PENDING_APPROVAL',
  'APPLIED',
  'AUTO_APPLIED',
  'REJECTED',
] as const;
export type TransitionStatus = (typeof TRANSITION_STATUSES)[number];

/** Fields shared by every Transition, regardless of direction. */
interface TransitionBase {
  orgId: OrgId;
  agentKey: AgentKey;
  taskKey: TaskKey;
  fromMode: AutonomyMode;
  toMode: AutonomyMode;
  trigger: TransitionTrigger;
  status: TransitionStatus;
  reason: string; // evidence: score delta, drift metric, guardrail id
  at: string;
}

/**
 * Transition — first-class, immutable, audited (§2A).
 *
 * The asymmetry of governance: promotion is gated, demotion is automatic.
 * Encoded structurally — `approver` is REQUIRED when `direction === 'PROMOTION'`
 * and optional otherwise — via a discriminated union on `direction`.
 */
export type Transition =
  | (TransitionBase & { direction: 'PROMOTION'; approver: string })
  | (TransitionBase & { direction: 'DEMOTION'; approver?: string })
  | (TransitionBase & { direction: 'LATERAL'; approver?: string });
