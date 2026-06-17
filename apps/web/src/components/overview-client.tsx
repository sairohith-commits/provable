'use client';

import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CostView,
  OverviewData,
  RegistryAgentRow,
  SafetyView,
  SummaryView,
  TransitionView,
  VerdictMix,
  VisibilityRow,
} from '@/lib/types';
import {
  PERSONAS,
  type Persona,
  type SectionKey,
  attentionFor,
  sectionOrder,
  sortReadinessRows,
} from '@/lib/view-helpers';
import { ReadinessLadder } from './readiness-ladder';

const POLL_MS = 4000;

const SECTION_TITLE: Record<SectionKey, string> = {
  readiness: 'Readiness',
  governance: 'Governance',
  visibility: 'Visibility & Intelligence',
  cost: 'Cost & ROI',
  guardrails: 'Guardrails & Safety',
  registry: 'Identity & Registry',
};

function usd(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

// ── KPI summary row (REAL counts or honest empty; NO compliance/score card) ───────
function KpiCard({
  label,
  value,
  sub,
  tone,
  title,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'attention' | 'projection';
  title?: string;
}) {
  return (
    <div className={`kpi glass${tone ? ` kpi-${tone}` : ''}`} title={title} data-kpi={label}>
      <span className="kpi-value">{value}</span>
      <span className="kpi-label">{label}</span>
      {sub ? <span className="kpi-sub">{sub}</span> : null}
    </div>
  );
}

function KpiRow({ summary }: { summary: SummaryView }) {
  const s = summary;
  const roiAssumptions = `assumes ${s.roi.assumptions.assumedHumanMinutesPerDecision} min/decision @ ${usd(
    s.roi.assumptions.assumedHumanHourlyUsd,
  )}/hr · ${s.roi.shadowDecisionVolume} Shadow decisions`;
  return (
    <div className="kpi-row" data-kpi-row>
      <KpiCard label="Active agents" value={String(s.activeAgents)} sub={`${s.agentsTotal} total`} />
      <KpiCard
        label="Pending approvals"
        value={String(s.pendingApprovals)}
        tone={s.pendingApprovals > 0 ? 'attention' : undefined}
      />
      <KpiCard
        label="Guardrail trips"
        value={String(s.suspendedCount)}
        sub={`${s.guardrailEventCount} safety events`}
        tone={s.suspendedCount > 0 ? 'attention' : undefined}
      />
      <KpiCard
        label="Token spend"
        value={s.hasCostSignal ? s.tokenSpend.toLocaleString() : '—'}
        sub={s.hasCostSignal ? usd(s.usdSpend) : 'no cost signal yet'}
      />
      <KpiCard
        label="ROI projection"
        value={usd(s.roi.projectedSavingsIfPromotedUsd)}
        sub="projection · hover for assumptions"
        tone="projection"
        title={roiAssumptions}
      />
    </div>
  );
}

export function OverviewClient({ initial }: { initial: OverviewData }) {
  const [data, setData] = useState<OverviewData>(initial);
  const [persona, setPersona] = useState<Persona>('All');
  const [pending, setPending] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/overview', { cache: 'no-store' });
    if (res.ok) setData((await res.json()) as OverviewData);
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const approve = useCallback(
    async (agentKey: string, taskKey: string) => {
      setPending(`${agentKey}:${taskKey}`);
      try {
        await fetch('/api/approve', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ agentKey, taskKey }),
        });
        await refresh();
      } finally {
        setPending(null);
      }
    },
    [refresh],
  );

  const ranked = useMemo(
    () => sortReadinessRows(data.agents, data.transitions),
    [data.agents, data.transitions],
  );
  const attentionCount = ranked.filter((r) => r.attention.needsAttention).length;

  const order = sectionOrder(persona);

  const sections: Record<SectionKey, ReactNode> = {
    readiness: (
      <ReadinessSection
        key="readiness"
        ranked={ranked}
        pending={pending}
        onApprove={approve}
      />
    ),
    governance: <GovernanceSection key="governance" transitions={data.transitions} />,
    visibility: <VisibilitySection key="visibility" rows={data.visibility} />,
    cost: <CostSection key="cost" cost={data.cost} />,
    guardrails: <GuardrailsSection key="guardrails" safety={data.guardrails} />,
    registry: <RegistrySection key="registry" agents={data.registry} />,
  };

  return (
    <div className="overview">
      <KpiRow summary={data.summary} />

      <nav className="persona-lens" aria-label="persona lens">
        {PERSONAS.map((p) => (
          <button
            key={p}
            className={p === persona ? 'lens active' : 'lens'}
            onClick={() => setPersona(p)}
            data-persona={p}
          >
            {p}
          </button>
        ))}
        {attentionCount > 0 ? (
          <span className="attention-pill" title="rows needing attention">
            {attentionCount} need{attentionCount === 1 ? 's' : ''} attention
          </span>
        ) : null}
      </nav>

      {order.map((key) => sections[key])}
    </div>
  );
}

