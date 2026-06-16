/**
 * GovernancePolicy — the ONLY open knobs in core.
 *
 * The readiness formula weights (0.40/0.25/0.20/0.15), the band thresholds
 * (40, 70) and the 30-day window are LOCKED by PROVABLE_CORE_ARCHITECTURE.md §2
 * and live as `as const` constants in `readiness.ts` — they are NOT part of this
 * policy and are NOT configurable.
 *
 * These knobs govern the lifecycle's timing only (the asymmetry of promotion vs.
 * demotion), per the Phase-2 proposed defaults.
 */
export interface GovernancePolicy {
  /**
   * OBSERVING exits to SHADOW once the window holds at least this many
   * resolved-verdict decisions. Exit is ALWAYS to SHADOW, regardless of score.
   */
  readonly observingExitMinResolved: number;

  /**
   * Promotion hysteresis: the score must stay on the target side of the band
   * threshold for this many consecutive recomputes before a promotion is
   * PROPOSED. A high score alone never auto-promotes.
   */
  readonly promotionHysteresisRecomputes: number;

  /**
   * Score-drop demotion grace (asymmetric — "easy to fall"): a sub-floor score
   * demotes on this many consecutive sub-floor recomputes. `2` = 1-confirm
   * (demote on the 2nd). Guardrail and drift ignore this — they are grace-0.
   */
  readonly scoreDropConfirmRecomputes: number;

  /**
   * Signal-loss demotion grace: a GOVERNED task (CO_PILOT/SOLO) whose readiness is
   * INSUFFICIENT for this many consecutive recomputes auto-demotes one band. `2` =
   * 1-confirm (demote on the 2nd), matching the score-drop grace. Safety-biased
   * (AUTO_APPLIED, no approval). OBSERVING/SHADOW are unaffected.
   */
  readonly signalLossGraceRecomputes: number;
}

export const DEFAULT_GOVERNANCE_POLICY: GovernancePolicy = {
  observingExitMinResolved: 10,
  promotionHysteresisRecomputes: 3,
  scoreDropConfirmRecomputes: 2,
  signalLossGraceRecomputes: 2,
};
