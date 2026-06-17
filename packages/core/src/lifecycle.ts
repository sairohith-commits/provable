import type {
  AgentKey,
  AutonomyMode,
  OrgId,
  TaskKey,
  Transition,
  TransitionDirection,
  TransitionStatus,
  TransitionTrigger,
} from '@provable/contracts';
import type { GovernancePolicy } from './policy.js';
import type { ReadinessResult, ScoreImpliedBand } from './readiness.js';
import type { DriftSignal, GuardrailTrip, ManualDecision } from './signals.js';

/**
 * Lifecycle — the governed autonomy state machine (PROVABLE_CORE_ARCHITECTURE.md §2A).
 *
 * PURE: `stepLifecycle` is a reducer (state, recompute) → (state, transitions).
 * No clock, no I/O. `effectiveMode` changes ONLY by emitting a Transition.
 *
 * The asymmetry (the whole governance value):
 *   - PROMOTION is gated: hysteresis → PROPOSED → PENDING_APPROVAL → (human) APPLIED.
 *     A high score alone NEVER moves effectiveMode.
 *   - DEMOTION is automatic: guardrail/drift = instant AUTO_APPLIED (grace 0);
 *     score-drop = AUTO_APPLIED on the Nth consecutive sub-floor recompute.
 */

export interface LifecycleIds {
  readonly orgId: OrgId;
  readonly agentKey: AgentKey;
  readonly taskKey: TaskKey;
}

interface PendingPromotion {
  readonly toMode: AutonomyMode;
  readonly awaitingApproval: boolean;
}

export interface LifecycleState {
  readonly effectiveMode: AutonomyMode;
  readonly consecutivePromotionReady: number;
  readonly consecutiveSubFloor: number;
  /** Consecutive INSUFFICIENT recomputes while governed — drives signal-loss demotion. */
  readonly consecutiveInsufficient: number;
  readonly pendingPromotion?: PendingPromotion;
}

export interface LifecycleSignals {
  readonly drift?: DriftSignal;
  readonly guardrail?: GuardrailTrip;
  readonly manual?: ManualDecision;
}

export interface LifecycleStepInput {
  readonly ids: LifecycleIds;
  readonly state: LifecycleState;
  readonly readiness: ReadinessResult;
  readonly signals?: LifecycleSignals;
  readonly policy: GovernancePolicy;
  readonly asOf: string;
}

export interface LifecycleStepResult {
  readonly transitions: readonly Transition[];
  readonly state: LifecycleState;
  readonly effectiveMode: AutonomyMode;
}

/** Every agent×task starts in OBSERVING — no agent starts above SHADOW. */
export const INITIAL_LIFECYCLE_STATE: LifecycleState = {
  effectiveMode: 'OBSERVING',
  consecutivePromotionReady: 0,
  consecutiveSubFloor: 0,
  consecutiveInsufficient: 0,
};

// ─── band helpers ────────────────────────────────────────────────────────────

const OPERATING: ReadonlySet<AutonomyMode> = new Set<AutonomyMode>(['SHADOW', 'CO_PILOT', 'SOLO']);
function isOperating(mode: AutonomyMode): boolean {
  return OPERATING.has(mode);
}

function bandRank(mode: AutonomyMode): number {
  switch (mode) {
    case 'RETIRED':
      return -2;
    case 'SUSPENDED':
      return -1;
    case 'OBSERVING':
      return 0;
    case 'SHADOW':
      return 1;
    case 'CO_PILOT':
      return 2;
    case 'SOLO':
      return 3;
  }
}

function impliedRankOf(band: ScoreImpliedBand): number {
  switch (band) {
    case 'SHADOW':
      return 1;
    case 'CO_PILOT':
      return 2;
    case 'SOLO':
      return 3;
  }
}

function nextBandUp(mode: AutonomyMode): AutonomyMode | undefined {
  if (mode === 'SHADOW') return 'CO_PILOT';
  if (mode === 'CO_PILOT') return 'SOLO';
  return undefined; // SOLO is the top
}

