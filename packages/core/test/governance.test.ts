import type { AgentKey, OrgId, TaskKey, Transition } from '@provable/contracts';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GOVERNANCE_POLICY,
  type LifecycleState,
  deriveGovernanceStatus,
  manualOverride,
  stepLifecycle,
} from '../src/index.js';
import type { GovernanceDerivationInput } from '../src/index.js';

const base: GovernanceDerivationInput = {
  effectiveMode: 'SHADOW',
  scored: true,
  impliedBand: 'SHADOW',
  effectiveModeViaOverride: false,
  latestIsAutoDemotionSignalLossOrDrift: false,
  livePromotion: false,
};

describe('deriveGovernanceStatus — exactly one status + actionAvailable', () => {
  it('suspended-beats-high-score: SUSPENDED, action=false (beats a 95 score)', () => {
    const r = deriveGovernanceStatus({ ...base, effectiveMode: 'SUSPENDED', impliedBand: 'SOLO' });
    expect(r.status).toBe('SUSPENDED');
    expect(r.actionAvailable).toBe(false);
    expect(r.headroomTo).toBeNull();
  });

  it('signal-loss latest transition → DEGRADED, action=false (pending suppressed)', () => {
    const r = deriveGovernanceStatus({
      ...base,
      effectiveMode: 'SHADOW',
      impliedBand: 'CO_PILOT',
      latestIsAutoDemotionSignalLossOrDrift: true,
      livePromotion: false, // most-recent transition is the demotion, not the pending
    });
    expect(r.status).toBe('DEGRADED');
    expect(r.actionAvailable).toBe(false);
  });

  it('unscored → DEGRADED, action=false', () => {
    const r = deriveGovernanceStatus({ ...base, scored: false, impliedBand: null });
    expect(r.status).toBe('DEGRADED');
    expect(r.actionAvailable).toBe(false);
  });

  it('manual-hold: score implies SOLO, overridden to SHADOW → HELD, action=false, headroom set', () => {
    const r = deriveGovernanceStatus({
      ...base,
      effectiveMode: 'SHADOW',
      impliedBand: 'SOLO',
      effectiveModeViaOverride: true,
    });
    expect(r.status).toBe('HELD');
    expect(r.actionAvailable).toBe(false);
    expect(r.headroomTo).toBe('SOLO');
  });

  it('live-promotable: scored up, live PENDING_APPROVAL → PROMOTABLE, action=true, headroomTo set', () => {
    const r = deriveGovernanceStatus({
      ...base,
      effectiveMode: 'SHADOW',
      impliedBand: 'CO_PILOT',
      livePromotion: true,
    });
    expect(r.status).toBe('PROMOTABLE');
    expect(r.actionAvailable).toBe(true);
    expect(r.headroomTo).toBe('CO_PILOT');
  });

  it('at-level: effectiveMode == impliedBand → AT_LEVEL, action=false', () => {
    const r = deriveGovernanceStatus({ ...base, effectiveMode: 'CO_PILOT', impliedBand: 'CO_PILOT' });
    expect(r.status).toBe('AT_LEVEL');
    expect(r.actionAvailable).toBe(false);
  });

  it('scored above level but NO live promotion → AT_LEVEL (nothing to act on), action=false', () => {
    const r = deriveGovernanceStatus({ ...base, effectiveMode: 'SHADOW', impliedBand: 'SOLO', livePromotion: false });
    expect(r.status).toBe('AT_LEVEL');
    expect(r.actionAvailable).toBe(false);
  });
});

describe('supersede emission — a pending promotion terminalizes when overtaken', () => {
  const ids = { orgId: 'org_1' as OrgId, agentKey: 'a' as AgentKey, taskKey: 't' as TaskKey };
  const ASOF = '2026-06-18T00:00:00.000Z';
  const pendingState: LifecycleState = {
    effectiveMode: 'CO_PILOT',
    consecutivePromotionReady: 0,
    consecutiveSubFloor: 0,
    consecutiveInsufficient: 1, // one INSUFFICIENT already; grace = 2 → next one demotes
    pendingPromotion: { toMode: 'SOLO', awaitingApproval: true },
    lastImpliedRank: 2,
  };

  it('a SIGNAL_LOSS demotion supersedes the in-flight pending; the demotion is most-recent', () => {
    const r = stepLifecycle({
      ids,
      state: pendingState,
      readiness: { status: 'INSUFFICIENT', missing: ['confidenceAvg'], eventCount: 50, resolvedCount: 50 },
      policy: DEFAULT_GOVERNANCE_POLICY,
      asOf: ASOF,
    });
    const sup = r.transitions.find((t: Transition) => t.status === 'SUPERSEDED');
    expect(sup).toBeDefined();
    expect(sup?.toMode).toBe('SOLO');
    const last = r.transitions[r.transitions.length - 1] as Transition;
    expect(last.status).toBe('AUTO_APPLIED');
    expect(last.trigger).toBe('SIGNAL_LOSS'); // demotion is the most-recent transition
    expect(r.effectiveMode).toBe('SHADOW');
  });

  it('a manual override supersedes the in-flight pending; override is most-recent', () => {
    const r = manualOverride({ ids, state: pendingState, target: 'SHADOW', actor: 'alice', reason: 'hold', asOf: ASOF });
    const sup = r.transitions.find((t) => t.status === 'SUPERSEDED');
    expect(sup?.toMode).toBe('SOLO');
    const last = r.transitions[r.transitions.length - 1] as Transition;
    expect(last.trigger).toBe('MANUAL_OVERRIDE');
    expect(last.status).toBe('APPLIED');
  });
});
