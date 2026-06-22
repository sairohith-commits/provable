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
  /**
   * The score-implied band rank at the previous SCORED recompute — the regression baseline.
   * Score-demotion fires only on a FRESH decline (impliedRank drops below this), NOT on a static
   * `score < mode` gap. So a MANUAL_OVERRIDE above earned band is a STANDING divergence that is
   * surfaced, not auto-undone; a genuine new decline still auto-demotes it. Undefined until the
   * first SCORED recompute (no prior ⇒ no decline). PROVABLE_CORE_ARCHITECTURE.md §2A.
   */
  readonly lastImpliedRank?: number;
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

/**
 * Triggers authorized by an ACTOR (a human acting directly), NOT by an earned-promotion approver:
 * a free-set override and the two kill-switch actions. Each carries `actor` and is exempt from the
 * "an APPLIED PROMOTION needs an approver" rule (a RESUME is a PROMOTION by band rank but is a
 * human recovery, not an earned promotion).
 */
const ACTOR_AUTHORIZED_TRIGGERS: ReadonlySet<TransitionTrigger> = new Set<TransitionTrigger>([
  'MANUAL_OVERRIDE',
  'SUSPEND',
  'RESUME',
]);

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
  actor?: string,
): Transition {
  // Business invariants the relaxed contract type can't express:
  if (ACTOR_AUTHORIZED_TRIGGERS.has(trigger)) {
    // Authorized by an ACTOR (the human), not an earned-promotion approver.
    if (actor === undefined || actor === '') {
      throw new Error(`core/lifecycle invariant: a ${trigger} must carry an actor`);
    }
  } else if (direction === 'PROMOTION' && status === 'APPLIED' && (approver === undefined || approver === '')) {
    // An EARNED (SCORE_CROSS) promotion may only be APPLIED with a human approver.
    throw new Error('core/lifecycle invariant: an APPLIED earned promotion must carry an approver');
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
  return {
    ...t,
    ...(approver !== undefined ? { approver } : {}),
    ...(actor !== undefined ? { actor } : {}),
  };
}

function mkState(
  effectiveMode: AutonomyMode,
  consecutivePromotionReady: number,
  consecutiveSubFloor: number,
  pendingPromotion?: PendingPromotion,
  consecutiveInsufficient = 0, // SCORED/safety/observing recomputes reset it (the default)
  lastImpliedRank?: number, // regression baseline — carry across recomputes (preserve or update)
): LifecycleState {
  const base = {
    effectiveMode,
    consecutivePromotionReady,
    consecutiveSubFloor,
    consecutiveInsufficient,
    ...(lastImpliedRank !== undefined ? { lastImpliedRank } : {}),
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

  // lastImpliedRank (regression baseline) is PRESERVED through non-scored branches and UPDATED
  // to the current implied rank on every SCORED recompute (steps 6/7 + observing exit).
  const baseline = state.lastImpliedRank;

  // A safety/override event that lands while a promotion is in flight SUPERSEDES that pending
  // (a terminal, audited record) so the read-model never treats a stale pending as live.
  const supersedePending = (): void => {
    if (state.pendingPromotion) {
      transitions.push(
        mk(
          state.pendingPromotion.toMode,
          'PROMOTION',
          'SCORE_CROSS',
          'SUPERSEDED',
          `promotion to ${state.pendingPromotion.toMode} superseded by a later transition`,
        ),
      );
    }
  };

  // 1) Guardrail — instant AUTO_APPLIED suspension, grace 0 (highest precedence).
  if (signals.guardrail) {
    if (mode === 'SUSPENDED') {
      return { transitions, state: mkState('SUSPENDED', 0, 0, undefined, 0, baseline), effectiveMode: 'SUSPENDED' };
    }
    supersedePending();
    transitions.push(
      mk(
        'SUSPENDED',
        'DEMOTION',
        'GUARDRAIL',
        'AUTO_APPLIED',
        `guardrail ${signals.guardrail.guardrailId} tripped: ${signals.guardrail.reason}`,
      ),
    );
    return { transitions, state: mkState('SUSPENDED', 0, 0, undefined, 0, baseline), effectiveMode: 'SUSPENDED' };
  }

  // 2) Drift — instant AUTO_APPLIED demotion, grace 0. Applies to manually-set agents too.
  if (signals.drift && isOperating(mode)) {
    const target = oneBandDown(mode);
    supersedePending();
    transitions.push(
      mk(target, 'DEMOTION', 'DRIFT', 'AUTO_APPLIED', `drift detected: ${signals.drift.reason}`),
    );
    return { transitions, state: mkState(target, 0, 0, undefined, 0, baseline), effectiveMode: target };
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
      return { transitions, state: mkState(pending.toMode, 0, 0, undefined, 0, baseline), effectiveMode: pending.toMode };
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
    return { transitions, state: mkState(mode, 0, 0, undefined, 0, baseline), effectiveMode: mode };
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
      return {
        transitions,
        state: mkState('SHADOW', 0, 0, undefined, 0, impliedRankOf(readiness.impliedBand)),
        effectiveMode: 'SHADOW',
      };
    }
    return { transitions, state: mkState('OBSERVING', 0, 0, undefined, 0, baseline), effectiveMode: 'OBSERVING' };
  }

  // 5) SUSPENDED holds (recovery flow deferred to a later phase).
  if (mode === 'SUSPENDED') {
    return { transitions, state: mkState('SUSPENDED', 0, 0, undefined, 0, baseline), effectiveMode: 'SUSPENDED' };
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
        supersedePending();
        transitions.push(
          mk(
            target,
            'DEMOTION',
            'SIGNAL_LOSS',
            'AUTO_APPLIED',
            `signal lost: readiness INSUFFICIENT for ${nextInsufficient} consecutive recomputes`,
          ),
        );
        return { transitions, state: mkState(target, 0, 0, undefined, 0, baseline), effectiveMode: target };
      }
      return {
        transitions,
        state: mkState(mode, 0, 0, state.pendingPromotion, nextInsufficient, baseline),
        effectiveMode: mode,
      };
    }
    // SHADOW (lowest operating band) — nothing to demote on signal loss.
    return {
      transitions,
      state: mkState(mode, 0, 0, state.pendingPromotion, 0, baseline),
      effectiveMode: mode,
    };
  }

  // ── operating modes (SHADOW | CO_PILOT | SOLO) with a SCORED readiness ──
  const modeRank = bandRank(mode);
  const impliedRank = impliedRankOf(readiness.impliedBand);

  // 6) Score-drop demotion — a REGRESSION check (a FRESH decline below the mode floor), NOT a
  //    static `score < band` gap. The standing gap of a MANUAL_OVERRIDE above earned band
  //    (impliedRank flat == baseline) is NOT a decline → it HOLDS (surfaced, not auto-undone).
  //    A genuine new decline (impliedRank drops below the baseline) still AUTO_APPLIED-demotes a
  //    manually-set agent — override is not a safety off-switch. 1-confirm grace via subFloor;
  //    no prior baseline (first scored recompute) ⇒ no decline. PROVABLE_CORE_ARCHITECTURE.md §2A.
  const belowMode = impliedRank < modeRank;
  const freshDecline = baseline !== undefined && impliedRank < baseline;
  if (belowMode && (freshDecline || state.consecutiveSubFloor > 0)) {
    const nextSubFloor = state.consecutiveSubFloor + 1;
    if (nextSubFloor >= policy.scoreDropConfirmRecomputes) {
      const target = oneBandDown(mode);
      supersedePending();
      transitions.push(
        mk(
          target,
          'DEMOTION',
          'SCORE_CROSS',
          'AUTO_APPLIED',
          `score ${round2(readiness.readinessScore)} declined below ${mode} floor for ${nextSubFloor} consecutive recomputes`,
        ),
      );
      return { transitions, state: mkState(target, 0, 0, undefined, 0, impliedRank), effectiveMode: target };
    }
    // First sub-floor recompute of a fresh decline: no demotion yet; promotion progress resets.
    // Freeze the baseline during the grace streak so the decline is still seen next recompute.
    return { transitions, state: mkState(mode, 0, nextSubFloor, undefined, 0, baseline), effectiveMode: mode };
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
        state: mkState(mode, 0, 0, { toMode: pending.toMode, awaitingApproval: true }, 0, impliedRank),
        effectiveMode: mode,
      };
    }
    // Awaiting approval — hold; mode unchanged, no churn.
    return { transitions, state: mkState(mode, 0, 0, pending, 0, impliedRank), effectiveMode: mode };
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
        state: mkState(mode, 0, 0, { toMode: target, awaitingApproval: false }, 0, impliedRank),
        effectiveMode: mode,
      };
    }
    return { transitions, state: mkState(mode, nextReady, 0, undefined, 0, impliedRank), effectiveMode: mode };
  }

  // Score on/above band but not building promotion (or already SOLO) → reset counters; the
  // current implied rank becomes the new regression baseline.
  return { transitions, state: mkState(mode, 0, 0, undefined, 0, impliedRank), effectiveMode: mode };
}

