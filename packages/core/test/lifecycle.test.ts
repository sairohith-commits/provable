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
  manualOverride,
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
  consecutiveInsufficient: 0,
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

describe('Signal-loss demotion (grace window) — easy to fall, no approval', () => {
  it('1 INSUFFICIENT is within grace → no demotion, counter increments', () => {
    const r = stepLifecycle({ ids, state: operating('SOLO'), readiness: insufficient(), policy, asOf: ASOF });
    expect(r.effectiveMode).toBe('SOLO');
    expect(r.transitions).toHaveLength(0);
    expect(r.state.consecutiveInsufficient).toBe(1);
  });

  it('2nd consecutive INSUFFICIENT → AUTO_APPLIED demotion one band, counter reset', () => {
    const run = runLifecycle(
      ids,
      operating('CO_PILOT'),
      [
        { readiness: insufficient(), asOf: ASOF },
        { readiness: insufficient(), asOf: ASOF },
      ],
      policy,
    );
    const demotion = run.transitions.find((t) => t.direction === 'DEMOTION');
    expect(demotion).toBeDefined();
    expect(demotion?.status).toBe('AUTO_APPLIED');
    expect(demotion?.trigger).toBe('SIGNAL_LOSS'); // ratified dedicated trigger (distinct from DRIFT)
    expect(demotion?.toMode).toBe('SHADOW'); // one band down from CO_PILOT
    expect(demotion?.approver).toBeUndefined(); // asymmetry: auto-demotion needs no approver
    expect(run.state.effectiveMode).toBe('SHADOW');
    expect(run.state.consecutiveInsufficient).toBe(0);
    // Adversarial: signal-loss must NOT masquerade as performance drift (Legal distinguishes them).
    expect(demotion?.trigger).not.toBe('DRIFT');
  });

  it('a SCORED recompute mid-grace resets the counter', () => {
    const a = stepLifecycle({ ids, state: operating('CO_PILOT'), readiness: insufficient(), policy, asOf: ASOF });
    expect(a.state.consecutiveInsufficient).toBe(1);
    const b = stepLifecycle({ ids, state: a.state, readiness: rr(85), policy, asOf: ASOF });
    expect(b.state.consecutiveInsufficient).toBe(0); // signal returned → reset
    const c = stepLifecycle({ ids, state: b.state, readiness: insufficient(), policy, asOf: ASOF });
    expect(c.effectiveMode).toBe('CO_PILOT'); // count is 1 again, not 2 → no demotion
    expect(c.transitions).toHaveLength(0);
  });

  it('SHADOW INSUFFICIENT is unaffected (nothing to demote)', () => {
    const r = stepLifecycle({ ids, state: operating('SHADOW'), readiness: insufficient(), policy, asOf: ASOF });
    expect(r.effectiveMode).toBe('SHADOW');
    expect(r.transitions).toHaveLength(0);
  });

  it('OBSERVING INSUFFICIENT is unaffected (stays OBSERVING)', () => {
    const r = stepLifecycle({ ids, state: INITIAL_LIFECYCLE_STATE, readiness: insufficient(5), policy, asOf: ASOF });
    expect(r.effectiveMode).toBe('OBSERVING');
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

  it('score-drop demotes on the 2nd consecutive sub-floor recompute after a FRESH decline (1-confirm)', () => {
    // Regression semantics: establish a SOLO-implied baseline first, then a real decline. (A
    // below-mode score with NO prior baseline is a standing gap that holds — covered separately.)
    const seed = stepLifecycle({ ids, state: operating('SOLO'), readiness: rr(90), policy, asOf: ASOF });
    expect(seed.effectiveMode).toBe('SOLO');

    const step1 = stepLifecycle({ ids, state: seed.state, readiness: rr(60), policy, asOf: ASOF });
    expect(step1.effectiveMode).toBe('SOLO'); // first sub-floor of the fresh decline — grace
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

describe('MANUAL_OVERRIDE (free_set_mode) — first-class, audited, score untouched', () => {
  // earned CO_PILOT (baseline rank 2) — a manual SOLO override is ABOVE earned.
  const earnedCoPilot = { ...operating('CO_PILOT'), lastImpliedRank: 2 };

  it('sets any mode immediately with an audited actor + reason; no approver; score untouched', () => {
    const r = manualOverride({ ids, state: earnedCoPilot, target: 'SOLO', actor: 'alice', reason: 'launch', asOf: ASOF });
    expect(r.effectiveMode).toBe('SOLO');
    const t = r.transitions[0] as Transition;
    expect(t.trigger).toBe('MANUAL_OVERRIDE');
    expect(t.status).toBe('APPLIED');
    expect(t.direction).toBe('PROMOTION'); // SOLO above CO_PILOT
    expect(t.actor).toBe('alice');
    expect(t.approver).toBeUndefined(); // actor, NOT approver
    expect(t.reason).toBe('launch');
    expect(r.state.lastImpliedRank).toBe(2); // earned baseline preserved (score untouched)
  });

  it('requires an actor and a reason; rejects SUSPENDED/RETIRED and non-operating targets', () => {
    expect(() => manualOverride({ ids, state: earnedCoPilot, target: 'SOLO', actor: '', reason: 'x', asOf: ASOF })).toThrow(/actor/i);
    expect(() => manualOverride({ ids, state: earnedCoPilot, target: 'SOLO', actor: 'a', reason: '', asOf: ASOF })).toThrow(/reason/i);
    expect(() => manualOverride({ ids, state: { ...operating('SUSPENDED') }, target: 'SOLO', actor: 'a', reason: 'r', asOf: ASOF })).toThrow(/SUSPENDED/i);
    expect(() => manualOverride({ ids, state: { ...operating('RETIRED') }, target: 'SOLO', actor: 'a', reason: 'r', asOf: ASOF })).toThrow();
    expect(() => manualOverride({ ids, state: earnedCoPilot, target: 'OBSERVING', actor: 'a', reason: 'r', asOf: ASOF })).toThrow(/operating band/i);
  });

  describe('the crux — standing divergence holds; a new adverse event still demotes', () => {
    const overridden = manualOverride({ ids, state: earnedCoPilot, target: 'SOLO', actor: 'alice', reason: 'launch', asOf: ASOF }).state;

    it('HOLDS under the standing gap: flat earned (CO_PILOT) score never auto-undoes the SOLO override', () => {
      // Three recomputes at the earned CO_PILOT level (below the SOLO mode) — NOT a decline.
      const run = runLifecycle(ids, overridden, range(3, () => ({ readiness: rr(60), asOf: ASOF })), policy);
      expect(run.state.effectiveMode).toBe('SOLO'); // standing divergence, not corrected
      expect(run.transitions.filter((t) => t.direction === 'DEMOTION')).toHaveLength(0);
    });

    it('STILL auto-demotes on a FRESH score decline (earned score drops a band)', () => {
      // Earned score declines from CO_PILOT (2) to SHADOW (1) — a real regression below baseline.
      const s1 = stepLifecycle({ ids, state: overridden, readiness: rr(30), policy, asOf: ASOF });
      expect(s1.effectiveMode).toBe('SOLO'); // 1-confirm grace
      const s2 = stepLifecycle({ ids, state: s1.state, readiness: rr(30), policy, asOf: ASOF });
      expect(s2.effectiveMode).toBe('CO_PILOT'); // auto-demoted despite being manually set
      expect((s2.transitions[0] as Transition).status).toBe('AUTO_APPLIED');
      expect((s2.transitions[0] as Transition).trigger).toBe('SCORE_CROSS');
    });

    it('STILL auto-demotes on a guardrail trip (override is not a safety off-switch)', () => {
      const r = stepLifecycle({
        ids,
        state: overridden,
        readiness: rr(60),
        signals: { guardrail: { guardrailId: 'g1', trippedAt: ASOF, reason: 'pii' } },
        policy,
        asOf: ASOF,
      });
      expect(r.effectiveMode).toBe('SUSPENDED');
      expect((r.transitions[0] as Transition).trigger).toBe('GUARDRAIL');
    });
  });

  it('standing-gap-from-the-start: an override whose FIRST scored data is below-mode HOLDS; only a SUBSEQUENT decline demotes', () => {
    // No prior baseline (lastImpliedRank undefined) — the first below-mode score is NOT a decline.
    const fresh = manualOverride({ ids, state: operating('OBSERVING'), target: 'SOLO', actor: 'alice', reason: 'trial', asOf: ASOF }).state;
    expect(fresh.lastImpliedRank).toBeUndefined();

    const a = stepLifecycle({ ids, state: fresh, readiness: rr(60), policy, asOf: ASOF }); // CO_PILOT-implied, below SOLO
    expect(a.effectiveMode).toBe('SOLO'); // no prior baseline ⇒ no decline ⇒ holds
    const b = stepLifecycle({ ids, state: a.state, readiness: rr(60), policy, asOf: ASOF });
    expect(b.effectiveMode).toBe('SOLO'); // flat ⇒ still holds

    // Now a genuine decline below the established baseline (CO_PILOT → SHADOW).
    const c = stepLifecycle({ ids, state: b.state, readiness: rr(30), policy, asOf: ASOF });
    const d = stepLifecycle({ ids, state: c.state, readiness: rr(30), policy, asOf: ASOF });
    expect(d.effectiveMode).toBe('CO_PILOT'); // the subsequent decline demotes
  });
});
