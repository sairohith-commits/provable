import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  AgentKey,
  Confidence,
  Cost,
  Decision,
  DecisionId,
  ExternalRef,
  OrgId,
  Outcome,
  Source,
  TaskKey,
  Transition,
  Verdict,
  VerdictEvent,
} from '../src/index.js';

describe('Decision shape', () => {
  it('accepts a minimal valid decision and pins every field type', () => {
    const decision: Decision = {
      id: 'd_1' as DecisionId,
      orgId: 'org_1' as OrgId,
      agentKey: 'agent_1' as AgentKey,
      taskKey: 'classify' as TaskKey,
      at: '2026-06-15T00:00:00.000Z',
      action: { label: 'whatever — opaque to core' },
      verdict: { kind: 'PENDING' },
      source: 'sdk',
    };

    expect(decision.verdict.kind).toBe('PENDING');
    expect(decision.source).toBe('sdk');

    // Branded identifiers — nominal, not interchangeable.
    expectTypeOf<Decision['id']>().toEqualTypeOf<DecisionId>();
    expectTypeOf<Decision['orgId']>().toEqualTypeOf<OrgId>();
    expectTypeOf<Decision['agentKey']>().toEqualTypeOf<AgentKey>();
    expectTypeOf<Decision['taskKey']>().toEqualTypeOf<TaskKey>();

    // action is OPAQUE to core.
    expectTypeOf<Decision['action']>().toEqualTypeOf<unknown>();

    // Optional axes.
    expectTypeOf<Decision['confidence']>().toEqualTypeOf<Confidence | undefined>();
    expectTypeOf<Decision['cost']>().toEqualTypeOf<Cost | undefined>();
    expectTypeOf<Decision['outcome']>().toEqualTypeOf<Outcome | undefined>();
    expectTypeOf<Decision['externalRef']>().toEqualTypeOf<ExternalRef | undefined>();
    expectTypeOf<Decision['metadata']>().toEqualTypeOf<Record<string, unknown> | undefined>();

    // Required axes.
    expectTypeOf<Decision['verdict']>().toEqualTypeOf<Verdict>();
    expectTypeOf<Decision['source']>().toEqualTypeOf<Source>();
    expectTypeOf<Decision['at']>().toEqualTypeOf<string>();
  });
});

describe('Verdict shape', () => {
  it('is the closed discriminated union; OVERRIDDEN carries optional magnitude', () => {
    const overridden: Verdict = { kind: 'OVERRIDDEN', magnitude: 0.5 };
    expect(overridden.kind).toBe('OVERRIDDEN');

    expectTypeOf<Extract<Verdict, { kind: 'OVERRIDDEN' }>>().toEqualTypeOf<{
      kind: 'OVERRIDDEN';
      magnitude?: number;
    }>();
    expectTypeOf<Extract<Verdict, { kind: 'PENDING' }>>().toEqualTypeOf<{ kind: 'PENDING' }>();
  });
});

describe('VerdictEvent shape', () => {
  it('requires externalRef and carries optional verdict/outcome', () => {
    const ve: VerdictEvent = {
      orgId: 'org_1' as OrgId,
      source: 'connector',
      externalRef: 'ext_1' as ExternalRef,
      verdict: { kind: 'ACCEPTED' },
      outcome: 'SUCCESS',
      at: '2026-06-15T01:00:00.000Z',
    };

    expect(ve.externalRef).toBe('ext_1');

    // externalRef is REQUIRED on a VerdictEvent (unlike on a Decision).
    expectTypeOf<VerdictEvent['externalRef']>().toEqualTypeOf<ExternalRef>();
    expectTypeOf<VerdictEvent['verdict']>().toEqualTypeOf<Verdict | undefined>();
    expectTypeOf<VerdictEvent['outcome']>().toEqualTypeOf<Outcome | undefined>();
  });
});

describe('Transition shape', () => {
  const base = {
    orgId: 'org_1' as OrgId,
    agentKey: 'agent_1' as AgentKey,
    taskKey: 'classify' as TaskKey,
    fromMode: 'SHADOW',
    toMode: 'CO_PILOT',
    trigger: 'SCORE_CROSS',
    status: 'APPLIED',
    reason: 'score crossed and sustained the upper threshold',
    at: '2026-06-15T02:00:00.000Z',
  } as const;

  it('is the doc’s flat shape with optional approver (the rule is enforced in core)', () => {
    const promotion: Transition = { ...base, direction: 'PROMOTION', approver: 'alice' };
    const demotion: Transition = {
      ...base,
      fromMode: 'SOLO',
      toMode: 'CO_PILOT',
      direction: 'DEMOTION',
    };

    // approver is OPTIONAL at the type level (doc §2A line 173). A PROPOSED
    // promotion legitimately has no approver yet; core/lifecycle enforces that an
    // APPLIED promotion must carry one. So this is type-valid by design:
    const proposedNoApprover: Transition = { ...base, status: 'PROPOSED', direction: 'PROMOTION' };

    expectTypeOf<Transition['approver']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Transition['direction']>().toEqualTypeOf<
      'PROMOTION' | 'DEMOTION' | 'LATERAL'
    >();

    expect(promotion.approver).toBe('alice');
    expect(demotion.direction).toBe('DEMOTION');
    expect(proposedNoApprover.approver).toBeUndefined();
  });
});
