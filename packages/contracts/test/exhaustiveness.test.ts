import { describe, expect, it } from 'vitest';
import {
  AGENT_IDENTITY_STATES,
  AUTONOMY_MODES,
  TRANSITION_DIRECTIONS,
  TRANSITION_STATUSES,
  TRANSITION_TRIGGERS,
  VERDICT_KINDS,
  assertNever,
} from '../src/index.js';
import type {
  AgentIdentityState,
  AutonomyMode,
  TransitionDirection,
  TransitionStatus,
  TransitionTrigger,
  Verdict,
} from '../src/index.js';

/*
 * Each function below is an exhaustive switch closed with `assertNever`. If any
 * union ever gains a member without a matching case, the `default` argument stops
 * being `never` and compilation fails — proving the union is closed.
 */

function describeVerdict(v: Verdict): string {
  switch (v.kind) {
    case 'PENDING':
      return 'pending';
    case 'ACCEPTED':
      return 'accepted';
    case 'OVERRIDDEN':
      return `overridden:${v.magnitude ?? 'n/a'}`;
    case 'ESCALATED':
      return 'escalated';
    case 'FAILED':
      return 'failed';
    default:
      return assertNever(v);
  }
}

function describeMode(m: AutonomyMode): string {
  switch (m) {
    case 'OBSERVING':
      return 'observing';
    case 'SHADOW':
      return 'shadow';
    case 'CO_PILOT':
      return 'co_pilot';
    case 'SOLO':
      return 'solo';
    case 'SUSPENDED':
      return 'suspended';
    case 'RETIRED':
      return 'retired';
    default:
      return assertNever(m);
  }
}

function describeIdentity(s: AgentIdentityState): string {
  switch (s) {
    case 'DISCOVERED':
      return 'discovered';
    case 'ACTIVE':
      return 'active';
    case 'DORMANT':
      return 'dormant';
    case 'RETIRED':
      return 'retired';
    default:
      return assertNever(s);
  }
}

function describeDirection(d: TransitionDirection): string {
  switch (d) {
    case 'PROMOTION':
      return 'promotion';
    case 'DEMOTION':
      return 'demotion';
    case 'LATERAL':
      return 'lateral';
    default:
      return assertNever(d);
  }
}

function describeTrigger(t: TransitionTrigger): string {
  switch (t) {
    case 'SCORE_CROSS':
      return 'score_cross';
    case 'DRIFT':
      return 'drift';
    case 'GUARDRAIL':
      return 'guardrail';
    case 'SIGNAL_LOSS':
      return 'signal_loss';
    case 'MANUAL':
      return 'manual';
    case 'SCHEDULED':
      return 'scheduled';
    default:
      return assertNever(t);
  }
}

function describeStatus(s: TransitionStatus): string {
  switch (s) {
    case 'PROPOSED':
      return 'proposed';
    case 'PENDING_APPROVAL':
      return 'pending_approval';
    case 'APPLIED':
      return 'applied';
    case 'AUTO_APPLIED':
      return 'auto_applied';
    case 'REJECTED':
      return 'rejected';
    default:
      return assertNever(s);
  }
}

describe('closed unions are exhaustively handled', () => {
  it('handles every Verdict kind', () => {
    const samples: Verdict[] = [
      { kind: 'PENDING' },
      { kind: 'ACCEPTED' },
      { kind: 'OVERRIDDEN', magnitude: 0.3 },
      { kind: 'ESCALATED' },
      { kind: 'FAILED' },
    ];
    for (const v of samples) {
      expect(describeVerdict(v).length).toBeGreaterThan(0);
    }
    expect([...samples.map((v) => v.kind)].sort()).toEqual([...VERDICT_KINDS].sort());
  });

  it('handles every autonomy mode', () => {
    for (const m of AUTONOMY_MODES) {
      expect(describeMode(m).length).toBeGreaterThan(0);
    }
  });

  it('handles every agent identity state', () => {
    for (const s of AGENT_IDENTITY_STATES) {
      expect(describeIdentity(s).length).toBeGreaterThan(0);
    }
  });

  it('handles every transition direction', () => {
    for (const d of TRANSITION_DIRECTIONS) {
      expect(describeDirection(d).length).toBeGreaterThan(0);
    }
  });

  it('handles every transition trigger', () => {
    for (const t of TRANSITION_TRIGGERS) {
      expect(describeTrigger(t).length).toBeGreaterThan(0);
    }
  });

  it('handles every transition status', () => {
    for (const s of TRANSITION_STATUSES) {
      expect(describeStatus(s).length).toBeGreaterThan(0);
    }
  });

  it('assertNever throws if reached at runtime', () => {
    expect(() => assertNever('unexpected' as never)).toThrow();
  });
});