// ─── manual override (free_set_mode) ─────────────────────────────────────────

const OVERRIDE_TARGETS: ReadonlySet<AutonomyMode> = new Set<AutonomyMode>(['SHADOW', 'CO_PILOT', 'SOLO']);

/** A valid free-set target: one of the operating bands. */
export function isOverrideTarget(mode: AutonomyMode): boolean {
  return OVERRIDE_TARGETS.has(mode);
}

/**
 * free_set_mode operates on OBSERVING/SHADOW/CO_PILOT/SOLO. SUSPENDED recovery belongs to the
 * suspend_agent follow-on (a temporary gap); RETIRED is terminal. Both are rejected.
 */
export function canOverrideFrom(mode: AutonomyMode): boolean {
  return mode === 'OBSERVING' || isOperating(mode);
}

export interface ManualOverrideInput {
  readonly ids: LifecycleIds;
  readonly state: LifecycleState;
  readonly target: AutonomyMode;
  readonly actor: string;
  readonly reason: string;
  readonly asOf: string;
}

/**
 * MANUAL_OVERRIDE (free_set_mode) — an authorized human sets effectiveMode to any operating band
 * IMMEDIATELY: no score gate, no hysteresis, no approval. First-class, immutable, audited with
 * `actor` (the human) + `reason`. The EARNED SCORE IS NEVER TOUCHED — `lastImpliedRank` (the
 * regression baseline) is preserved, so the resulting divergence is a STANDING signal that the
 * next recompute will NOT auto-undo (but a new adverse event still auto-demotes). Pure.
 */
