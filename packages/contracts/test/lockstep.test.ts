import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  AGENT_IDENTITY_STATES,
  AUTONOMY_MODES,
  OUTCOMES,
  SOURCES,
  TRANSITION_DIRECTIONS,
  TRANSITION_STATUSES,
  TRANSITION_TRIGGERS,
  VERDICT_KINDS,
} from '../src/index.js';
import type {
  AgentIdentityState,
  AutonomyMode,
  Outcome,
  Source,
  Transition,
  TransitionDirection,
  TransitionStatus,
  TransitionTrigger,
  Verdict,
  VerdictKind,
} from '../src/index.js';

describe('as-const arrays stay in lockstep with their derived unions', () => {
  it('directly-derived unions equal their source array element type', () => {
    expectTypeOf<(typeof OUTCOMES)[number]>().toEqualTypeOf<Outcome>();
    expectTypeOf<(typeof SOURCES)[number]>().toEqualTypeOf<Source>();
    expectTypeOf<(typeof VERDICT_KINDS)[number]>().toEqualTypeOf<VerdictKind>();
    expectTypeOf<(typeof AGENT_IDENTITY_STATES)[number]>().toEqualTypeOf<AgentIdentityState>();
    expectTypeOf<(typeof AUTONOMY_MODES)[number]>().toEqualTypeOf<AutonomyMode>();
    expectTypeOf<(typeof TRANSITION_DIRECTIONS)[number]>().toEqualTypeOf<TransitionDirection>();
    expectTypeOf<(typeof TRANSITION_TRIGGERS)[number]>().toEqualTypeOf<TransitionTrigger>();
    expectTypeOf<(typeof TRANSITION_STATUSES)[number]>().toEqualTypeOf<TransitionStatus>();
  });

  it('hand-written discriminated unions stay pinned to their arrays', () => {
    // These would drift silently without a test: the Verdict and Transition
    // unions inline their string literals rather than deriving them.
    expectTypeOf<(typeof VERDICT_KINDS)[number]>().toEqualTypeOf<Verdict['kind']>();
    expectTypeOf<(typeof TRANSITION_DIRECTIONS)[number]>().toEqualTypeOf<Transition['direction']>();
    expectTypeOf<(typeof TRANSITION_TRIGGERS)[number]>().toEqualTypeOf<Transition['trigger']>();
    expectTypeOf<(typeof TRANSITION_STATUSES)[number]>().toEqualTypeOf<Transition['status']>();
  });

  it('runtime arrays are duplicate-free and hold exactly the locked members', () => {
    const arrays = [
      OUTCOMES,
      SOURCES,
      VERDICT_KINDS,
      AGENT_IDENTITY_STATES,
      AUTONOMY_MODES,
      TRANSITION_DIRECTIONS,
      TRANSITION_TRIGGERS,
      TRANSITION_STATUSES,
    ];
    for (const arr of arrays) {
      expect(new Set(arr).size).toBe(arr.length);
    }

    expect([...OUTCOMES]).toEqual(['SUCCESS', 'PARTIAL', 'FAILURE']);
    expect([...SOURCES]).toEqual(['gateway', 'sdk', 'connector', 'otel']);
    expect([...VERDICT_KINDS]).toEqual(['PENDING', 'ACCEPTED', 'OVERRIDDEN', 'ESCALATED', 'FAILED']);
    expect([...AGENT_IDENTITY_STATES]).toEqual(['DISCOVERED', 'ACTIVE', 'DORMANT', 'RETIRED']);
    expect([...AUTONOMY_MODES]).toEqual([
      'OBSERVING',
      'SHADOW',
      'CO_PILOT',
      'SOLO',
      'SUSPENDED',
      'RETIRED',
    ]);
    expect([...TRANSITION_DIRECTIONS]).toEqual(['PROMOTION', 'DEMOTION', 'LATERAL']);
    expect([...TRANSITION_TRIGGERS]).toEqual([
      'SCORE_CROSS',
      'DRIFT',
      'GUARDRAIL',
      'SIGNAL_LOSS',
      'MANUAL_OVERRIDE',
      'SCHEDULED',
      'SUSPEND',
      'RESUME',
    ]);
    expect([...TRANSITION_STATUSES]).toEqual([
      'PROPOSED',
      'PENDING_APPROVAL',
      'APPLIED',
      'AUTO_APPLIED',
      'REJECTED',
      'SUPERSEDED',
    ]);
  });
});
