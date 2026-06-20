// Phase W4 — pure view-logic for the Safety pillar's guardrail-rule editor. All form validation,
// payload assembly, and incident labelling lives here (node-tested), never inline in JSX. The org
// is NEVER part of this — it's stamped server-side from the verified caller.

// Verdict/outcome a rule may condition on. PENDING is omitted — a guardrail conditions on a
// resolved judgment, not an unresolved one.
export const RULE_VERDICTS = ['ACCEPTED', 'OVERRIDDEN', 'ESCALATED', 'FAILED'] as const;
export const RULE_OUTCOMES = ['SUCCESS', 'PARTIAL', 'FAILURE'] as const;

export type RuleVerdict = (typeof RULE_VERDICTS)[number];
export type RuleOutcome = (typeof RULE_OUTCOMES)[number];

export interface GuardrailRuleForm {
  agentKey: string; // blank ⇒ any agent
  taskKey: string; // blank ⇒ any task
  verdict: '' | RuleVerdict; // blank ⇒ no verdict condition
  outcome: '' | RuleOutcome; // blank ⇒ no outcome condition
  guardrailId: string;
  reasonTemplate: string;
}

export function emptyRuleForm(): GuardrailRuleForm {
  return { agentKey: '', taskKey: '', verdict: '', outcome: '', guardrailId: '', reasonTemplate: '' };
}

/** A rule must name a guardrailId + reason AND constrain at least one of verdict/outcome. */
export function ruleFormValid(form: GuardrailRuleForm): boolean {
  const hasCondition = form.verdict !== '' || form.outcome !== '';
  return form.guardrailId.trim().length > 0 && form.reasonTemplate.trim().length > 0 && hasCondition;
}

export interface GuardrailRulePayload {
  guardrailId: string;
  reasonTemplate: string;
  agentKey?: string;
  taskKey?: string;
  verdict?: RuleVerdict;
  outcome?: RuleOutcome;
}

/** Assemble the POST body — trims, and OMITS every blank optional field (no empty keys). */
export function buildRulePayload(form: GuardrailRuleForm): GuardrailRulePayload {
  const agentKey = form.agentKey.trim();
  const taskKey = form.taskKey.trim();
  return {
    guardrailId: form.guardrailId.trim(),
    reasonTemplate: form.reasonTemplate.trim(),
    ...(agentKey.length > 0 ? { agentKey } : {}),
    ...(taskKey.length > 0 ? { taskKey } : {}),
    ...(form.verdict !== '' ? { verdict: form.verdict } : {}),
    ...(form.outcome !== '' ? { outcome: form.outcome } : {}),
  };
}

/** Human-readable summary of a rule's scope + condition for the active-rules list. */
export function ruleConditionSummary(rule: {
  agentKey: string | null;
  taskKey: string | null;
  verdict: string | null;
  outcome: string | null;
}): string {
  const scope = `${rule.agentKey ?? 'any agent'} · ${rule.taskKey ?? 'any task'}`;
  const conds: string[] = [];
  if (rule.verdict !== null) conds.push(`verdict = ${rule.verdict}`);
  if (rule.outcome !== null) conds.push(`outcome = ${rule.outcome}`);
  return `${scope} — ${conds.join(' AND ')}`;
}

/**
 * Who caught a guardrail trip, for the incidents feed. A platform-detected trip carries
 * actor="policy" (Provable evaluated an org rule); an agent-reported trip has no actor.
 */
export function incidentSource(actor: string | undefined): 'platform' | 'agent' {
  return actor === 'policy' ? 'platform' : 'agent';
}

export function incidentSourceLabel(actor: string | undefined): string {
  return incidentSource(actor) === 'platform' ? 'Provable-detected' : 'Agent-reported';
}
