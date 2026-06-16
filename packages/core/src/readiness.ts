import type { Decision } from '@provable/contracts';

/**
 * Readiness engine — PURE and deterministic (PROVABLE_CORE_ARCHITECTURE.md §1/§2).
 *
 * No clock, no randomness, no I/O. The 30-day window is evaluated relative to a
 * passed-in `asOf`; nothing reads the wall clock.
 *
 * Phase-2 governance decisions applied:
 *   Q1 — every rate is computed over the RESOLVED set R (window, verdict ≠ PENDING).
 *        Only escalation's denominator actually moved (total → |R|); override and
 *        accuracy were already resolved-based. (Doc edit: §2 escalation clause.)
 *   Q3 — WITHHOLD instead of renormalize: if any signal's source data is absent,
 *        no number is emitted — the result is INSUFFICIENT (the doc's "degrades
 *        gracefully", §5: "can only be Observed, never Scored").
 */

// ─── LOCKED constants (source: PROVABLE_CORE_ARCHITECTURE.md §2) ──────────────
/** locked — source: PROVABLE_CORE_ARCHITECTURE.md §2 */
export const READINESS_WEIGHTS = {
  accuracy: 0.4,
  confidence: 0.25,
  override: 0.2,
  escalation: 0.15,
} as const;

/** locked — source: PROVABLE_CORE_ARCHITECTURE.md §2 (band ≤40 Shadow | 41–70 Co-Pilot | 71–100 Solo) */
export const BAND_THRESHOLDS = {
  shadowMax: 40,
  coPilotMax: 70,
} as const;

/** locked — source: PROVABLE_CORE_ARCHITECTURE.md §2 (rolling 30 days) */
export const READINESS_WINDOW_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ─── Result types ────────────────────────────────────────────────────────────

/** The score-implied band — informational only; NOT the effectiveMode (§2A). */
export type ScoreImpliedBand = 'SHADOW' | 'CO_PILOT' | 'SOLO';

export type ComponentKey = 'accuracyRate' | 'confidenceAvg' | 'overrideRate' | 'escalationRate';

/** The four formula inputs (all present — a SCORED result implies every signal exists). */
export interface ReadinessComponents {
  readonly accuracyRate: number;
  readonly confidenceAvg: number;
  readonly overrideRate: number;
  readonly escalationRate: number;
}

export interface ScoredReadiness {
  readonly status: 'SCORED';
  readonly readinessScore: number; // 0–100
  readonly components: ReadinessComponents;
  readonly impliedBand: ScoreImpliedBand;
  readonly eventCount: number; // total decisions in the window
  readonly resolvedCount: number; // |R| — non-PENDING decisions in the window
}

export interface InsufficientReadiness {
  readonly status: 'INSUFFICIENT';
  readonly missing: readonly ComponentKey[];
  readonly eventCount: number;
  readonly resolvedCount: number;
}

/** WITHHOLD model: either a real score, or an explicit unscored result (Q3). */
export type ReadinessResult = ScoredReadiness | InsufficientReadiness;

// ─── Band mapping ────────────────────────────────────────────────────────────

export function impliedBandForScore(score: number): ScoreImpliedBand {
  if (score <= BAND_THRESHOLDS.shadowMax) return 'SHADOW';
  if (score <= BAND_THRESHOLDS.coPilotMax) return 'CO_PILOT';
  return 'SOLO';
}

// ─── Derivation (all over the resolved set R) ────────────────────────────────

function inWindow(at: string, asOfMs: number, lowerMs: number): boolean {
  const t = Date.parse(at); // parsing an explicit string is deterministic — no clock
  return !Number.isNaN(t) && t >= lowerMs && t <= asOfMs;
}

/**
 * accuracyRate (§2): readiness = SOLO-quality, so an OVERRIDDEN decision counts as a
 * FAILURE (the agent's own call was wrong; a human had to correct it).
 *
 *   - OVERRIDDEN → 0 credit, INCLUDED in the denominator, REGARDLESS of outcome (a
 *     rescued outcome does not redeem a call that would have shipped wrong in Solo).
 *   - ESCALATED → EXCLUDED from accuracy (knowing your limits ≠ being wrong).
 *   - Otherwise OUTCOME wins when present: SUCCESS → 1, PARTIAL → 0.5, FAILURE → 0.
 *   - With no outcome: ACCEPTED → 1, FAILED → 0.
 *
 * (The override ALSO bites the separate (1−override) supervision-burden term — an override
 * is two distinct costs: a wrong call and a human rescue. Weights/thresholds unchanged.)
 */