export function manualOverride(input: ManualOverrideInput): LifecycleStepResult {
  const { ids, state, target, actor, reason, asOf } = input;
  const from = state.effectiveMode;
  if (!isOverrideTarget(target)) {
    throw new Error(`manualOverride: target must be an operating band (SHADOW|CO_PILOT|SOLO), got ${target}`);
  }
  if (!canOverrideFrom(from)) {
    throw new Error(`manualOverride: cannot free-set from ${from} (SUSPENDED recovery & RETIRED are out of scope)`);
  }
  if (actor === '') throw new Error('manualOverride: actor required');
  if (reason === '') throw new Error('manualOverride: reason required');

  const direction: TransitionDirection =
    bandRank(target) > bandRank(from)
      ? 'PROMOTION'
      : bandRank(target) < bandRank(from)
        ? 'DEMOTION'
        : 'LATERAL';

  const transition = makeTransition(
    ids,
    from,
    target,
    direction,
    'MANUAL_OVERRIDE',
    'APPLIED',
    reason,
    asOf,
    undefined, // no approver — a MANUAL_OVERRIDE is authorized by the actor
    actor,
  );

  // effectiveMode set immediately; score untouched (baseline preserved); counters reset; any
  // pending promotion is SUPERSEDED (terminal, audited) by the human's direct decision.
  const transitions: Transition[] = [];
  if (state.pendingPromotion) {
    transitions.push(
      makeTransition(
        ids,
        from,
        state.pendingPromotion.toMode,
        'PROMOTION',
        'SCORE_CROSS',
        'SUPERSEDED',
        `promotion to ${state.pendingPromotion.toMode} superseded by manual override`,
        asOf,
      ),
    );
  }
  transitions.push(transition);
  const next = mkState(target, 0, 0, undefined, 0, state.lastImpliedRank);
  return { transitions, state: next, effectiveMode: target };
}

// ─── manual kill-switch (suspend_agent) ──────────────────────────────────────

/**
 * A suspend/resume requested from a state that forbids it: suspend of an already-SUSPENDED or a
 * RETIRED (terminal) agent, or a resume of a task that is not SUSPENDED. A typed domain error so
 * the API can `instanceof`-discriminate it and map it to HTTP 409 (vs. a 400 input error / 500).
 */
export class LifecycleStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LifecycleStateError';
  }
}

export interface SuspendAgentInput {
  readonly ids: LifecycleIds;
  readonly state: LifecycleState;
  readonly actor: string;
  readonly reason: string;
  readonly asOf: string;
}

