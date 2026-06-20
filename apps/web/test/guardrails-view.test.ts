import { describe, expect, it } from 'vitest';
import {
  type GuardrailRuleForm,
  buildRulePayload,
  emptyRuleForm,
  incidentSource,
  incidentSourceLabel,
  ruleConditionSummary,
  ruleFormValid,
} from '../src/lib/guardrails-view';

const form = (over: Partial<GuardrailRuleForm> = {}): GuardrailRuleForm => ({
  ...emptyRuleForm(),
  guardrailId: 'g1',
  reasonTemplate: 'no auto-resolving complaints',
  verdict: 'ACCEPTED',
  ...over,
});

describe('ruleFormValid — needs id + reason + at least one condition', () => {
  it('valid when guardrailId, reason, and a verdict (or outcome) are set', () => {
    expect(ruleFormValid(form())).toBe(true);
    expect(ruleFormValid(form({ verdict: '', outcome: 'FAILURE' }))).toBe(true);
  });

  it('invalid without a guardrailId or reason', () => {
    expect(ruleFormValid(form({ guardrailId: '' }))).toBe(false);
    expect(ruleFormValid(form({ reasonTemplate: '   ' }))).toBe(false);
  });

  it('invalid with NO condition (never "match everything")', () => {
    expect(ruleFormValid(form({ verdict: '', outcome: '' }))).toBe(false);
  });
});

describe('buildRulePayload — trims and omits blank optionals', () => {
  it('includes only the set fields', () => {
    const p = buildRulePayload(form({ agentKey: ' bot ', taskKey: '', verdict: 'ACCEPTED', outcome: '' }));
    expect(p).toEqual({
      guardrailId: 'g1',
      reasonTemplate: 'no auto-resolving complaints',
      agentKey: 'bot',
      verdict: 'ACCEPTED',
    });
    expect('taskKey' in p).toBe(false);
    expect('outcome' in p).toBe(false);
  });

  it('carries both verdict and outcome when both set', () => {
    const p = buildRulePayload(form({ verdict: 'ACCEPTED', outcome: 'FAILURE' }));
    expect(p.verdict).toBe('ACCEPTED');
    expect(p.outcome).toBe('FAILURE');
  });
});

describe('ruleConditionSummary — scope + condition, any when null', () => {
  it('renders scope and AND-joined conditions', () => {
    expect(
      ruleConditionSummary({ agentKey: 'bot', taskKey: 'auto_resolve_sensitive', verdict: 'ACCEPTED', outcome: null }),
    ).toBe('bot · auto_resolve_sensitive — verdict = ACCEPTED');
    expect(ruleConditionSummary({ agentKey: null, taskKey: null, verdict: 'ACCEPTED', outcome: 'FAILURE' })).toBe(
      'any agent · any task — verdict = ACCEPTED AND outcome = FAILURE',
    );
  });
});

describe('incidentSource — platform-detected vs agent-reported', () => {
  it('actor "policy" ⇒ platform; anything else ⇒ agent', () => {
    expect(incidentSource('policy')).toBe('platform');
    expect(incidentSource(undefined)).toBe('agent');
    expect(incidentSource('alice')).toBe('agent');
    expect(incidentSourceLabel('policy')).toBe('Provable-detected');
    expect(incidentSourceLabel(undefined)).toBe('Agent-reported');
  });
});
