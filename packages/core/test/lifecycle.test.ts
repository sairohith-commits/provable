import { describe, expect, it } from 'vitest';
import type {
  AgentKey,
  Decision,
  DecisionId,
  OrgId,
  TaskKey,
  Transition,
} from '@provable/contracts';
import {
  DEFAULT_GOVERNANCE_POLICY,
  INITIAL_LIFECYCLE_STATE,
  computeReadiness,
  impliedBandForScore,
  runLifecycle,
  stepLifecycle,
} from '../src/index.js';
import type {
  ComponentKey,
  InsufficientReadiness,
  LifecycleIds,
  LifecycleState,
  ScoredReadiness,
} from '../src/index.js';

const ids: LifecycleIds = {
  orgId: 'org_1' as OrgId,
  agentKey: 'agent_1' as AgentKey,
  taskKey: 'classify' as TaskKey,
};
const ASOF = '2026-06-15T00:00:00.000Z';
const policy = DEFAULT_GOVERNANCE_POLICY;

const range = <T>(n: number, fn: () => T): T[] => Array.from({ length: n }, fn);

function rr(score: number, resolved = 50): ScoredReadiness {
  return {
    status: 'SCORED',
    readinessScore: score,
    components: { accuracyRate: 0, confidenceAvg: 0, overrideRate: 0, escalationRate: 0 },
    impliedBand: impliedBandForScore(score),
    eventCount: resolved,
    resolvedCount: resolved,
  };
}

function insufficient(resolved = 50, missing: ComponentKey[] = ['confidenceAvg']): InsufficientReadiness {
  return { status: 'INSUFFICIENT', missing, eventCount: resolved, resolvedCount: resolved };
}

const operating = (mode: LifecycleState['effectiveMode']): LifecycleState => ({
  effectiveMode: mode,
  consecutivePromotionReady: 0,
  consecutiveSubFloor: 0,
});

describe('OBSERVING → SHADOW gating', () => {
  it('stays OBSERVING below the resolved threshold even at score 95', () => {
    const r = stepLifecycle({
      ids,
      state: INITIAL_LIFECYCLE_STATE,
      readiness: rr(95, 9),
      policy,
      asOf: ASOF,
    });
    expect(r.effectiveMode).toBe('OBSERVING');
    expect(r.transitions).toHaveLength(0);
  });

  it('exits to SHADOW (never SOLO) once ≥10 resolved verdicts accrue', () => {
    const r = stepLifecycle({
      ids,
      state: INITIAL_LIFECYCLE_STATE,
      readiness: rr(95, 10),
      policy,
      asOf: ASOF,
    });
    expect(r.effectiveMode).toBe('SHADOW');
    expect(r.transitions).toHaveLength(1);
    expect(r.transitions[0]?.fromMode).toBe('OBSERVING');
    expect(r.transitions[0]?.toMode).toBe('SHADOW');
    expect(r.transitions[0]?.status).toBe('AUTO_APPLIED');
  });

  it('stays OBSERVING when 10 resolved decisions are INSUFFICIENT (no confidence)', () => {
    const r = stepLifecycle({
      ids,
      state: INITIAL_LIFECYCLE_STATE,
      readiness: insufficient(12, ['confidenceAvg']),
      policy,
      asOf: ASOF,
    });
    expect(r.effectiveMode).toBe('OBSERVING');
    expect(r.transitions).toHaveLength(0);
  });
});

describe('WITHHOLD (Q3) — adversarial: no confidence, no autonomy', () => {
  let seq = 0;
  const mkDec = (outcome?: 'SUCCESS'): Decision => {
    seq += 1;
    const base: Decision = {
      id: `w_${seq}` as DecisionId,
      orgId: 'org_1' as OrgId,
      agentKey: 'agent_1' as AgentKey,
      taskKey: 'classify' as TaskKey,
      at: '2026-06-10T12:00:00.000Z',
      action: null,
      verdict: { kind: 'ACCEPTED' },
      source: 'sdk',
    };
    return outcome === undefined ? base : { ...base, outcome };
  };

  it('end-to-end: a real confidence-less window → INSUFFICIENT → task stays OBSERVING', () => {
    // 12 resolved, outcome-bearing decisions, but the agent never reports confidence.
    const decisions = range(12, () => mkDec('SUCCESS'));
    const readiness = computeReadiness(decisions, ASOF);

    expect(readiness.status).toBe('INSUFFICIENT');
    expect(readiness.resolvedCount).toBe(12); // plenty of events…
    if (readiness.status === 'INSUFFICIENT') expect(readiness.missing).toContain('confidenceAvg');

    const r = stepLifecycle({ ids, state: INITIAL_LIFECYCLE_STATE, readiness, policy, asOf: ASOF });
    expect(r.effectiveMode).toBe('OBSERVING'); // …but no score → no autonomy
    expect(r.transitions).toHaveLength(0);
  });

  it('an already-operating task receiving INSUFFICIENT makes no score-driven transition', () => {
    const r = stepLifecycle({
      ids,
      state: operating('CO_PILOT'),
      readiness: insufficient(50, ['accuracyRate']),
      policy,
      asOf: ASOF,
    });
    expect(r.effectiveMode).toBe('CO_PILOT');
    expect(r.transitions).toHaveLength(0);
  });
});

