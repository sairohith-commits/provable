'use client';

import type { TaskGovernanceView } from '@provable/contracts';
import { useEffect, useState } from 'react';
import { Sheet } from './ui/sheet';

// Free-set (MANUAL_OVERRIDE) slide-over (Phase U3). effectiveMode-only — posts NO score. The copy
// states the invariants plainly: an override is not a safety off-switch.
export function FreeSetPanel({
  task,
  actor,
  onClose,
  onDone,
}: {
  task: TaskGovernanceView | null;
  actor: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState('SHADOW');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form whenever a new row opens the panel.
  useEffect(() => {
    if (task) {
      setMode(task.effectiveMode === 'SUSPENDED' || task.effectiveMode === 'RETIRED' ? 'SHADOW' : task.effectiveMode);
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
      const res = await fetch('/api/set-mode', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // effectiveMode-only — NO score field is ever sent.
        body: JSON.stringify({ agentKey: task.agentKey, taskKey: task.taskKey, mode, reason: reason.trim() }),
      });
      if (!res.ok) {
        setError('Set-mode failed — you may not have permission.');
        return;
      }
      onDone(); // refresh the fleet so the row recomputes (set below implied band → HELD)
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={task !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Free-set mode"
      description={task ? `${task.agentKey} · ${task.taskKey}` : undefined}
    >
      <label className="field">
        <span className="field-label">Target mode</span>
        <select value={mode} onChange={(e) => setMode(e.target.value)} data-fs-mode>
          <option value="SHADOW">Shadow</option>
          <option value="CO_PILOT">Co-Pilot</option>
          <option value="SOLO">Solo</option>
        </select>
      </label>

      <label className="field">
        <span className="field-label">Reason (required)</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why are you overriding the earned ladder?"
          rows={3}
          data-fs-reason
        />
      </label>

      <p className="field-actor" data-fs-actor>
        Acting as <strong>{actor}</strong>
      </p>

      <p className="fs-invariants" data-fs-invariants>
        Sets <strong>operating mode only</strong> — the earned readiness score is untouched. This
        agent remains <strong>auto-demotable</strong> on drift, guardrail, or score drop. An
        override is <strong>not</strong> a safety off-switch.
      </p>

      {error !== null ? <p className="auth-error">{error}</p> : null}

      <div className="sheet-actions">
        <button className="approve" disabled={!canSubmit} onClick={submit} data-fs-submit>
          {busy ? 'Setting…' : 'Set mode'}
        </button>
      </div>
    </Sheet>
  );
}
