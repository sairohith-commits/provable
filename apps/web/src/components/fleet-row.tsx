import type { TaskGovernanceView } from '@provable/contracts';
import { rowAction } from '@/lib/fleet-view';
import { ModeChip } from './mode-chip';
import { ReadinessLadder } from './readiness-ladder';
import { StatusChip } from './status-chip';

/**
 * One fleet task row (Phase U2): label · ladder · status chip · reasonNote · action. Renders a
 * TaskGovernanceView verbatim — no data logic. The approve affordance exists ONLY inside the
 * `rowAction` 'approve' branch, which is reachable only when `actionAvailable === true` — so it
 * is structurally impossible to render an approve button for a non-actionable task.
 */
export function FleetRow({
  task,
  canApprove,
  canFreeSet,
  canSuspend,
  busy,
  onApprove,
  onSetMode,
  onSuspend,
  onResume,
}: {
  task: TaskGovernanceView;
  canApprove: boolean;
  canFreeSet: boolean;
  canSuspend: boolean;
  busy: boolean;
  onApprove: (agentKey: string, taskKey: string) => void;
  onSetMode: (task: TaskGovernanceView) => void;
  onSuspend: (task: TaskGovernanceView) => void;
  onResume: (task: TaskGovernanceView) => void;
}) {
  const action = rowAction(task, canApprove);
  // Free-set is available for operating rows (not terminal/retired). The HELD "Review" link also
  // opens the free-set panel. data-set-mode is NEVER data-approve → integrity is preserved.
  const canOverride = canFreeSet && task.effectiveMode !== 'RETIRED';
  // Kill-switch affordances (UX-only; the API enforces suspend_agent). Suspend a LIVE row
  // (OBSERVING + operating bands); Resume a SUSPENDED row. RETIRED is terminal — neither.
  const isLive =
    task.effectiveMode === 'OBSERVING' ||
    task.effectiveMode === 'SHADOW' ||
    task.effectiveMode === 'CO_PILOT' ||
    task.effectiveMode === 'SOLO';
  const showSuspend = canSuspend && isLive;
  const showResume = canSuspend && task.effectiveMode === 'SUSPENDED';
  return (
    <li className="fleet-row glass" data-task={`${task.agentKey}:${task.taskKey}`} data-status={task.status}>
      <ModeChip mode={task.effectiveMode} status={task.status} />

      <div className="fleet-id">
        <span className="agent-key">{task.agentKey}</span>
        <span className="task-key">{task.taskKey}</span>
      </div>

      <ReadinessLadder
        score={task.score}
        impliedBand={task.impliedBand}
        effectiveMode={task.effectiveMode}
        status={task.status}
      />

      {/* IBM Plex Mono readiness score; null renders N/A (never 0) — honesty preserved. */}
      <span className="fleet-score" data-score data-na={task.score === null} title="readiness score">
        {task.score === null ? 'N/A' : task.score.toFixed(1)}
      </span>

      <StatusChip task={task} />

      <p className="reason-note" data-reason-note>
        {task.reasonNote}
      </p>

      <div className="fleet-action">
        {action === null ? null : action.kind === 'approve' ? (
          <button
            className="approve"
            data-approve
            disabled={busy}
            onClick={() => onApprove(task.agentKey, task.taskKey)}
          >
            {busy ? 'Working…' : action.label}
          </button>
        ) : action.kind === 'review' ? (
          // HELD → "Review" opens the free-set panel (never an approve).
          <button className="row-link" data-row-link="review" onClick={() => onSetMode(task)}>
            {action.label}
          </button>
        ) : (
          // DEGRADED / SUSPENDED → quiet detail link. Never approve.
          <span className="row-link" data-row-link={action.kind} role="link" tabIndex={0}>
            {action.label}
          </span>
        )}
        {canOverride ? (
          <button className="row-link" data-set-mode onClick={() => onSetMode(task)}>
            Set mode
          </button>
        ) : null}
        {showSuspend ? (
          <button
            className="row-link danger"
            data-suspend
            title="Record an audited suspend. Advisory in Phase 1 — not yet enforced at the gateway."
            onClick={() => onSuspend(task)}
          >
            Suspend
          </button>
        ) : null}
        {showResume ? (
          <button className="row-link" data-resume onClick={() => onResume(task)}>
            Resume
          </button>
        ) : null}
        {task.status === 'SUSPENDED' ? (
          <span
            className="advisory-tag"
            data-advisory-tag
            title="Suspend is recorded & audited, but not yet enforced at the gateway (Phase 2). The agent is not hard-stopped."
          >
            advisory
          </span>
        ) : null}
      </div>
    </li>
  );
}