describe('Promotion is gated — hysteresis + approval, never auto', () => {
  it('blocks until 3-recompute hysteresis, then PROPOSED → PENDING_APPROVAL, then APPLIED only on approval', () => {
    // Six high-score recomputes WITHOUT approval.
    const beforeApproval = runLifecycle(
      ids,
      operating('SHADOW'),
      range(6, () => ({ readiness: rr(80), asOf: ASOF })),
      policy,
    );

    const promoStatuses = beforeApproval.transitions
      .filter((t) => t.direction === 'PROMOTION')
      .map((t) => t.status);

    // Hysteresis (3) → PROPOSED on recompute 3, PENDING_APPROVAL on recompute 4, then holds.
    expect(promoStatuses).toEqual(['PROPOSED', 'PENDING_APPROVAL']);
    // A high score WITHOUT approval does NOT move effectiveMode.
    expect(beforeApproval.state.effectiveMode).toBe('SHADOW');
    // And it never auto-applies a promotion.
    expect(beforeApproval.transitions.some((t) => t.status === 'APPLIED')).toBe(false);

    // Now a human approves.
    const approved = stepLifecycle({
      ids,
      state: beforeApproval.state,
      readiness: rr(80),
      signals: { manual: { kind: 'APPROVE', approver: 'alice', at: ASOF } },
      policy,
      asOf: ASOF,
    });

    expect(approved.effectiveMode).toBe('CO_PILOT');
    const applied = approved.transitions[0] as Transition;
    expect(applied.status).toBe('APPLIED');
    expect(applied.direction).toBe('PROMOTION');
    expect(applied.toMode).toBe('CO_PILOT');
    expect(applied.approver).toBe('alice');
  });

  it('only advances one band per promotion (SHADOW→CO_PILOT, not straight to SOLO)', () => {
    const beforeApproval = runLifecycle(
      ids,
      operating('SHADOW'),
      range(4, () => ({ readiness: rr(95), asOf: ASOF })), // SOLO-implied
      policy,
    );
    const approved = stepLifecycle({
      ids,
      state: beforeApproval.state,
      readiness: rr(95),
      signals: { manual: { kind: 'APPROVE', approver: 'alice', at: ASOF } },
      policy,
      asOf: ASOF,
    });
    expect(approved.effectiveMode).toBe('CO_PILOT'); // one band, despite SOLO-implied score
  });
});

describe('Demotion is automatic — easy to fall, no approver', () => {
  it('guardrail trip → instant AUTO_APPLIED suspension', () => {
    const r = stepLifecycle({
      ids,
      state: operating('SOLO'),
      readiness: rr(90),
      signals: { guardrail: { guardrailId: 'g-1', trippedAt: ASOF, reason: 'pii leak' } },
      policy,
      asOf: ASOF,
    });
    expect(r.effectiveMode).toBe('SUSPENDED');
    const t = r.transitions[0] as Transition;
    expect(t.status).toBe('AUTO_APPLIED');
    expect(t.direction).toBe('DEMOTION');
    expect(t.trigger).toBe('GUARDRAIL');
    expect(t.approver).toBeUndefined();
  });

  it('drift signal → instant AUTO_APPLIED one-band demotion', () => {
    const r = stepLifecycle({
      ids,
      state: operating('SOLO'),
      readiness: rr(90),
      signals: { drift: { detectedAt: ASOF, reason: 'baseline deviation' } },
      policy,
      asOf: ASOF,
    });
    expect(r.effectiveMode).toBe('CO_PILOT');
    const t = r.transitions[0] as Transition;
    expect(t.status).toBe('AUTO_APPLIED');
    expect(t.trigger).toBe('DRIFT');
    expect(t.approver).toBeUndefined();
  });

  it('score-drop demotes on the 2nd consecutive sub-floor recompute (1-confirm)', () => {
    const step1 = stepLifecycle({ ids, state: operating('SOLO'), readiness: rr(60), policy, asOf: ASOF });
    expect(step1.effectiveMode).toBe('SOLO'); // first sub-floor — grace
    expect(step1.transitions).toHaveLength(0);

    const step2 = stepLifecycle({ ids, state: step1.state, readiness: rr(60), policy, asOf: ASOF });
    expect(step2.effectiveMode).toBe('CO_PILOT');
    const t = step2.transitions[0] as Transition;
    expect(t.status).toBe('AUTO_APPLIED');
    expect(t.trigger).toBe('SCORE_CROSS');
    expect(t.direction).toBe('DEMOTION');
    expect(t.approver).toBeUndefined();
  });
});

describe('The asymmetry, asserted directly', () => {
  it('promotion-applied carries an approver; every auto-demotion carries none', () => {
    // Promotion (approved)
    const proposed = runLifecycle(
      ids,
      operating('SHADOW'),
      range(4, () => ({ readiness: rr(80), asOf: ASOF })),
      policy,
    );
    const applied = stepLifecycle({
      ids,
      state: proposed.state,
      readiness: rr(80),
      signals: { manual: { kind: 'APPROVE', approver: 'alice', at: ASOF } },
      policy,
      asOf: ASOF,
    }).transitions.find((t) => t.status === 'APPLIED') as Transition;
    expect(applied.direction).toBe('PROMOTION');
    expect(applied.approver).toBe('alice');

    // Demotions
    const guardrail = stepLifecycle({
      ids,
      state: operating('SOLO'),
      readiness: rr(90),
      signals: { guardrail: { guardrailId: 'g', trippedAt: ASOF, reason: 'x' } },
      policy,
      asOf: ASOF,
    }).transitions[0] as Transition;
    expect(guardrail.status).toBe('AUTO_APPLIED');
    expect(guardrail.approver).toBeUndefined();
  });
});