// ── Readiness ────────────────────────────────────────────────────────────────
function ReadinessSection({
  ranked,
  pending,
  onApprove,
}: {
  ranked: ReturnType<typeof sortReadinessRows>;
  pending: string | null;
  onApprove: (a: string, t: string) => void;
}) {
  return (
    <section className="pillar" data-section="readiness">
      <h2>{SECTION_TITLE.readiness}</h2>
      {ranked.length === 0 ? (
        <p className="empty">No agents reporting yet.</p>
      ) : (
        <ul className="agent-list">
          {ranked.map(({ row, attention }) => {
            const id = `${row.agentKey}:${row.taskKey}`;
            return (
              <li
                key={id}
                className={`agent-row glass${attention.needsAttention ? ' attention' : ''}`}
                data-attention={attention.needsAttention ? attention.rank : 0}
              >
                <div className="agent-id">
                  <span className="agent-key">{row.agentKey}</span>
                  <span className="task-key">{row.taskKey}</span>
                  <span className="flags">
                    {attention.pendingApproval ? <span className="flag flag-pending">pending approval</span> : null}
                    {attention.suspended ? <span className="flag flag-suspended">suspended</span> : null}
                    {attention.demoted ? <span className="flag flag-demoted">demoted</span> : null}
                    {attention.lowScore ? <span className="flag flag-low">low score</span> : null}
                  </span>
                </div>
                <ReadinessLadder score={row.score} effectiveMode={row.effectiveMode} />
                {attention.pendingApproval ? (
                  <button
                    className="approve"
                    disabled={pending === id}
                    onClick={() => onApprove(row.agentKey, row.taskKey)}
                  >
                    {pending === id ? 'Approving…' : 'Approve promotion'}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ── Governance (audit feed) ──────────────────────────────────────────────────
function GovernanceSection({ transitions }: { transitions: TransitionView[] }) {
  return (
    <section className="pillar" data-section="governance">
      <h2>{SECTION_TITLE.governance}</h2>
      {transitions.length === 0 ? (
        <p className="empty">No transitions yet.</p>
      ) : (
        <ul className="feed">
          {[...transitions].reverse().map((t, i) => (
            <li
              key={i}
              className={`feed-row status-${t.status.toLowerCase()} trigger-${t.trigger.toLowerCase()}`}
              data-trigger={t.trigger}
            >
              <span className="t-agent">
                {t.agentKey}·{t.taskKey}
              </span>
              <span className="t-move">
                {t.fromMode}→{t.toMode}
              </span>
              <span className="t-dir">{t.direction}</span>
              <span className="t-status">{t.status}</span>
              <span className={`t-trigger trig-${t.trigger.toLowerCase()}`}>{t.trigger}</span>
              {t.approver ? (
                <span className="t-approver">✓ {t.approverDisplay ?? t.approver}</span>
              ) : null}
              <span className="t-at">{t.at}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Visibility & Intelligence ────────────────────────────────────────────────
function MixBar({ mix }: { mix: VerdictMix }) {
  const total = mix.ACCEPTED + mix.OVERRIDDEN + mix.ESCALATED + mix.FAILED + mix.PENDING;
  if (total === 0) return <span className="mix-empty">no decisions in window</span>;
  const seg = (n: number, cls: string, label: string) =>
    n > 0 ? (
      <span className={`mix-seg ${cls}`} style={{ flex: n }} title={`${label}: ${n}`} />
    ) : null;
  return (
    <span className="mixbar" aria-label="verdict mix">
      {seg(mix.ACCEPTED, 'mix-accepted', 'Accepted')}
      {seg(mix.OVERRIDDEN, 'mix-overridden', 'Overridden')}
      {seg(mix.ESCALATED, 'mix-escalated', 'Escalated')}
      {seg(mix.FAILED, 'mix-failed', 'Failed')}
      {seg(mix.PENDING, 'mix-pending', 'Pending')}
    </span>
  );
}

function Sparkline({ points }: { points: VisibilityRow['scoreTrend'] }) {
  const scored = points.filter((p) => p.status === 'SCORED' && typeof p.readinessScore === 'number');
  if (scored.length < 2) return <span className="spark-empty">trend: not enough history</span>;
  return (
    <span className="spark" title="score across recomputes">
      {scored.map((p, i) => (
        <span
          key={i}
          className="spark-bar"
          style={{ height: `${Math.max(2, Math.min(100, p.readinessScore as number))}%` }}
        />
      ))}
    </span>
  );
}

function pct(n: number | null): string {
  return n === null ? '—' : `${(n * 100).toFixed(0)}%`;
}

function VisibilitySection({ rows }: { rows: VisibilityRow[] }) {
  return (
    <section className="pillar" data-section="visibility">
      <h2>{SECTION_TITLE.visibility}</h2>
      {rows.length === 0 ? (
        <p className="empty">No agent activity yet.</p>
      ) : (
        <ul className="vis-list">
          {rows.map((r) => (
            <li key={`${r.agentKey}:${r.taskKey}`} className="vis-row glass">
              <div className="vis-id">
                <span className="agent-key">{r.agentKey}</span>
                <span className="task-key">{r.taskKey}</span>
              </div>
              <div className="vis-body">
                <MixBar mix={r.verdictMix} />
                <div className="vis-stats">
                  <span>vol {r.windowVolume}</span>
                  <span>override {pct(r.components?.overrideRate ?? null)}</span>
                  <span>escalation {pct(r.components?.escalationRate ?? null)}</span>
                  <span>accuracy {pct(r.components?.accuracyRate ?? null)}</span>
                  <span>confidence {pct(r.components?.confidenceAvg ?? null)}</span>
                </div>
              </div>
              <Sparkline points={r.scoreTrend} />
            </li>
          ))}
        </ul>
      )}
      <p className="disclosure">
        Drift: dedicated drift detection is <strong>not tracked yet</strong> — the trend above is
        the score across recomputes (the only drift signal core computes).
      </p>
    </section>
  );
}

// ── Cost & ROI ───────────────────────────────────────────────────────────────
function CostSection({ cost }: { cost: CostView }) {
  const { org, roi } = cost;
  return (
    <section className="pillar" data-section="cost">
      <h2>{SECTION_TITLE.cost}</h2>

      <div className="cost-summary glass">
        <div className="cost-metric">
          <span className="cost-num">{org.decisionCount}</span>
          <span className="cost-lbl">decisions</span>
        </div>
        <div className="cost-metric">
          <span className="cost-num">{org.hasCostSignal ? usd(org.usd) : '—'}</span>
          <span className="cost-lbl">real agent cost</span>
        </div>
        <div className="cost-metric">
          <span className="cost-num">{org.hasCostSignal ? org.tokens.toLocaleString() : '—'}</span>
          <span className="cost-lbl">tokens</span>
        </div>
        <div className="cost-metric">
          <span className="cost-num">{org.avgLatencyMs === null ? '—' : `${Math.round(org.avgLatencyMs)}ms`}</span>
          <span className="cost-lbl">avg latency</span>
        </div>
      </div>
      {!org.hasCostSignal ? (
        <p className="disclosure">
          No per-decision cost reported by this org's adapters yet — cost is shown as empty, not
          estimated.
        </p>
      ) : null}

      {/* Shadow-counterfactual ROI — a PROJECTION, assumptions rendered on screen. */}
      <div className="roi glass" data-projection="true">
        <div className="roi-head">
          <span className="roi-tag">PROJECTION</span>
          <span className="roi-title">Proven savings if Shadow agents are promoted</span>
        </div>
        <div className="roi-figure">{usd(roi.projectedSavingsIfPromotedUsd)}</div>
        <ul className="roi-assumptions">
          <li>
            assumes <strong>{roi.assumptions.assumedHumanMinutesPerDecision} min</strong> human
            handling / decision
          </li>
          <li>
            at <strong>{usd(roi.assumptions.assumedHumanHourlyUsd)}/hr</strong> →{' '}
            {usd(roi.humanCostPerDecisionUsd)}/decision
          </li>
          <li>
            agent cost <strong>{usd(roi.agentCostPerDecisionUsd)}/decision</strong> → delta{' '}
            {usd(roi.costDeltaPerDecisionUsd)}
          </li>
          <li>
            × <strong>{roi.shadowDecisionVolume}</strong> Shadow-task decisions
          </li>
        </ul>
        <p className="roi-foot">{roi.label}. Not banked savings.</p>
      </div>
    </section>
  );
}

// ── Guardrails & Safety ──────────────────────────────────────────────────────
function GuardrailsSection({ safety }: { safety: SafetyView }) {
  const { events, suspended } = safety;
  return (
    <section className="pillar" data-section="guardrails">
      <h2>{SECTION_TITLE.guardrails}</h2>
      {events.length === 0 && suspended.length === 0 ? (
        <p className="empty">No guardrail trips or signal-loss events — all clear.</p>
      ) : (
        <>
          {suspended.length > 0 ? (
            <div className="suspended-banner">
              {suspended.length} task{suspended.length === 1 ? '' : 's'} currently SUSPENDED:{' '}
              {suspended.map((s) => `${s.agentKey}·${s.taskKey}`).join(', ')}
            </div>
          ) : null}
          <ul className="feed">
            {[...events].reverse().map((e, i) => (
              <li key={i} className={`feed-row trigger-${e.trigger.toLowerCase()}`} data-trigger={e.trigger}>
                <span className="t-agent">
                  {e.agentKey}·{e.taskKey}
                </span>
                <span className={`t-trigger trig-${e.trigger.toLowerCase()}`}>{e.trigger}</span>
                <span className="t-move">
                  {e.fromMode}→{e.toMode}
                </span>
                <span className="t-status">{e.status}</span>
                <span className="t-reason">{e.reason}</span>
                <span className="t-at">{e.at}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// ── Identity & Registry ──────────────────────────────────────────────────────
function fmtDate(s: string | null): string {
  return s === null ? '—' : new Date(s).toISOString().slice(0, 10);
}

function RegistrySection({ agents }: { agents: RegistryAgentRow[] }) {
  return (
    <section className="pillar" data-section="registry">
      <h2>{SECTION_TITLE.registry}</h2>
      {agents.length === 0 ? (
        <p className="empty">No agents discovered yet.</p>
      ) : (
        <table className="registry">
          <thead>
            <tr>
              <th>agent</th>
              <th>identity</th>
              <th>first seen</th>
              <th>last seen</th>
              <th>tasks</th>
              <th>decisions</th>
              <th>source</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.agentKey}>
                <td className="agent-key">{a.agentKey}</td>
                <td>
                  <span className={`id-state id-${a.identityState.toLowerCase()}`}>
                    {a.identityState}
                  </span>
                </td>
                <td>{fmtDate(a.firstSeen)}</td>
                <td>{fmtDate(a.lastSeen)}</td>
                <td>{a.taskCount}</td>
                <td>{a.decisionCount}</td>
                <td className="src">{a.sources.length > 0 ? a.sources.join(', ') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export { attentionFor };
