import { describe, expect, it } from 'vitest';
import type {
  AgentKey,
  Decision,
  DecisionId,
  OrgId,
  Outcome,
  TaskKey,
  Verdict,
} from '@provable/contracts';
import { computeReadiness, impliedBandForScore } from '../src/index.js';

let seq = 0;
function mkDec(opts: {
  verdict: Verdict;
  outcome?: Outcome;
  confidence?: number;
  at?: string;
}): Decision {
  seq += 1;
  const base: Decision = {
    id: `d_${seq}` as DecisionId,
    orgId: 'org_1' as OrgId,
    agentKey: 'agent_1' as AgentKey,
    taskKey: 'classify' as TaskKey,
    at: opts.at ?? '2026-06-10T12:00:00.000Z',
    action: null,
    verdict: opts.verdict,
    source: 'sdk',
  };
  const withOutcome = opts.outcome === undefined ? base : { ...base, outcome: opts.outcome };
  return opts.confidence === undefined ? withOutcome : { ...withOutcome, confidence: opts.confidence };
}

const range = <T>(n: number, fn: () => T): T[] => Array.from({ length: n }, fn);

const ASOF = '2026-06-15T00:00:00.000Z';

describe('computeReadiness — pinned score (rates over the resolved set)', () => {
  it('produces the exact re-pinned score; escalation uses |R|, not total-in-window', () => {
    // Resolved R (15): 4 ACCEPTED+SUCCESS, 4 FAILED, 4 OVERRIDDEN, 3 ESCALATED — all conf 0.8.
    // Plus 5 PENDING (conf 0.1, no outcome) that must be excluded from EVERY rate.
    //   accuracy denom = ACCEPTED(4)+FAILED(4)+OVERRIDDEN(4)=12 (ESCALATED excluded);
    //   credit = 4 (only the ACCEPTED+SUCCESS) → accuracy = 4/12 = 0.3333
    //     (OVERRIDDEN now counts as a failure, 0 — readiness = solo-quality)
    //   confidence = 0.8 ; override = 4/8 = 0.5 ; escalation = 3/15 = 0.2
    //   score = (0.3333*0.40 + 0.8*0.25 + 0.5*0.20 + 0.8*0.15)*100 = 55.33
    const decisions: Decision[] = [
      ...range(4, () => mkDec({ verdict: { kind: 'ACCEPTED' }, outcome: 'SUCCESS', confidence: 0.8 })),
      ...range(4, () => mkDec({ verdict: { kind: 'FAILED' }, confidence: 0.8 })),
      ...range(4, () => mkDec({ verdict: { kind: 'OVERRIDDEN' }, confidence: 0.8 })),
      ...range(3, () => mkDec({ verdict: { kind: 'ESCALATED' }, confidence: 0.8 })),
      ...range(5, () => mkDec({ verdict: { kind: 'PENDING' }, confidence: 0.1 })),
    ];

    const r = computeReadiness(decisions, ASOF);
    expect(r.status).toBe('SCORED');
    if (r.status !== 'SCORED') return;

    expect(r.readinessScore).toBeCloseTo(55.3333, 3);
    expect(r.impliedBand).toBe('CO_PILOT');
    expect(r.eventCount).toBe(20);
    expect(r.resolvedCount).toBe(15);
    expect(r.components.accuracyRate).toBeCloseTo(1 / 3, 9); // 4/12 — OVERRIDDEN counts as 0
    expect(r.components.confidenceAvg).toBeCloseTo(0.8, 9); // PENDING conf 0.1 excluded
    expect(r.components.overrideRate).toBeCloseTo(0.5, 9);
    expect(r.components.escalationRate).toBeCloseTo(0.2, 9); // 3/15, NOT 3/20
  });

  it('ADVERSARIAL: rescued OVERRIDDEN no longer inflates readiness', () => {
    // A window of OVERRIDDEN decisions whose outcomes were SUCCESS (a human caught each).
    // OLD mapping (outcome wins): accuracy 1.0, override 1.0 → score ≈ 77.5 (SOLO).
    // NEW mapping (override = failure): accuracy 0.0 → score ≈ 37.5 (SHADOW).
    const decisions = range(10, () =>
      mkDec({ verdict: { kind: 'OVERRIDDEN' }, outcome: 'SUCCESS', confidence: 0.9 }),
    );
    const r = computeReadiness(decisions, ASOF);
    expect(r.status).toBe('SCORED');
    if (r.status !== 'SCORED') return;
    expect(r.components.accuracyRate).toBe(0); // every call was overridden → all wrong
    expect(r.readinessScore).toBeLessThan(40); // SHADOW, not the old ~77.5 SOLO
    expect(r.impliedBand).toBe('SHADOW');
  });
});

