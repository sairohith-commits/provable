'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AgentRow, OverviewData, Transition } from '@/lib/types';
import { ReadinessLadder } from './readiness-ladder';

const PERSONAS = ['All', 'CTO', 'COO', 'CFO', 'Legal'] as const;
type Persona = (typeof PERSONAS)[number];

const POLL_MS = 4000;

export function OverviewClient({ initial }: { initial: OverviewData }) {
  const [data, setData] = useState<OverviewData>(initial);
  const [persona, setPersona] = useState<Persona>('All');
  const [pending, setPending] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/overview', { cache: 'no-store' });
    if (res.ok) setData((await res.json()) as OverviewData);
  }, []);

  // Polling so a running climb visibly updates (no SSE).
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

  const pendingPromotions = data.transitions.filter((t) => t.status === 'PENDING_APPROVAL');

  return (
    <div className="overview">
      <nav className="persona-lens" aria-label="persona lens (content lands in 7b)">
        {PERSONAS.map((p) => (
          <button key={p} className={p === persona ? 'lens active' : 'lens'} onClick={() => setPersona(p)}>
            {p}
          </button>
        ))}
      </nav>

      <section className="pillar">
        <h2>Readiness</h2>
        {data.agents.length === 0 ? (
          <p className="empty">No agents reporting yet.</p>
        ) : (
          <ul className="agent-list">
            {data.agents.map((a: AgentRow) => {
              const awaiting = pendingPromotions.some(
                (t) => t.agentKey === a.agentKey && t.taskKey === a.taskKey,
              );
              return (
                <li key={`${a.agentKey}:${a.taskKey}`} className="agent-row glass">
                  <div className="agent-id">
                    <span className="agent-key">{a.agentKey}</span>
                    <span className="task-key">{a.taskKey}</span>
                  </div>
                  <ReadinessLadder score={a.score} effectiveMode={a.effectiveMode} />
                  {awaiting ? (
                    <button
                      className="approve"
                      disabled={pending === `${a.agentKey}:${a.taskKey}`}
                      onClick={() => approve(a.agentKey, a.taskKey)}
                    >
                      {pending === `${a.agentKey}:${a.taskKey}` ? 'Approving…' : 'Approve promotion'}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="pillar">
        <h2>Governance</h2>
        {data.transitions.length === 0 ? (
          <p className="empty">No transitions yet.</p>
        ) : (
          <ul className="feed">
            {[...data.transitions].reverse().map((t: Transition, i) => (
              <li key={i} className={`feed-row status-${t.status.toLowerCase()}`}>
                <span className="t-agent">{t.agentKey}·{t.taskKey}</span>
                <span className="t-move">
                  {t.fromMode}→{t.toMode}
                </span>
                <span className="t-dir">{t.direction}</span>
                <span className="t-status">{t.status}</span>
                <span className="t-trigger">{t.trigger}</span>
                {t.approver ? <span className="t-approver">✓ {t.approver}</span> : null}
                <span className="t-at">{t.at}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