function oneBandDown(mode: AutonomyMode): AutonomyMode {
  if (mode === 'SOLO') return 'CO_PILOT';
  if (mode === 'CO_PILOT') return 'SHADOW';
  return 'SUSPENDED'; // below SHADOW there is no lower operating band
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── transition + state builders ─────────────────────────────────────────────

function makeTransition(
  ids: LifecycleIds,
  fromMode: AutonomyMode,
  toMode: AutonomyMode,
  direction: TransitionDirection,
  trigger: TransitionTrigger,
  status: TransitionStatus,
  reason: string,
  at: string,
  approver?: string,
): Transition {
  // The one business invariant the relaxed contract type can't express:
  if (direction === 'PROMOTION' && status === 'APPLIED' && (approver === undefined || approver === '')) {
    throw new Error('core/lifecycle invariant: an APPLIED promotion must carry an approver');
  }
  const t: Transition = {
    orgId: ids.orgId,
    agentKey: ids.agentKey,
    taskKey: ids.taskKey,
    fromMode,
    toMode,
    direction,
    trigger,
    status,
    reason,
    at,
  };
  return approver === undefined ? t : { ...t, approver };
}

function mkState(
  effectiveMode: AutonomyMode,
  consecutivePromotionReady: number,
  consecutiveSubFloor: number,
  pendingPromotion?: PendingPromotion,
  consecutiveInsufficient = 0, // SCORED/safety/observing recomputes reset it (the default)
): LifecycleState {
  const base = {
    effectiveMode,
    consecutivePromotionReady,
    consecutiveSubFloor,
    consecutiveInsufficient,
  };
  return pendingPromotion === undefined ? base : { ...base, pendingPromotion };
}

// ─── the engine ──────────────────────────────────────────────────────────────

export function stepLifecycle(input: LifecycleStepInput): LifecycleStepResult {
  const { ids, state, readiness, policy, asOf } = input;
  const signals: LifecycleSignals = input.signals ?? {};
  const mode = state.effectiveMode;
  const transitions: Transition[] = [];

  const mk = (
    toMode: AutonomyMode,
    direction: TransitionDirection,
    trigger: TransitionTrigger,
    status: TransitionStatus,
    reason: string,
    approver?: string,
  ): Transition => makeTransition(ids, mode, toMode, direction, trigger, status, reason, asOf, approver);

  // 0) Terminal.
  if (mode === 'RETIRED') {
    return { transitions, state, effectiveMode: mode };
  }

  // 1) Guardrail — instant AUTO_APPLIED suspension, grace 0 (highest precedence).
  if (signals.guardrail) {
    if (mode === 'SUSPENDED') {
      return { transitions, state: mkState('SUSPENDED', 0, 0), effectiveMode: 'SUSPENDED' };
    }
    transitions.push(
      mk(
        'SUSPENDED',
        'DEMOTION',
        'GUARDRAIL',
        'AUTO_APPLIED',
        `guardrail ${signals.guardrail.guardrailId} tripped: ${signals.guardrail.reason}`,
      ),
    );
    return { transitions, state: mkState('SUSPENDED', 0, 0), effectiveMode: 'SUSPENDED' };
  }

  // 2) Drift — instant AUTO_APPLIED demotion, grace 0.
  if (signals.drift && isOperating(mode)) {
    const target = oneBandDown(mode);
    transitions.push(
      mk(target, 'DEMOTION', 'DRIFT', 'AUTO_APPLIED', `drift detected: ${signals.drift.reason}`),
    );
    return { transitions, state: mkState(target, 0, 0), effectiveMode: target };
  }

  // 3) Manual decision resolves a pending promotion.
  if (signals.manual && state.pendingPromotion) {
    const pending = state.pendingPromotion;
    if (signals.manual.kind === 'APPROVE') {
      transitions.push(
        mk(
          pending.toMode,
          'PROMOTION',
          'SCORE_CROSS',
          'APPLIED',
          `promotion to ${pending.toMode} approved by ${signals.manual.approver}`,
          signals.manual.approver,
        ),
      );
      return { transitions, state: mkState(pending.toMode, 0, 0), effectiveMode: pending.toMode };
    }
    transitions.push(
      mk(
        pending.toMode,
        'PROMOTION',
        'SCORE_CROSS',
        'REJECTED',
        `promotion to ${pending.toMode} rejected by ${signals.manual.approver}`,
        signals.manual.approver,
      ),
    );
    return { transitions, state: mkState(mode, 0, 0), effectiveMode: mode };
  }

  // 4) OBSERVING → SHADOW requires BOTH ≥N resolved verdicts AND a SCORED readiness
  //    (Q3: no confidence/outcome signal → unscored → stays OBSERVING).
  if (mode === 'OBSERVING') {
    if (
      readiness.status === 'SCORED' &&
      readiness.resolvedCount >= policy.observingExitMinResolved
    ) {
      transitions.push(
        mk(
          'SHADOW',
          'LATERAL',
          'SCORE_CROSS',
          'AUTO_APPLIED',
          `observing window reached ${readiness.resolvedCount} resolved & scored decisions`,
        ),
      );
      return { transitions, state: mkState('SHADOW', 0, 0), effectiveMode: 'SHADOW' };
    }
    return { transitions, state: mkState('OBSERVING', 0, 0), effectiveMode: 'OBSERVING' };
  }

  // 5) SUSPENDED holds (recovery flow deferred to a later phase).
  if (mode === 'SUSPENDED') {
    return { transitions, state: mkState('SUSPENDED', 0, 0), effectiveMode: 'SUSPENDED' };
  }

  // 5b) INSUFFICIENT readiness for an operating task. A GOVERNED task (CO_PILOT/SOLO) whose
  //     signal is lost auto-demotes one band after a grace window (safety-biased, AUTO_APPLIED,
  //     no approver). SHADOW has nothing to demote — it just holds. The hysteresis streaks
  //     reset (a gap breaks them); a pending promotion is preserved within grace.
  //     Emits the dedicated SIGNAL_LOSS trigger (ratified addition to the closed trigger set):
  //     Legal/audit must distinguish a lost signal from genuine performance DRIFT.
  if (readiness.status !== 'SCORED') {
    if (mode === 'CO_PILOT' || mode === 'SOLO') {
      const nextInsufficient = state.consecutiveInsufficient + 1;
      if (nextInsufficient >= policy.signalLossGraceRecomputes) {
        const target = oneBandDown(mode);
        transitions.push(
          mk(
            target,
            'DEMOTION',
            'SIGNAL_LOSS',
            'AUTO_APPLIED',
            `signal lost: readiness INSUFFICIENT for ${nextInsufficient} consecutive recomputes`,
          ),
        );
        return { transitions, state: mkState(target, 0, 0), effectiveMode: target };
      }
      return {
        transitions,
        state: mkState(mode, 0, 0, state.pendingPromotion, nextInsufficient),
        effectiveMode: mode,
      };
    }
    // SHADOW (lowest operating band) — nothing to demote on signal loss.
    return {
      transitions,
      state: mkState(mode, 0, 0, state.pendingPromotion),
      effectiveMode: mode,
    };
  }

  // ── operating modes (SHADOW | CO_PILOT | SOLO) with a SCORED readiness ──
  const modeRank = bandRank(mode);
  const impliedRank = impliedRankOf(readiness.impliedBand);

  // 6) Score-drop demotion (takes precedence over promotion). 1-confirm grace.
  if (impliedRank < modeRank) {
    const nextSubFloor = state.consecutiveSubFloor + 1;
    if (nextSubFloor >= policy.scoreDropConfirmRecomputes) {
      const target = oneBandDown(mode);
      transitions.push(
        mk(
          target,
          'DEMOTION',
          'SCORE_CROSS',
          'AUTO_APPLIED',
          `score ${round2(readiness.readinessScore)} below ${mode} floor for ${nextSubFloor} consecutive recomputes`,
        ),
      );
      return { transitions, state: mkState(target, 0, 0), effectiveMode: target };
    }
    // First sub-floor recompute: no demotion yet; any promotion progress resets.
    return { transitions, state: mkState(mode, 0, nextSubFloor), effectiveMode: mode };
  }

  // 7) Promotion path (score is on/above the current band).
  const pending = state.pendingPromotion;
  if (pending) {
    if (!pending.awaitingApproval) {
      transitions.push(
        mk(
          pending.toMode,
          'PROMOTION',
          'SCORE_CROSS',
          'PENDING_APPROVAL',
          `promotion to ${pending.toMode} awaiting human approval`,
        ),
      );
      return {
        transitions,
        state: mkState(mode, 0, 0, { toMode: pending.toMode, awaitingApproval: true }),
        effectiveMode: mode,
      };
    }
    // Awaiting approval — hold; mode unchanged, no churn.
    return { transitions, state: mkState(mode, 0, 0, pending), effectiveMode: mode };
  }

  const target = nextBandUp(mode);
  if (target !== undefined && impliedRank >= bandRank(target)) {
    const nextReady = state.consecutivePromotionReady + 1;
    if (nextReady >= policy.promotionHysteresisRecomputes) {
      transitions.push(
        mk(
          target,
          'PROMOTION',
          'SCORE_CROSS',
          'PROPOSED',
          `score sustained ${target}-implied for ${nextReady} consecutive recomputes`,
        ),
      );
      return {
        transitions,
        state: mkState(mode, 0, 0, { toMode: target, awaitingApproval: false }),
        effectiveMode: mode,
      };
    }
    return { transitions, state: mkState(mode, nextReady, 0), effectiveMode: mode };
  }

  // Score not high enough to build promotion (or already SOLO) → reset counters.
  return { transitions, state: mkState(mode, 0, 0), effectiveMode: mode };
}

/** Fold a sequence of recomputes through the engine (pure convenience for tests/consumers). */
export function runLifecycle(
  ids: LifecycleIds,
  initial: LifecycleState,
  steps: ReadonlyArray<{ readiness: ReadinessResult; signals?: LifecycleSignals; asOf: string }>,
  policy: GovernancePolicy,
): { state: LifecycleState; transitions: Transition[] } {
  let state = initial;
  const all: Transition[] = [];
  for (const s of steps) {
    const base = { ids, state, readiness: s.readiness, policy, asOf: s.asOf };
    const result = stepLifecycle(s.signals === undefined ? base : { ...base, signals: s.signals });
    state = result.state;
    all.push(...result.transitions);
  }
  return { state, transitions: all };
}
