import type { AgentKey, TaskKey } from '@provable/contracts';
import { describe, expect, it } from 'vitest';
import { type DecisionRule, type EvaluableDecision, evaluateGuardrails, ruleHasCondition } from '../src/index.js';

const a = 'agent-1' as AgentKey;
const t = 'task-1' as TaskKey;

const decision = (over: Partial<EvaluableDecision> = {}): EvaluableDecision => ({
  agentKey: a,
  taskKey: t,
  verdict: 'ACCEPTED',
  ...over,
});

const rule = (over: Partial<DecisionRule> = {}): DecisionRule => ({
  id: 'g1',
  reason: 'violated policy',
  verdict: 'ACCEPTED',
  ...over,
});

describe('evaluateGuardrails — pure, domain-agnostic, first match wins', () => {
  it('matches on a verdict condition and returns {id, reason}', () => {
    expect(evaluateGuardrails(decision({ verdict: 'ACCEPTED' }), [rule()])).toEqual({
      id: 'g1',
      reason: 'violated policy',
    });
  });

  it('does not match when the verdict differs', () => {
    expect(evaluateGuardrails(decision({ verdict: 'ESCALATED' }), [rule({ verdict: 'ACCEPTED' })])).toBeNull();
  });

  it('matches on an outcome condition (verdict unconstrained)', () => {
    const r: DecisionRule = { id: 'g-fail', reason: 'bad outcome', outcome: 'FAILURE' };
    expect(evaluateGuardrails(decision({ outcome: 'FAILURE' }), [r])).toEqual({ id: 'g-fail', reason: 'bad outcome' });
    expect(evaluateGuardrails(decision({ outcome: 'SUCCESS' }), [r])).toBeNull();
  });

  it('requires BOTH verdict and outcome when both are set (AND semantics)', () => {
    const r = rule({ verdict: 'ACCEPTED', outcome: 'FAILURE' });
    expect(evaluateGuardrails(decision({ verdict: 'ACCEPTED', outcome: 'FAILURE' }), [r])).not.toBeNull();
    expect(evaluateGuardrails(decision({ verdict: 'ACCEPTED', outcome: 'SUCCESS' }), [r])).toBeNull();
  });

  it('scopes by agentKey / taskKey; undefined scope ⇒ any', () => {
    const scoped = rule({ agentKey: a, taskKey: t });
    expect(evaluateGuardrails(decision(), [scoped])).not.toBeNull();
    expect(evaluateGuardrails(decision({ agentKey: 'other' as AgentKey }), [scoped])).toBeNull();
    expect(evaluateGuardrails(decision({ taskKey: 'other' as TaskKey }), [scoped])).toBeNull();
    // undefined scope matches any agent/task.
    expect(evaluateGuardrails(decision({ agentKey: 'x' as AgentKey, taskKey: 'y' as TaskKey }), [rule()])).not.toBeNull();
  });

  it('a rule with NO condition is inert (never matches "everything")', () => {
    const empty: DecisionRule = { id: 'g1', reason: 'violated policy' };
    expect(ruleHasCondition(empty)).toBe(false);
    expect(evaluateGuardrails(decision(), [empty])).toBeNull();
  });

  it('returns the FIRST matching rule when several match', () => {
    const r1 = rule({ id: 'first', verdict: 'ACCEPTED' });
    const r2 = rule({ id: 'second', verdict: 'ACCEPTED', reason: 'also matches' });
    expect(evaluateGuardrails(decision(), [r1, r2])?.id).toBe('first');
  });

  it('empty rule list ⇒ null', () => {
    expect(evaluateGuardrails(decision(), [])).toBeNull();
  });
});
