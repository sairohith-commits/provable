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
import type { SectionKey } from '@/lib/view-helpers';
import {
  type AgentGroup,
  type QueueFilter,
  type QueueKind,
  filterTasks,
  groupByAgent,
  queueEmptyCopy,
  toggleFilter,
} from '@/lib/fleet-view';
import { formatUsd, relativeTime, shortSubject } from '@/lib/format';
import { incidentSource, incidentSourceLabel } from '@/lib/guardrails-view';
import { EmptyState } from './empty-state';
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

// All agent-cost USD goes through the ONE shared formatter (lib/format.ts), which keeps
// sub-dollar real spend non-zero instead of rounding to a bare "$0".
const usd = formatUsd;

// ── KPI summary row (REAL counts or honest empty; NO compliance/score card) ───────
function KpiCard({
  label,
  value,
  sub,
  tone,
  title,
  onClick,
  selected,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'attention' | 'projection';
  title?: string;
  onClick?: () => void;
  selected?: boolean;
}) {
  const cls = `kpi glass${tone ? ` kpi-${tone}` : ''}${onClick ? ' kpi-filter' : ''}${
    selected ? ' kpi-selected' : ''
  }`;
  const body = (
    <>
      <span className="kpi-value">{value}</span>
      <span className="kpi-label">{label}</span>
      {sub ? <span className="kpi-sub">{sub}</span> : null}
    </>
  );
  // A clickable counter is a real button (keyboard + a11y); a static counter stays a div.
  if (onClick) {
    return (
      <button
        type="button"
        className={cls}
        title={title}
        data-kpi={label}
        data-selected={selected ? 'true' : undefined}
        aria-pressed={selected ?? false}
        onClick={onClick}
      >
        {body}
      </button>
    );
  }
  return (
    <div className={cls} title={title} data-kpi={label}>
      {body}
    </div>
  );
}

// KPI strip — the three governance counts bind to the reconciled fleet KPIs (so they can never
// disagree with the rows); cost + ROI stay as-is.
function KpiRow({
  summary,
  kpis,
  filter,
  onToggle,
}: {
  summary: SummaryView;
  kpis: FleetKpis;
  filter: QueueFilter;
  onToggle: (kind: QueueKind) => void;
}) {
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
        title="Filter the list to agents ready to advance"
        onClick={() => onToggle('promotable')}
        selected={filter === 'promotable'}
      />
      <KpiCard
        label="Needs attention"
        value={String(kpis.needsAttention)}
        tone={kpis.needsAttention > 0 ? 'attention' : undefined}
        title="Filter the list to agents that need attention"
        onClick={() => onToggle('attention')}
        selected={filter === 'attention'}
      />
      {/* "Tracked", not "Governed": kpis.tasksGoverned counts ALL task views (incl. observe-only
          gateway agents), so a governance label would over-claim. Stage-neutral, consistent with
          the Observe → Score → Govern framing on /connect. */}
      <KpiCard
        label="Tracked"
        value={String(kpis.tasksGoverned)}
        sub={`${s.agentsTotal} agents`}
        title="All agent×task pairs reporting (observe-only included) — not a governance count"
      />
      <KpiCard
        label="Token spend"
        value={s.hasCostSignal ? s.tokenSpend.toLocaleString() : '—'}
        sub={s.hasCostSignal ? (s.usdSpend > 0 ? usd(s.usdSpend) : 'USD N/A — unknown model') : 'no cost signal yet'}
      />
      {/* ROI depends on real agent cost. When tokens flowed but nothing priced (unknown model),
          the Token-spend sub shows "USD N/A" — the projection must agree, not assume $0. Same
          null gate as the Cost & ROI page. */}
      <KpiCard
        label="ROI projection"
        value={s.hasCostSignal && s.usdSpend === 0 ? 'N/A' : usd(s.roi.projectedSavingsIfPromotedUsd)}
        sub={s.hasCostSignal && s.usdSpend === 0 ? "can't compute — agent cost unknown" : 'projection · hover for assumptions'}
        tone="projection"
        title={roiAssumptions}
      />
    </div>
  );
}

