import type { AutonomyMode, GovernanceStatus, TaskGovernanceView } from '@provable/contracts';

// Pure presentational helpers for the fleet read-model (Phase U2). NO data logic — these decide
// ONLY how a TaskGovernanceView renders. Node-testable (web vitest is node env); the components
// render their output verbatim. Imports only @provable/contracts types (web-only-contracts).

export type ChipTone = 'info' | 'neutral' | 'muted' | 'observe' | 'warning' | 'danger';
export type ChipIcon = 'arrow-up' | 'hand-stop' | 'check' | 'eye' | 'alert-triangle' | 'ban';

export interface ChipSpec {
  readonly tone: ChipTone;
  readonly icon: ChipIcon;
}

/** Closed map over GovernanceStatus — a typed Record is compile-time exhaustive (a missing or
 *  extra key is a type error), so a free-string status can never leak into the chip. */
export const CHIP_SPEC: Record<GovernanceStatus, ChipSpec> = {
  PROMOTABLE: { tone: 'info', icon: 'arrow-up' },
  HELD: { tone: 'neutral', icon: 'hand-stop' },
  AT_LEVEL: { tone: 'muted', icon: 'check' },
  OBSERVING: { tone: 'observe', icon: 'eye' }, // informational; no action affordance
  DEGRADED: { tone: 'warning', icon: 'alert-triangle' },
  SUSPENDED: { tone: 'danger', icon: 'ban' },
};

export function bandLabel(mode: AutonomyMode | null): string {
  switch (mode) {
    case 'SHADOW':
      return 'Shadow';
    case 'CO_PILOT':
      return 'Co-Pilot';
    case 'SOLO':
      return 'Solo';
    case 'OBSERVING':
      return 'Observing';
    case 'SUSPENDED':
      return 'Suspended';
    case 'RETIRED':
      return 'Retired';
    default:
      return '—';
  }
}

/** Chip text. Exhaustive switch over the closed status set (no default → compile error if a
 *  member is added without handling it). */
export function chipLabel(task: TaskGovernanceView): string {
  switch (task.status) {
    case 'PROMOTABLE':
      return `promotable to ${bandLabel(task.headroomTo)}`;
    case 'HELD':
      return `held at ${bandLabel(task.effectiveMode)} · manual`;
    case 'AT_LEVEL':
      return 'at level';
    case 'OBSERVING':
      return 'observe-only';
    case 'DEGRADED':
      return task.score === null ? 'unscored' : 'signal lost · demoted';
    case 'SUSPENDED':
      // Read the cause: a manual kill-switch (SUSPEND) must NOT read as a guardrail trip.
      if (task.suspendTrigger === 'SUSPEND') return 'suspended · manual';
      if (task.suspendTrigger === 'GUARDRAIL') return 'suspended · guardrail';
      if (task.suspendTrigger === 'DRIFT') return 'suspended · drift';
      return 'suspended';
  }
}

/**
 * The single action a row may offer. The `approve` kind is returned ONLY when
 * `actionAvailable === true` (and the viewer can approve) — so the approve affordance is
 * structurally impossible to produce for any non-actionable task.
 */
export type RowAction =
  | { readonly kind: 'approve'; readonly label: string }
  | { readonly kind: 'review'; readonly label: string }
  | { readonly kind: 'link'; readonly label: string }
  | null;

export function rowAction(task: TaskGovernanceView, canApprove: boolean): RowAction {
  if (task.actionAvailable) {
    // The ONLY branch that can yield an approve affordance. UX-gated by canApprove; the API is
    // authoritative regardless.
    return canApprove ? { kind: 'approve', label: 'Review promotion' } : null;
  }
  // actionAvailable === false ⇒ NEVER an approve. Quiet, non-actioning affordances only.
  switch (task.status) {
    case 'HELD':
      return { kind: 'review', label: 'Review' };
    case 'DEGRADED':
      return { kind: 'link', label: 'details' };
    case 'SUSPENDED':
      return { kind: 'link', label: 'incident' };
    default:
      return null; // AT_LEVEL (and a PROMOTABLE with no live action) → nothing
  }
}

