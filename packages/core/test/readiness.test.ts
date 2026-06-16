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
    //   accuracy = 4/8 = 0.5 ; confidence = 0.8 ; override = 4/8 = 0.5
    //   escalation = 3/|R| = 3/15 = 0.2   (over total-20 it would be 0.15)
    //   score = (0.5*0.40 + 0.8*0.25 + 0.5*0.20 + 0.8*0.15)*100 = 62
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

    expect(r.readinessScore).toBeCloseTo(62, 9);
    expect(r.impliedBand).toBe('CO_PILOT');
    expect(r.eventCount).toBe(20);
    expect(r.resolvedCount).toBe(15);
    expect(r.components.accuracyRate).toBeCloseTo(0.5, 9);
    expect(r.components.confidenceAvg).toBeCloseTo(0.8, 9); // PENDING conf 0.1 excluded
    expect(r.components.overrideRate).toBeCloseTo(0.5, 9);
    expect(r.components.escalationRate).toBeCloseTo(0.2, 9); // 3/15, NOT 3/20
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