export function OverviewClient({ initial, role }: { initial: OverviewData; role: Role }) {
  const [data, setData] = useState<OverviewData>(initial);
  // Work-queue filter (U5): the Promotable / Needs-attention counters select over the list.
  const [filter, setFilter] = useState<QueueFilter>(null);
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

  // The counters ARE the filter: group only the tasks in the selected work queue.
  const groups = useMemo(
    () => groupByAgent(filterTasks(data.fleet.tasks, filter)),
    [data.fleet.tasks, filter],
  );
  const onToggle = useCallback((kind: QueueKind) => setFilter((cur) => toggleFilter(cur, kind)), []);

  // Overview = the Readiness cockpit (KPI work-queue counters + fleet rows) with the Governance
  // transition log below as collapsible history. The other pillars live on their own routes (U3).
  return (
    <PillarShell role={role}>
      <div className="overview">
        <KpiRow summary={data.summary} kpis={data.fleet.kpis} filter={filter} onToggle={onToggle} />

        <ReadinessSection
          groups={groups}
          filter={filter}
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
  filter,
  pending,
  onApprove,
  canApprove,
  canFreeSet,
  onSetMode,
}: {
  groups: AgentGroup[];
  filter: QueueFilter;
  pending: string | null;
  onApprove: (a: string, t: string) => void;
  canApprove: boolean;
  canFreeSet: boolean;
  onSetMode: (task: TaskGovernanceView) => void;
}) {
  // Empty list: a filtered queue gets its own honest copy; the unfiltered list keeps the
  // "nothing reporting" message. (queueEmptyCopy returns null when filter === null.)
  const emptyCopy = queueEmptyCopy(filter) ?? 'No agents reporting yet.';
  return (
    <section className="pillar" data-section="readiness">
      <h2>{SECTION_TITLE.readiness}</h2>
      {groups.length === 0 ? (
        <EmptyState
          icon="agents"
          title={emptyCopy}
          action={filter ? undefined : { href: '/connect', label: 'Connect an agent' }}
          attrs={{ 'data-readiness-empty': filter ?? 'all' }}
        />
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
  const total = mix.ACCEPTED + mix.OVERRIDDEN + mix.ESCALATED + mix.FAILED + mix.PENDING + mix.OBSERVED;
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
      {seg(mix.OBSERVED, 'mix-observed', 'Observed')}
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
  // Observed = gateway/observe-only decisions with no verdict expected — distinct from Pending,
  // which is a decision genuinely awaiting a verdict.
  { cls: 'mix-observed', label: 'Observed' },
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
        <EmptyState
          icon="activity"
          title="No agent activity yet."
          action={{ href: '/connect', label: 'Connect an agent' }}
        />
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
  // Agent cost is unknown when tokens flowed but nothing priced (unknown model) — the exact case
  // the top "real agent cost" KPI shows N/A for. The ROI figures that DEPEND on agent cost
  // (per-decision agent cost, delta, projected total) must take the SAME null path and agree —
  // never coerce the missing cost to $0. Human cost is assumption-based, so it stays a number.
  const agentCostUnknown = org.hasCostSignal && org.usd === 0;
  const agentUsd = (n: number): string => (agentCostUnknown ? 'N/A' : usd(n));
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
            {/* Honest null: hasCostSignal can be true on tokens alone (unknown model → no USD).
                Show "N/A" rather than a misleading "$0.00" when no decision was priced. */}
            <span className="cost-num" title={org.usd > 0 ? undefined : 'USD unavailable — unknown model (tokens still tracked)'}>
              {org.usd > 0 ? usd(org.usd) : 'N/A'}
            </span>
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
        <EmptyState
          icon="cost"
          title="No cost signal reported yet — the projection below is a forecast, not banked savings."
          action={{ href: '/connect', label: 'Connect an agent' }}
          attrs={{ 'data-cost-empty': 'true' }}
        />
      )}

      {/* Shadow-counterfactual ROI — a PROJECTION, assumptions rendered on screen. */}
      <div className="roi glass" data-projection="true">
        <div className="roi-head">
          <span className="roi-tag">PROJECTION</span>
          <span className="roi-title">Proven savings if Shadow agents are promoted</span>
        </div>
        <div className="roi-figure" data-roi-figure>{agentUsd(roi.projectedSavingsIfPromotedUsd)}</div>
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
            agent cost <strong>{agentUsd(roi.agentCostPerDecisionUsd)}/decision</strong> → delta{' '}
            {agentUsd(roi.costDeltaPerDecisionUsd)}
          </li>
          <li>
            × <strong>{roi.shadowDecisionVolume}</strong> Shadow-task decisions
          </li>
        </ul>
        <p className="roi-foot">
          {agentCostUnknown
            ? "Can't compute — agent cost unavailable (unknown model). Tokens are tracked, but no USD price means no savings figure."
            : `${roi.label}. Not banked savings.`}
        </p>
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
        <EmptyState
          icon="safety-clear"
          title="No guardrail trips or signal-loss events — all clear."
        />
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
                {e.trigger === 'GUARDRAIL' ? (
                  <span
                    className={`t-source src-${incidentSource(e.actor)}`}
                    data-incident-source={incidentSource(e.actor)}
                  >
                    {incidentSourceLabel(e.actor)}
                  </span>
                ) : null}
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
        <EmptyState
          icon="registry"
          title="No agents discovered yet."
          action={{ href: '/connect', label: 'Connect an agent' }}
        />
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