export interface LadderGeometry {
  readonly dot: number | null; // readiness score position (0–100); null ⇒ no dot
  readonly ring: number | null; // effectiveMode band-center; null ⇒ no ring (suspended/observing)
  readonly lock: boolean; // danger lock overlay (suspended)
  readonly dimmed: boolean; // bar dimmed (unscored)
  readonly zones: { readonly shadow: number; readonly copilot: number; readonly solo: number };
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/** effectiveMode → band-center % (Shadow ~25, Co-Pilot ~65, Solo ~90). */
function ringCenter(mode: AutonomyMode): number | null {
  switch (mode) {
    case 'SHADOW':
      return 25;
    case 'CO_PILOT':
      return 65;
    case 'SOLO':
      return 90;
    default:
      return null; // OBSERVING / RETIRED / SUSPENDED have no operating ring
  }
}

export function ladderGeometry(
  score: number | null,
  effectiveMode: AutonomyMode,
  status: GovernanceStatus,
): LadderGeometry {
  const lock = status === 'SUSPENDED';
  return {
    dot: score === null ? null : clampPct(score),
    ring: lock ? null : ringCenter(effectiveMode), // suspended suppresses the ring
    lock,
    dimmed: score === null,
    zones: { shadow: 50, copilot: 30, solo: 20 }, // visual widths: 0–50 / 50–80 / 80–100
  };
}

// ── Grouping by agent ───────────────────────────────────────────────────────────
const SEVERITY: Record<GovernanceStatus, number> = {
  SUSPENDED: 6,
  DEGRADED: 5,
  HELD: 4,
  PROMOTABLE: 3,
  AT_LEVEL: 2,
  OBSERVING: 1, // benign/informational — sorts below everything actionable
};

export interface AgentGroup {
  readonly agentKey: string;
  readonly tasks: readonly TaskGovernanceView[];
  readonly worst: GovernanceStatus;
  readonly count: number;
}

export function groupByAgent(tasks: readonly TaskGovernanceView[]): AgentGroup[] {
  const byAgent = new Map<string, TaskGovernanceView[]>();
  for (const t of tasks) {
    const arr = byAgent.get(t.agentKey);
    if (arr) arr.push(t);
    else byAgent.set(t.agentKey, [t]);
  }
  const groups: AgentGroup[] = [];
  for (const [agentKey, list] of byAgent) {
    // Seed with the first task's status (a group always has ≥1) so an all-OBSERVING agent
    // resolves to OBSERVING, not the old AT_LEVEL floor.
    const worst = list.reduce<GovernanceStatus>(
      (w, t) => (SEVERITY[t.status] > SEVERITY[w] ? t.status : w),
      list[0]!.status,
    );
    groups.push({ agentKey, tasks: list, worst, count: list.length });
  }
  // Most urgent agent first; stable by agentKey.
  groups.sort((a, b) => SEVERITY[b.worst] - SEVERITY[a.worst] || a.agentKey.localeCompare(b.agentKey));
  return groups;
}

// ── Work-queue filter (Phase U5) ──────────────────────────────────────────────────
// The "Promotable" and "Needs attention" KPI counters double as work queues over the
// readiness list. PURE: each queue maps to the CLOSED set of statuses it surfaces, so the
// filter can never drift from the counter it represents. `null` ⇒ no filter (show everything).
export type QueueFilter = 'promotable' | 'attention' | null;
export type QueueKind = Exclude<QueueFilter, null>;

const QUEUE_STATUSES: Record<QueueKind, ReadonlySet<GovernanceStatus>> = {
  promotable: new Set<GovernanceStatus>(['PROMOTABLE']),
  attention: new Set<GovernanceStatus>(['DEGRADED', 'SUSPENDED']),
};

/** Tasks visible under the selected queue. `null` ⇒ all tasks (a fresh copy, never mutated). */
export function filterTasks(
  tasks: readonly TaskGovernanceView[],
  filter: QueueFilter,
): TaskGovernanceView[] {
  if (filter === null) return [...tasks];
  const allowed = QUEUE_STATUSES[filter];
  return tasks.filter((t) => allowed.has(t.status));
}

/** Toggle semantics: clicking the active counter clears it; otherwise select the clicked one. */
export function toggleFilter(current: QueueFilter, clicked: QueueKind): QueueFilter {
  return current === clicked ? null : clicked;
}

/** Honest empty-state copy for a filtered queue. `null` (unfiltered) has no queue-specific copy. */
export function queueEmptyCopy(filter: QueueFilter): string | null {
  switch (filter) {
    case 'promotable':
      return 'Nothing ready to advance right now.';
    case 'attention':
      return 'No agents need attention.';
    default:
      return null;
  }
}
