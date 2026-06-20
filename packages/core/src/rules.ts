import type { AgentKey, Outcome, TaskKey, VerdictKind } from '@provable/contracts';

/**
 * Platform guardrail rules — pure, domain-agnostic evaluation (Phase W4).
 *
 * Core sees ONLY the generic decision vocabulary (agent/task/verdict/outcome). The org's domain
 * meaning lives entirely in the DATA — which task name, which verdict/outcome a rule matches — and
 * in the org's stored rule, NEVER in core. There is no domain noun here; `id` and `reason` are
 * opaque audit strings the composition root supplies (the org's guardrailId + reasonTemplate).
 *
 * A match does NOT itself suspend anything: the composition root turns a match into a GuardrailTrip
 * signal and reuses the EXISTING trip→SUSPENDED lifecycle (see lifecycle.ts) — identical to an
 * agent-reported trip. This module only decides "does this decision violate an org rule?".
 */

/** A rule reduced to the generic condition core can read. `undefined` field ⇒ "any". */
export interface DecisionRule {
  readonly id: string; // the org's free-form guardrailId (audit string)
  readonly agentKey?: AgentKey; // undefined ⇒ any agent
  readonly taskKey?: TaskKey; // undefined ⇒ any task
  readonly verdict?: VerdictKind; // match when the decision's verdict kind equals this
  readonly outcome?: Outcome; // match when the decision's outcome equals this
  readonly reason: string; // audit reason (the org's reasonTemplate)
}

/** The closed, domain-agnostic subset of a decision a rule may inspect. */
export interface EvaluableDecision {
  readonly agentKey: AgentKey;
  readonly taskKey: TaskKey;
  readonly verdict: VerdictKind;
  readonly outcome?: Outcome;
}

export interface RuleMatch {
  readonly id: string;
  readonly reason: string;
}

/**
 * A rule must constrain SOMETHING (verdict and/or outcome). A rule with neither condition is inert
 * and never matches — so a misconfigured "match everything" can never silently suspend an agent.
 */
export function ruleHasCondition(rule: DecisionRule): boolean {
  return rule.verdict !== undefined || rule.outcome !== undefined;
}

function matches(rule: DecisionRule, d: EvaluableDecision): boolean {
  if (!ruleHasCondition(rule)) return false;
  if (rule.agentKey !== undefined && rule.agentKey !== d.agentKey) return false;
  if (rule.taskKey !== undefined && rule.taskKey !== d.taskKey) return false;
  if (rule.verdict !== undefined && rule.verdict !== d.verdict) return false;
  if (rule.outcome !== undefined && rule.outcome !== d.outcome) return false;
  return true;
}

/**
 * Pure guardrail evaluation: the FIRST rule whose generic condition the decision satisfies, or
 * null. No I/O, no clock, no randomness. The caller (composition root) owns persistence, ordering
 * of the rule list, and what a match triggers.
 */
export function evaluateGuardrails(
  decision: EvaluableDecision,
  rules: readonly DecisionRule[],
): RuleMatch | null {
  for (const rule of rules) {
    if (matches(rule, decision)) return { id: rule.id, reason: rule.reason };
  }
  return null;
}