function deriveAccuracy(resolved: readonly Decision[]): number {
  let credit = 0;
  let denom = 0;
  for (const d of resolved) {
    if (d.verdict.kind === 'OVERRIDDEN') {
      denom += 1; // counts as a failure (credit += 0) regardless of outcome
      continue;
    }
    if (d.verdict.kind === 'ESCALATED') {
      continue; // excluded — escalation is its own rate
    }
    if (d.outcome !== undefined) {
      denom += 1;
      if (d.outcome === 'SUCCESS') credit += 1;
      else if (d.outcome === 'PARTIAL') credit += 0.5;
      continue;
    }
    if (d.verdict.kind === 'ACCEPTED') {
      denom += 1;
      credit += 1;
    } else if (d.verdict.kind === 'FAILED') {
      denom += 1;
    }
  }
  return denom === 0 ? 0 : credit / denom;
}

function deriveConfidence(resolved: readonly Decision[]): number {
  let sum = 0;
  let n = 0;
  for (const d of resolved) {
    if (d.confidence !== undefined) {
      sum += d.confidence;
      n += 1;
    }
  }
  return n === 0 ? 0 : sum / n;
}

/**
 * overrideRate (§2) = OVERRIDDEN / (OVERRIDDEN + ACCEPTED).
 *
 * The empty-channel case (no ACCEPTED and no OVERRIDDEN) is handled upstream as WITHHOLD:
 * computeReadiness returns INSUFFICIENT (override absent) rather than crediting a 0/0 → 0.
 * So `engaged` is always ≥ 1 here. (Consistent with the Q3 withhold model.)
 */
function deriveOverride(resolved: readonly Decision[]): number {
  let overridden = 0;
  let engaged = 0;
  for (const d of resolved) {
    if (d.verdict.kind === 'OVERRIDDEN') {
      overridden += 1;
      engaged += 1;
    } else if (d.verdict.kind === 'ACCEPTED') {
      engaged += 1;
    }
  }
  return engaged === 0 ? 0 : overridden / engaged;
}

/** escalationRate (§2, Q1) = ESCALATED / |R| (resolved decisions in window). */
function deriveEscalation(resolved: readonly Decision[]): number {
  if (resolved.length === 0) return 0;
  let escalated = 0;
  for (const d of resolved) {
    if (d.verdict.kind === 'ESCALATED') escalated += 1;
  }
  return escalated / resolved.length;
}

/**
 * Compute readiness over a 30-day window ending at `asOf`.
 *
 * Returns INSUFFICIENT (no score) when a signal's source data is absent:
 *   - |R| = 0, OR
 *   - no OUTCOME-bearing resolved decision (accuracy absent), OR
 *   - no resolved decision reported confidence (confidence absent), OR
 *   - no ACCEPTED and no OVERRIDDEN resolved decision (override channel empty).
 * (Escalation always exists once |R| ≥ 1.)
 */
export function computeReadiness(decisions: readonly Decision[], asOf: string): ReadinessResult {
  const asOfMs = Date.parse(asOf);
  if (Number.isNaN(asOfMs)) {
    throw new Error(`computeReadiness: asOf is not a valid ISO timestamp: ${asOf}`);
  }
  const lowerMs = asOfMs - READINESS_WINDOW_DAYS * MS_PER_DAY;

  const windowed = decisions.filter((d) => inWindow(d.at, asOfMs, lowerMs));
  const resolved = windowed.filter((d) => d.verdict.kind !== 'PENDING');
  const eventCount = windowed.length;
  const resolvedCount = resolved.length;

  if (resolvedCount === 0) {
    return {
      status: 'INSUFFICIENT',
      missing: ['accuracyRate', 'confidenceAvg', 'overrideRate', 'escalationRate'],
      eventCount,
      resolvedCount,
    };
  }

  const missing: ComponentKey[] = [];
  const hasOutcome = resolved.some((d) => d.outcome !== undefined);
  const hasConfidence = resolved.some((d) => d.confidence !== undefined);
  const hasOverrideChannel = resolved.some(
    (d) => d.verdict.kind === 'ACCEPTED' || d.verdict.kind === 'OVERRIDDEN',
  );
  if (!hasOutcome) missing.push('accuracyRate');
  if (!hasConfidence) missing.push('confidenceAvg');
  if (!hasOverrideChannel) missing.push('overrideRate');

  if (missing.length > 0) {
    return { status: 'INSUFFICIENT', missing, eventCount, resolvedCount };
  }

  const accuracyRate = deriveAccuracy(resolved);
  const confidenceAvg = deriveConfidence(resolved);
  const overrideRate = deriveOverride(resolved);
  const escalationRate = deriveEscalation(resolved);

  const readinessScore =
    (accuracyRate * READINESS_WEIGHTS.accuracy +
      confidenceAvg * READINESS_WEIGHTS.confidence +
      (1 - overrideRate) * READINESS_WEIGHTS.override +
      (1 - escalationRate) * READINESS_WEIGHTS.escalation) *
    100;

  return {
    status: 'SCORED',
    readinessScore,
    components: { accuracyRate, confidenceAvg, overrideRate, escalationRate },
    impliedBand: impliedBandForScore(readinessScore),
    eventCount,
    resolvedCount,
  };
}