describe('computeReadiness — WITHHOLD on incomplete signal (Q3)', () => {
  it('no confidence anywhere → INSUFFICIENT (the "no confidence, no autonomy" rule)', () => {
    const decisions = range(12, () => mkDec({ verdict: { kind: 'ACCEPTED' }, outcome: 'SUCCESS' }));
    const r = computeReadiness(decisions, ASOF);
    expect(r.status).toBe('INSUFFICIENT');
    if (r.status === 'INSUFFICIENT') {
      expect(r.missing).toContain('confidenceAvg');
      expect(r.resolvedCount).toBe(12);
    }
  });

  it('no outcome-bearing resolved decision → INSUFFICIENT (accuracy absent)', () => {
    // ACCEPTED verdicts WITH confidence but NO outcomes.
    const decisions = range(12, () => mkDec({ verdict: { kind: 'ACCEPTED' }, confidence: 0.9 }));
    const r = computeReadiness(decisions, ASOF);
    expect(r.status).toBe('INSUFFICIENT');
    if (r.status === 'INSUFFICIENT') expect(r.missing).toContain('accuracyRate');
  });

  it('empty override channel (only ESCALATED/FAILED) → INSUFFICIENT, not a high score', () => {
    // Adversarial: no ACCEPTED and no OVERRIDDEN. The old 0/0 → 0 gave full (1−override)
    // credit — a misleadingly high score. Now the override source is absent → WITHHOLD.
    const decisions = [
      ...range(6, () => mkDec({ verdict: { kind: 'ESCALATED' }, confidence: 0.9 })),
      ...range(6, () => mkDec({ verdict: { kind: 'FAILED' }, outcome: 'FAILURE', confidence: 0.9 })),
    ];
    const r = computeReadiness(decisions, ASOF);
    expect(r.status).toBe('INSUFFICIENT');
    if (r.status === 'INSUFFICIENT') expect(r.missing).toContain('overrideRate');
  });

  it('|R| = 0 (all PENDING) → INSUFFICIENT, every component missing', () => {
    const decisions = range(12, () => mkDec({ verdict: { kind: 'PENDING' }, confidence: 0.9 }));
    const r = computeReadiness(decisions, ASOF);
    expect(r.status).toBe('INSUFFICIENT');
    if (r.status === 'INSUFFICIENT') {
      expect(r.resolvedCount).toBe(0);
      expect(r.missing).toEqual(['accuracyRate', 'confidenceAvg', 'overrideRate', 'escalationRate']);
    }
  });
});

describe('computeReadiness — 30-day window via asOf', () => {
  it('includes the exact lower bound and asOf, excludes just outside', () => {
    const mk = (at: string) =>
      mkDec({ verdict: { kind: 'ACCEPTED' }, outcome: 'SUCCESS', confidence: 0.9, at });
    const decisions: Decision[] = [
      mk('2026-05-16T00:00:00.000Z'), // == asOf-30d, in
      mk('2026-05-15T23:59:59.999Z'), // 1ms before, out
      mk(ASOF), // == asOf, in
      mk('2026-06-15T00:00:00.001Z'), // after asOf, out
    ];
    const r = computeReadiness(decisions, ASOF);
    expect(r.eventCount).toBe(2);
    expect(r.resolvedCount).toBe(2);
  });
});

describe('impliedBandForScore — locked thresholds', () => {
  it('maps ≤40 Shadow, 41–70 Co-Pilot, 71–100 Solo', () => {
    expect(impliedBandForScore(0)).toBe('SHADOW');
    expect(impliedBandForScore(40)).toBe('SHADOW');
    expect(impliedBandForScore(40.1)).toBe('CO_PILOT');
    expect(impliedBandForScore(70)).toBe('CO_PILOT');
    expect(impliedBandForScore(70.1)).toBe('SOLO');
    expect(impliedBandForScore(100)).toBe('SOLO');
  });
});
