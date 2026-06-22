'use client';

import type { TaskGovernanceView } from '@provable/contracts';
import { useEffect, useState } from 'react';
import { Sheet } from './ui/sheet';

// Kill-switch slide-over (Phase 1). Suspend a live row or resume a SUSPENDED row, per-task or
// agent-wide. Reason is REQUIRED (same UX as free-set). The copy states the honest caveat:
// ADVISORY — the stop is recorded + audited, but NOT yet enforced at the gateway (Phase 2).
export function SuspendPanel({
  task,
  action,
  actor,
  onClose,
  onDone,
}: {
  task: TaskGovernanceView | null;
  action: 'suspend' | 'resume';
  actor: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [scope, setScope] = useState<'task' | 'agent'>('task');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form whenever a new row opens the panel.
  useEffect(() => {
    if (task) {
      setScope('task');
      setReason('');
      setError(null);
    }
  }, [task]);

  const canSubmit = task !== null && reason.trim().length > 0 && !busy;

  const submit = async () => {
    if (task === null || reason.trim().length === 0) return; // reason REQUIRED
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agentKey: task.agentKey,
          taskKey: scope === 'task' ? task.taskKey : null, // null ⇒ agent-wide
          reason: reason.trim(),
        }),
      });
      if (!res.ok) {
        setError(`${action === 'suspend' ? 'Suspend' : 'Resume'} failed — you may not have permission, or the state changed.`);
        return;
      }
      onDone(); // refresh the fleet so the row reflects the new state
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const verb = action === 'suspend' ? 'Suspend' : 'Resume';

  return (
    <Sheet
      open={task !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={verb}
      description={task ? `${task.agentKey} · ${task.taskKey}` : undefined}
    >
      <fieldset className="field" data-suspend-scope>
        <span className="field-label">Scope</span>
        <label className="radio">
          <input type="radio" name="scope" checked={scope === 'task'} onChange={() => setScope('task')} data-scope="task" />
          This task
        </label>
        <label className="radio">
          <input type="radio" name="scope" checked={scope === 'agent'} onChange={() => setScope('agent')} data-scope="agent" />
          Whole agent <span className="muted">({task?.agentKey}, all tasks)</span>
        </label>
      </fieldset>

      <label className="field">
        <span className="field-label">Reason (required)</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={action === 'suspend' ? 'Why are you suspending this agent?' : 'Why are you resuming?'}
          rows={3}
          data-suspend-reason
        />
      </label>

      <p className="field-actor" data-suspend-actor>
        Acting as <strong>{actor}</strong>
      </p>

      {action === 'resume' ? (
        <p className="fs-invariants" data-resume-note>
          Resume returns the agent to <strong>OBSERVING</strong> — it must <strong>re-earn</strong> its
          band through the gated ladder. Decision history is preserved; the score is recomputed.
        </p>
      ) : (
        <p className="fs-invariants" data-suspend-note>
          Suspend is <strong>recorded &amp; audited immediately</strong>.
        </p>
      )}

      <p className="advisory-note" data-advisory>
        <strong>Advisory:</strong> the stop is recorded and audited, but <strong>not yet enforced</strong> at
        the gateway (Phase 2). The agent is <strong>not</strong> hard-stopped — calls are not blocked yet.
      </p>

      {error !== null ? <p className="auth-error">{error}</p> : null}

      <div className="sheet-actions">
        <button className="approve" disabled={!canSubmit} onClick={submit} data-suspend-submit>
          {busy ? (action === 'suspend' ? 'Suspending…' : 'Resuming…') : verb}
        </button>
      </div>
    </Sheet>
  );
}
