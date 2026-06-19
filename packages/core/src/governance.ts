import type { AutonomyMode, GovernanceStatus } from '@provable/contracts';

/**
 * Governance status derivation (Phase U1) — PURE. Projects EXACTLY ONE status from
 * effectiveMode + score + a digest of the lifecycle transition log. Derived, never
 * authoritative: it never touches the score or the effectiveMode state machine. Imports only
 * @provable/contracts types — no adapter, no vendor, no domain noun.
 *
 * Precedence (FIRST match wins):
 *   (a) SUSPENDED  — effectiveMode is SUSPENDED. Beats any score.
 *   (b) OBSERVING  — observe-only: effectiveMode OBSERVING and NOT a fresh signal-loss/drift
 *                    auto-demotion. Cost/activity flow but no verdicts → readiness N/A, not
 *                    promotable. Informational, NOT "needs attention".
 *   (c) DEGRADED   — a GOVERNED-mode task that lost signal / auto-demoted, OR an unscored governed
 *                    task. (A signal-loss demotion can land IN OBSERVING mode — it is caught here,
 *                    not (b), because the latest transition is the auto-demotion.)
 *   (d) HELD       — manually overridden BELOW the earned band (rank(effective) < rank(implied)).
 *   (e) PROMOTABLE — scored, rank(implied) > rank(effective), a LIVE promotion exists.
 *   (f) AT_LEVEL   — everything else (rank-equal, or above-without-a-live-promotion).
 */

const RANK: Readonly<Record<AutonomyMode, number>> = {
  RETIRED: -2,
  SUSPENDED: -1,
  OBSERVING: 0,
  SHADOW: 1,
  CO_PILOT: 2,
  SOLO: 3,
};

export interface GovernanceDerivationInput {
  readonly effectiveMode: AutonomyMode;
  readonly scored: boolean; // false ⇒ insufficient signal
  readonly impliedBand: AutonomyMode | null; // null ⇒ unscored
  /** The transition that set the CURRENT effectiveMode was a MANUAL_OVERRIDE. */
  readonly effectiveModeViaOverride: boolean;
  /** The MOST-RECENT transition is an AUTO_APPLIED DEMOTION triggered by SIGNAL_LOSS or DRIFT. */
  readonly latestIsAutoDemotionSignalLossOrDrift: boolean;
  /** A live promotion: the most-recent transition is PROPOSED/PENDING_APPROVAL (not superseded). */
  readonly livePromotion: boolean;
  /** Optional cause text (e.g. a guardrail reason) used only for SUSPENDED/DEGRADED notes. */
  readonly reasonNote?: string;
}

export interface GovernanceResult {
  readonly status: GovernanceStatus;
  readonly headroomTo: AutonomyMode | null;
  readonly actionAvailable: boolean;
  readonly reasonNote: string;
}

function note(provided: string | undefined, fallback: string): string {
  return provided !== undefined && provided.length > 0 ? provided : fallback;
}

export function deriveGovernanceStatus(i: GovernanceDerivationInput): GovernanceResult {
  // (a) SUSPENDED — beats any score.
  if (i.effectiveMode === 'SUSPENDED') {
    return { status: 'SUSPENDED', headroomTo: null, actionAvailable: false, reasonNote: note(i.reasonNote, 'suspended') };
  }

  // (b) OBSERVING — genuine observe-only (no verdict channel). Excludes a governed task that just
  //     signal-loss/drift auto-demoted INTO observing (that is DEGRADED, caught next).
  if (i.effectiveMode === 'OBSERVING' && !i.latestIsAutoDemotionSignalLossOrDrift) {
    return {
      status: 'OBSERVING',
      headroomTo: null,
      actionAvailable: false,
      reasonNote: note(i.reasonNote, 'observe-only — connect verdicts to govern'),
    };
  }

  // (c) DEGRADED — a governed-mode task that lost signal / auto-demoted, or an unscored governed
  //     task. Observe-only/never-scored agents are caught by (b) above and never reach here.
  if (!i.scored || i.latestIsAutoDemotionSignalLossOrDrift) {
    const fallback = i.scored ? 'auto-demoted (signal loss or drift)' : 'insufficient signal to score';
    return { status: 'DEGRADED', headroomTo: null, actionAvailable: false, reasonNote: note(i.reasonNote, fallback) };
  }

  // Scored from here ⇒ impliedBand is non-null.
  const effRank = RANK[i.effectiveMode];
  const impRank = i.impliedBand !== null ? RANK[i.impliedBand] : effRank;

  // (c) HELD — manual override sitting below the earned band (standing divergence).
  if (i.effectiveModeViaOverride && effRank < impRank) {
    return { status: 'HELD', headroomTo: i.impliedBand, actionAvailable: false, reasonNote: note(i.reasonNote, 'manual hold below earned level') };
  }

  // (d) PROMOTABLE — earned above its level AND a live promotion to act on.
  if (impRank > effRank && i.livePromotion) {
    return { status: 'PROMOTABLE', headroomTo: i.impliedBand, actionAvailable: true, reasonNote: 'promotion ready for approval' };
  }

  // (e) AT_LEVEL — rank-equal, or above-without-a-live-promotion (nothing to act on yet).
  return { status: 'AT_LEVEL', headroomTo: null, actionAvailable: false, reasonNote: 'operating at sanctioned level' };
}