/**
 * suspend_agent (kill-switch) — an authorized human parks an agent×task at SUSPENDED IMMEDIATELY:
 * one APPLIED, immutable, audited transition stamped with `actor` (the human) + `reason`, trigger
 * SUSPEND (distinct from a free-set MANUAL_OVERRIDE and from a platform GUARDRAIL trip). Allowed
 * from OBSERVING/SHADOW/CO_PILOT/SOLO; SUSPENDED (already parked) and RETIRED (terminal) throw.
 * The earned baseline (`lastImpliedRank`) is PRESERVED — suspend does not erase score history.
 * Pure. Phase 1 is ADVISORY: this records intent; nothing gates on SUSPENDED yet (Phase 2).
 */
export function suspendAgent(input: SuspendAgentInput): LifecycleStepResult {
  const { ids, state, actor, reason, asOf } = input;
  const from = state.effectiveMode;
  if (from === 'SUSPENDED') {
    throw new LifecycleStateError('suspendAgent: already SUSPENDED');
  }
  if (from === 'RETIRED') {
    throw new LifecycleStateError('suspendAgent: cannot suspend a RETIRED (terminal) agent');
  }
  if (actor === '') throw new Error('suspendAgent: actor required');
  if (reason === '') throw new Error('suspendAgent: reason required');

  const transitions: Transition[] = [];
  // A pending promotion is SUPERSEDED (terminal, audited) by the human's direct kill — same as the
  // guardrail-trip suspend path, so the read-model never treats a stale pending as live.
  if (state.pendingPromotion) {
    transitions.push(
      makeTransition(
        ids,
        from,
        state.pendingPromotion.toMode,
        'PROMOTION',
        'SCORE_CROSS',
        'SUPERSEDED',
        `promotion to ${state.pendingPromotion.toMode} superseded by manual suspend`,
        asOf,
      ),
    );
  }
  transitions.push(
    makeTransition(
      ids,
      from,
      'SUSPENDED',
      'DEMOTION',
      'SUSPEND',
      'APPLIED',
      reason,
      asOf,
      undefined, // no approver — a manual suspend is authorized by the actor
      actor,
    ),
  );
  // Counters reset; lastImpliedRank PRESERVED (suspend does not clear the regression baseline).
  const next = mkState('SUSPENDED', 0, 0, undefined, 0, state.lastImpliedRank);
  return { transitions, state: next, effectiveMode: 'SUSPENDED' };
}

export interface ResumeAgentInput {
  readonly ids: LifecycleIds;
  readonly state: LifecycleState;
  readonly actor: string;
  readonly reason: string;
  readonly asOf: string;
}

/**
 * resume (kill-switch recovery) — ROUTE-DRIVEN ONLY (the auto-engine never self-resumes; step 5 of
 * stepLifecycle keeps SUSPENDED a hard sink). One APPLIED, audited transition SUSPENDED → OBSERVING,
 * trigger RESUME, stamped with `actor` + `reason`. The target is ALWAYS OBSERVING: the agent re-walks
 * the gated ladder from the bottom, so the "hard to climb" asymmetry holds. Decision history is NOT
 * wiped (no watermark) — readiness is recomputed from the existing window; the ladder does the gating.
 * Resetting to a clean OBSERVING slate: all counters 0, lastImpliedRank CLEARED, no pending. Pure.
 */
export function resumeAgent(input: ResumeAgentInput): LifecycleStepResult {
  const { ids, state, actor, reason, asOf } = input;
  const from = state.effectiveMode;
  if (from !== 'SUSPENDED') {
    throw new LifecycleStateError(`resumeAgent: can only resume from SUSPENDED, got ${from}`);
  }
  if (actor === '') throw new Error('resumeAgent: actor required');
  if (reason === '') throw new Error('resumeAgent: reason required');

  const transition = makeTransition(
    ids,
    'SUSPENDED',
    'OBSERVING',
    'PROMOTION',
    'RESUME',
    'APPLIED',
    reason,
    asOf,
    undefined, // no approver — a manual resume is authorized by the actor
    actor,
  );
  // Clean OBSERVING slate: counters 0, lastImpliedRank CLEARED (omitted), no pending. The agent
  // must re-earn every band through the gated ladder.
  const next = mkState('OBSERVING', 0, 0, undefined, 0, undefined);
  return { transitions: [transition], state: next, effectiveMode: 'OBSERVING' };
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
