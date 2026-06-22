'use client';

import { type Role, can } from '@provable/contracts';
import { useCallback, useEffect, useState } from 'react';
import type { GuardrailRuleRow } from '@/lib/api';
import {
  type GuardrailRuleForm,
  RULE_OUTCOMES,
  RULE_VERDICTS,
  buildRulePayload,
  emptyRuleForm,
  ruleConditionSummary,
  ruleFormValid,
} from '@/lib/guardrails-view';
import { EmptyState } from './empty-state';

// Phase W4 — Safety pillar: create + list PLATFORM guardrail rules. Provable evaluates these at
// ingestion and trips the guardrail itself; the incidents feed (GuardrailsSection) then shows
// "Provable-detected" vs "Agent-reported". UX gate only — the API enforces configure_guardrails.
export function GuardrailsClient({ role }: { role: Role }) {
  const canConfigure = can(role, 'configure_guardrails');
  const [rules, setRules] = useState<GuardrailRuleRow[]>([]);
  const [form, setForm] = useState<GuardrailRuleForm>(emptyRuleForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/guardrails', { cache: 'no-store' });
    if (res.ok) setRules(((await res.json()) as { rules: GuardrailRuleRow[] }).rules);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/guardrails', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildRulePayload(form)),
      });
      if (!res.ok) {
        setError('Could not create the rule — check the fields, or your permissions.');
        return;
      }
      setForm(emptyRuleForm());
      await refresh();
    } finally {
      setSaving(false);
    }
  }, [form, refresh]);

  const toggle = useCallback(
    async (rule: GuardrailRuleRow) => {
      const res = await fetch(`/api/guardrails/${encodeURIComponent(rule.id)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      if (res.ok) await refresh();
    },
    [refresh],
  );

  const set = (patch: Partial<GuardrailRuleForm>) => setForm((p) => ({ ...p, ...patch }));

  return (
    <div className="guardrail-rules" data-guardrail-rules>
      <section className="pillar">
        <h2>Platform guardrails</h2>
        <p className="connect-lead">
          Rules Provable enforces itself: it evaluates every ingested decision and trips the
          guardrail on a violation — <strong>independent of what the agent reports</strong>. A trip
          suspends the task and is audited as <strong>Provable-detected</strong>.
        </p>

        {canConfigure ? (
          <div className="rule-form glass" data-rule-form>
            <div className="row">
              <input
                className="gw-input"
                aria-label="agent key (blank = any)"
                placeholder="agent key (blank = any)"
                value={form.agentKey}
                onChange={(e) => set({ agentKey: e.target.value })}
                data-rule-agent
              />
              <input
                className="gw-input"
                aria-label="task key (blank = any)"
                placeholder="task key (blank = any)"
                value={form.taskKey}
                onChange={(e) => set({ taskKey: e.target.value })}
                data-rule-task
              />
            </div>
            <div className="row">
              <select
                className="gw-input"
                aria-label="verdict condition"
                value={form.verdict}
                onChange={(e) => set({ verdict: e.target.value as GuardrailRuleForm['verdict'] })}
                data-rule-verdict
              >
                <option value="">any verdict</option>
                {RULE_VERDICTS.map((v) => (
                  <option key={v} value={v}>
                    verdict = {v}
                  </option>
                ))}
              </select>
              <select
                className="gw-input"
                aria-label="outcome condition"
                value={form.outcome}
                onChange={(e) => set({ outcome: e.target.value as GuardrailRuleForm['outcome'] })}
                data-rule-outcome
              >
                <option value="">any outcome</option>
                {RULE_OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    outcome = {o}
                  </option>
                ))}
              </select>
            </div>
            <input
              className="gw-input"
              aria-label="guardrail id"
              placeholder="guardrail id (audit label, e.g. sensitive_request_block)"
              value={form.guardrailId}
              onChange={(e) => set({ guardrailId: e.target.value })}
              data-rule-guardrailid
            />
            <input
              className="gw-input"
              aria-label="reason"
              placeholder="reason (shown in the audit trail on a trip)"
              value={form.reasonTemplate}
              onChange={(e) => set({ reasonTemplate: e.target.value })}
              data-rule-reason
            />
            <button
              className="approve"
              onClick={save}
              disabled={saving || !ruleFormValid(form)}
              data-rule-save
            >
              {saving ? 'Saving…' : 'Create rule'}
            </button>
            {!ruleFormValid(form) ? (
              <p className="disclosure">
                A rule needs a guardrail id, a reason, and at least one of verdict / outcome.
              </p>
            ) : null}
            {error ? <p className="connect-error">{error}</p> : null}
          </div>
        ) : (
          <p className="disclosure">Only a role with configure_guardrails can manage rules.</p>
        )}
      </section>

      <section className="pillar">
        <h3>Active rules</h3>
        {rules.length === 0 ? (
          <EmptyState
            icon="safety"
            title={
              canConfigure
                ? 'No guardrail rules yet — define one with the form above.'
                : 'No guardrail rules yet.'
            }
          />
        ) : (
          <ul className="rule-list" data-rule-list>
            {rules.map((r) => (
              <li key={r.id} className={`rule-row glass${r.enabled ? '' : ' disabled'}`} data-rule-row>
                <span className="rule-id">{r.guardrailId}</span>
                <span className="rule-cond">{ruleConditionSummary(r)}</span>
                <span className={`rule-state ${r.enabled ? 'on' : 'off'}`}>
                  {r.enabled ? 'enabled' : 'disabled'}
                </span>
                {canConfigure ? (
                  <button className="lens" onClick={() => toggle(r)} data-rule-toggle>
                    {r.enabled ? 'Disable' : 'Enable'}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
