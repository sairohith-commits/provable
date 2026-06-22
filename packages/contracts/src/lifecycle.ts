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
  'SIGNAL_LOSS',
  'MANUAL_OVERRIDE',
  'SCHEDULED',
  'SUSPEND', // manual kill-switch park (suspend_agent); APPLIED, actor-stamped. Distinct from MANUAL_OVERRIDE.
  'RESUME', // manual recovery to OBSERVING (route-driven only; the auto-engine never self-resumes).
] as const;
export type TransitionTrigger = (typeof TRANSITION_TRIGGERS)[number];

export const TRANSITION_STATUSES = [
  'PROPOSED',
  'PENDING_APPROVAL',
  'APPLIED',
  'AUTO_APPLIED',
  'REJECTED',
  'SUPERSEDED',
] as const;
export type TransitionStatus = (typeof TRANSITION_STATUSES)[number];

/**
 * Transition — first-class, immutable, audited (§2A).
 *
 * Modeled field-for-field on the doc's interface (§2A, line 167): `approver?` is
 * OPTIONAL. The doc comments it "REQUIRED for PROMOTION", but that is a *business*
 * invariant, not a type-level one — a promotion is PROPOSED and held at
 * PENDING_APPROVAL *before* any approver exists, so the type cannot demand an
 * approver on every PROMOTION record. `core/lifecycle` enforces the real rule: a
 * PROMOTION may only reach `status: 'APPLIED'` with an `approver` present.
 *
 * (Phase 1 modeled this as a discriminated union requiring `approver` on every
 * PROMOTION; Phase 2 showed that makes a PROPOSED promotion unrepresentable, so
 * this was corrected to the doc's literal flat shape. Doc wins.)
 */
export interface Transition {
  orgId: OrgId;
  agentKey: AgentKey;
  taskKey: TaskKey;
  fromMode: AutonomyMode;
  toMode: AutonomyMode;
  direction: TransitionDirection;
  trigger: TransitionTrigger;
  status: TransitionStatus;
  approver?: string; // REQUIRED for an APPLIED EARNED promotion (trigger SCORE_CROSS) — core/lifecycle
  actor?: string; // REQUIRED for MANUAL_OVERRIDE — the authorizing human (Owner/Approver). Distinct from approver.
  reason: string; // evidence: score delta, drift metric, guardrail id, or override rationale
  at: string;
}
