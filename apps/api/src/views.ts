import type { AgentIdentityState } from '@provable/contracts';
import { transitionIdentity } from '@provable/core';
import type { CostView, RegistryAgentRow } from '@provable/persistence';

/**
 * Composition-root view derivations (apps/api). These combine REAL persisted facts with
 * EXPLICIT, on-screen policy (an activity window; ROI cost assumptions). The assumptions
 * travel WITH every derived figure so the dashboard can label projections honestly — no
 * savings number is ever emitted without the inputs that produced it.
 */

// ── Identity display-state (derived from real activity; core owns the rule) ──────
const ACTIVITY_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Canonical displayed identity state. Phase C1: the STORED state is AUTHORITATIVE — admin
 * actions + first-contact write `storedIdentityState`. RETIRED (explicit, or every task
 * retired) and admin-DORMANT are returned as-is; a stored-ACTIVE agent gets the 30-day
 * auto-dormancy overlay via core's pure rule. The window stays composition-root policy
 * (core refuses to invent a clock), surfaced to the UI as `activityWindowDays`.
 */
export function deriveIdentityState(row: RegistryAgentRow, asOf: string): AgentIdentityState {
  const stored = row.storedIdentityState;
  if (stored === 'RETIRED' || (row.taskCount > 0 && row.retiredTaskCount === row.taskCount)) {
    return 'RETIRED';
  }
  if (stored === 'DORMANT') return 'DORMANT'; // admin-deactivated (sticky)
  if (stored === 'DISCOVERED') return row.lastSeen === null ? 'DISCOVERED' : 'ACTIVE';
  // stored === 'ACTIVE' — apply the activity overlay through core's pure rule.
  if (row.lastSeen === null) return 'ACTIVE';
  const lower = Date.parse(asOf) - ACTIVITY_WINDOW_DAYS * MS_PER_DAY;
  return transitionIdentity('ACTIVE', Date.parse(row.lastSeen) >= lower ? 'ACTIVITY' : 'INACTIVITY');
}

/**
 * DISPLAY label — distinguishes the two DORMANT causes the canonical state can't: an
 * admin-deactivated agent ("DEACTIVATED", sticky, never auto-revives) vs a stored-ACTIVE
 * agent merely gone quiet ("IDLE", auto-revives on the next decision). Same stored machine,
 * finer labels for the admin surface.
 */
export type IdentityDisplayStatus = 'DISCOVERED' | 'ACTIVE' | 'IDLE' | 'DEACTIVATED' | 'RETIRED';

export function deriveDisplayStatus(row: RegistryAgentRow, asOf: string): IdentityDisplayStatus {
  const stored = row.storedIdentityState;
  if (stored === 'RETIRED' || (row.taskCount > 0 && row.retiredTaskCount === row.taskCount)) {
    return 'RETIRED';
  }
  if (stored === 'DORMANT') return 'DEACTIVATED';
  if (stored === 'DISCOVERED') return row.lastSeen === null ? 'DISCOVERED' : 'ACTIVE';
  if (row.lastSeen === null) return 'ACTIVE';
  const lower = Date.parse(asOf) - ACTIVITY_WINDOW_DAYS * MS_PER_DAY;
  return Date.parse(row.lastSeen) >= lower ? 'ACTIVE' : 'IDLE';
}

export const IDENTITY_POLICY = { activityWindowDays: ACTIVITY_WINDOW_DAYS } as const;

// ── Integration fidelity (Phase C2) ─────────────────────────────────────────────
/**
 * `observe-only` — the task has activity/cost but ZERO resolved verdicts all-time (the gateway
 * tier: cost + activity, no verdict channel). Readiness is honestly INSUFFICIENT here, never a
 * fabricated 0 — the UI shows "N/A (Observe-only)" + an upgrade prompt. `governed` — a verdict
 * channel exists, so readiness can score. Source-agnostic, but this is exactly what a
 * gateway-only agent looks like.
 */
export type Fidelity = 'observe-only' | 'governed';

export function deriveFidelity(row: { totalVolume: number; totalResolved: number }): Fidelity {
  return row.totalVolume > 0 && row.totalResolved === 0 ? 'observe-only' : 'governed';
}

/** Honest upgrade prompt shown beside an Observe-only task (cost/activity tracked, no score). */
export const OBSERVE_ONLY_UPGRADE =
  'Observe-only: cost + activity tracked. Add verdicts (SDK or adapter) to unlock a readiness score.';

// ── ROI / shadow-counterfactual (PROJECTIONS, assumptions attached) ─────────────
export interface RoiAssumptions {
  /** Minutes a human would spend handling one decision this agent handles. */
  assumedHumanMinutesPerDecision: number;
  /** Fully-loaded human hourly cost, USD. */
  assumedHumanHourlyUsd: number;
}

export const DEFAULT_ROI_ASSUMPTIONS: RoiAssumptions = {
  assumedHumanMinutesPerDecision: 5,
  assumedHumanHourlyUsd: 45,
};

export interface RoiProjection {
  isProjection: true;
  label: string;
  assumptions: RoiAssumptions;
  humanCostPerDecisionUsd: number;
  agentCostPerDecisionUsd: number;
  costDeltaPerDecisionUsd: number;
  shadowDecisionVolume: number;
  /** Shadow-task volume × cost delta IF promoted. A PROJECTION, never banked savings. */
  projectedSavingsIfPromotedUsd: number;
}

export function deriveRoi(
  cost: CostView,
  shadowDecisionVolume: number,
  assumptions: RoiAssumptions = DEFAULT_ROI_ASSUMPTIONS,
): RoiProjection {
  const humanCostPerDecisionUsd =
    (assumptions.assumedHumanMinutesPerDecision / 60) * assumptions.assumedHumanHourlyUsd;
  const agentCostPerDecisionUsd =
    cost.org.decisionCount > 0 ? cost.org.usd / cost.org.decisionCount : 0;
  const costDeltaPerDecisionUsd = Math.max(0, humanCostPerDecisionUsd - agentCostPerDecisionUsd);
  return {
    isProjection: true,
    label: 'Projection - proven savings IF Shadow agents are promoted to operate',
    assumptions,
    humanCostPerDecisionUsd,
    agentCostPerDecisionUsd,
    costDeltaPerDecisionUsd,
    shadowDecisionVolume,
    projectedSavingsIfPromotedUsd: shadowDecisionVolume * costDeltaPerDecisionUsd,
  };
}
