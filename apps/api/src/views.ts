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
 * Derive the displayed identity state from REAL activity using core's pure rule:
 * no decisions → DISCOVERED; last-seen within the activity window → ACTIVE; older →
 * DORMANT; every task RETIRED → RETIRED. The window is composition-root policy (core
 * refuses to invent a clock), surfaced to the UI as `activityWindowDays`.
 */
export function deriveIdentityState(row: RegistryAgentRow, asOf: string): AgentIdentityState {
  if (row.taskCount > 0 && row.retiredTaskCount === row.taskCount) return 'RETIRED';
  if (row.lastSeen === null) return 'DISCOVERED';
  const lower = Date.parse(asOf) - ACTIVITY_WINDOW_DAYS * MS_PER_DAY;
  const event = Date.parse(row.lastSeen) >= lower ? 'ACTIVITY' : 'INACTIVITY';
  // Apply the event from the base 'ACTIVE' candidate: ACTIVITY→ACTIVE, INACTIVITY→DORMANT.
  return transitionIdentity('ACTIVE', event);
}

export const IDENTITY_POLICY = { activityWindowDays: ACTIVITY_WINDOW_DAYS } as const;

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
