'use client';

import { type Role, can } from '@provable/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CostView,
  FleetKpis,
  OverviewData,
  RegistryAgentRow,
  SafetyView,
  SummaryView,
  TransitionView,
  VerdictMix,
  VisibilityRow,
} from '@/lib/types';
import type { TaskGovernanceView } from '@provable/contracts';
import { PERSONAS, type Persona, type SectionKey } from '@/lib/view-helpers';
import { type AgentGroup, groupByAgent } from '@/lib/fleet-view';
import { relativeTime, shortSubject } from '@/lib/format';
import { FleetRow } from './fleet-row';
import { FreeSetPanel } from './free-set-panel';
import { PillarShell } from './pillar-shell';
import { StatusChip } from './status-chip';

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

// KPI strip — the three governance counts bind to the reconciled fleet KPIs (so they can never
// disagree with the rows); cost + ROI stay as-is.
function KpiRow({ summary, kpis }: { summary: SummaryView; kpis: FleetKpis }) {
  const s = summary;
  const roiAssumptions = `assumes ${s.roi.assumptions.assumedHumanMinutesPerDecision} min/decision @ ${usd(
    s.roi.assumptions.assumedHumanHourlyUsd,
  )}/hr · ${s.roi.shadowDecisionVolume} Shadow decisions`;
  return (
    <div className="kpi-row" data-kpi-row>
      <KpiCard
        label="Promotable"
        value={String(kpis.promotableNow)}
        tone={kpis.promotableNow > 0 ? 'attention' : undefined}
      />
      <KpiCard
        label="Needs attention"
        value={String(kpis.needsAttention)}
        tone={kpis.needsAttention > 0 ? 'attention' : undefined}
      />
      <KpiCard label="Governed" value={String(kpis.tasksGoverned)} sub={`${s.agentsTotal} agents`} />
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

export function OverviewClient({ initial, role }: { initial: OverviewData; role: Role }) {
  const [data, setData] = useState<OverviewData>(initial);
  const [persona, setPersona] = useState<Persona>('All');
  const [pending, setPending] = useState<string | null>(null);
  // UX-only (NOT the security boundary): hide the approve control for roles without the
  // permission. The API independently enforces approve_transition on every call.
  const canApprove = can(role, 'approve_transition');
  const canFreeSet = can(role, 'free_set_mode');
  const [override, setOverride] = useState<TaskGovernanceView | null>(null);

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

  const groups = useMemo(() => groupByAgent(data.fleet.tasks), [data.fleet.tasks]);
  const attentionCount = data.fleet.kpis.needsAttention;

  // Overview = the Readiness cockpit (KPIs + persona pills + fleet rows) with the Governance
  // transition log below as collapsible history. The other pillars live on their own routes (U3).
  return (
    <PillarShell role={role}>
      <div className="overview">
        <KpiRow summary={data.summary} kpis={data.fleet.kpis} />

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

        <ReadinessSection
          groups={groups}
          pending={pending}
          onApprove={approve}
          canApprove={canApprove}
          canFreeSet={canFreeSet}
          onSetMode={setOverride}
        />

        <details className="transition-history" data-transition-history>
          <summary>Transition history</summary>
          <GovernanceSection transitions={data.transitions} />
        </details>
      </div>

      <FreeSetPanel task={override} actor="you" onClose={() => setOverride(null)} onDone={refresh} />
    </PillarShell>
  );
}

// ── Readiness — fleet rows grouped by agent, fed from /overview/fleet (U2) ─────────
function ReadinessSection({
  groups,
  pending,
  onApprove,
  canApprove,
  canFreeSet,
  onSetMode,
}: {
  groups: AgentGroup[];
  pending: string | null;
  onApprove: (a: string, t: string) => void;
  canApprove: boolean;
  canFreeSet: boolean;
  onSetMode: (task: TaskGovernanceView) => void;
}) {
  return (
    <section className="pillar" data-section="readiness">
      <h2>{SECTION_TITLE.readiness}</h2>
      {groups.length === 0 ? (
        <p className="empty">No agents reporting yet.</p>
      ) : (
        groups.map((group) => (
          <div className="fleet-group" key={group.agentKey} data-agent-group={group.agentKey}>
            <header className="group-head">
              <span className="agent-key">{group.agentKey}</span>
              <span className="group-count">
                {group.count} task{group.count === 1 ? '' : 's'}
              </span>
              {/* worst-status summary for the agent */}
              <StatusChip task={{ ...group.tasks[0]!, status: group.worst, headroomTo: null }} />
            </header>
            <ul className="fleet-list">
              {group.tasks.map((task) => (
                <FleetRow
                  key={`${task.agentKey}:${task.taskKey}`}
                  task={task}
                  canApprove={canApprove}
                  canFreeSet={canFreeSet}
                  busy={pending === `${task.agentKey}:${task.taskKey}`}
                  onApprove={onApprove}
                  onSetMode={onSetMode}
                />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

// ── Governance (audit feed) ──────────────────────────────────────────────────
export function GovernanceSection({ transitions }: { transitions: TransitionView[] }) {
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
              {/* approver (approved a promotion) vs actor (authored an override) — never collapsed;
                  auto-demotions show neither. */}
              {t.approver ? (
                <span className="t-approver" data-approver>
                  ✓ approved by {t.approverDisplay ?? shortSubject(t.approver)}
                </span>
              ) : t.actor ? (
                <span className="t-actor" data-actor>
                  ✎ override by {t.actorDisplay ?? shortSubject(t.actor)}
                </span>
              ) : null}
              <span className="t-at" title={t.at}>
                {relativeTime(t.at)}
              </span>
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

const MIX_LEGEND: { cls: string; label: string }[] = [
  { cls: 'mix-accepted', label: 'Accepted' },
  { cls: 'mix-overridden', label: 'Overridden' },
  { cls: 'mix-escalated', label: 'Escalated' },
  { cls: 'mix-failed', label: 'Failed' },
  { cls: 'mix-pending', label: 'Pending' },
];

export function VisibilitySection({ rows }: { rows: VisibilityRow[] }) {
  return (
    <section className="pillar" data-section="visibility">
      <h2>{SECTION_TITLE.visibility}</h2>
      {rows.length > 0 ? (
        <ul className="mix-legend" data-mix-legend aria-label="verdict mix legend">
          {MIX_LEGEND.map((m) => (
            <li key={m.cls} className="mix-legend-item">
              <span className={`mix-swatch ${m.cls}`} aria-hidden />
              {m.label}
            </li>
          ))}
        </ul>
      ) : null}
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
export function CostSection({ cost }: { cost: CostView }) {
  const { org, roi } = cost;
  return (
    <section className="pillar" data-section="cost">
      <h2>{SECTION_TITLE.cost}</h2>

      {/* Honest empty-state: no cost signal → ONE line, not four broken "—" cards. */}
      {org.hasCostSignal ? (
        <div className="cost-summary glass">
          <div className="cost-metric">
            <span className="cost-num">{org.decisionCount}</span>
            <span className="cost-lbl">decisions</span>
          </div>
          <div className="cost-metric">
            <span className="cost-num">{usd(org.usd)}</span>
            <span className="cost-lbl">real agent cost</span>
          </div>
          <div className="cost-metric">
            <span className="cost-num">{org.tokens.toLocaleString()}</span>
            <span className="cost-lbl">tokens</span>
          </div>
          <div className="cost-metric">
            <span className="cost-num">{org.avgLatencyMs === null ? '—' : `${Math.round(org.avgLatencyMs)}ms`}</span>
            <span className="cost-lbl">avg latency</span>
          </div>
        </div>
      ) : (
        <p className="cost-empty disclosure" data-cost-empty>
          No cost signal reported yet — projection only.
        </p>
      )}

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
export function GuardrailsSection({ safety }: { safety: SafetyView }) {
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
                <span className="t-at" title={e.at}>
                  {relativeTime(e.at)}
                </span>
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

export function RegistrySection({ agents }: { agents: RegistryAgentRow[] }) {
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
