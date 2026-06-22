'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

interface KeyRow {
  prefix: string;
  label: string | null;
  kind: 'SDK' | 'GATEWAY';
  agentKey?: string | null;
  taskKey?: string | null;
  createdAt: string;
}

// Org key management (mint / rotate / revoke) with the 7c show-once reveal. The API enforces
// manage_keys; this is the admin UI. canManage gates the controls (UX-only).
export function AdminKeys({ keys, canManage }: { keys: KeyRow[]; canManage: boolean }) {
  const router = useRouter();
  const [revealed, setRevealed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (fn: () => Promise<Response>, reveal: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fn();
        if (!res.ok) {
          setError('Action failed.');
          return;
        }
        if (reveal) {
          const body = (await res.json()) as { key?: string };
          if (body.key) setRevealed(body.key);
        }
        router.refresh();
      } finally {
        setBusy(false);
      }
    },
    [router],
  );

  const mint = () => run(() => fetch('/api/admin/keys', { method: 'POST', body: '{}' }), true);
  const rotate = () => run(() => fetch('/api/key-rotate', { method: 'POST' }), true);
  const revoke = (prefix: string) =>
    run(() => fetch(`/api/admin/keys/${encodeURIComponent(prefix)}`, { method: 'DELETE' }), false);

  return (
    <section className="pillar" data-section="keys">
      <h2>API keys</h2>
      {canManage ? (
        <div className="key-actions">
          <button className="approve" onClick={mint} disabled={busy} data-mint-key>
            Mint key
          </button>
          <button className="lens" onClick={rotate} disabled={busy} data-rotate-all>
            Rotate (replace all)
          </button>
        </div>
      ) : null}
      {error !== null && <p className="auth-error">{error}</p>}

      {/* KIND (gateway/sdk) and STATE are separate facets — never crammed into one column.
          listActive returns only non-revoked keys, so every row here is STATE = active; a
          revoked/rotated-away key is filtered out by the API and never appears. */}
      <ul className="key-list" data-key-list>
        {keys.map((k) => (
          <li key={k.prefix} className="key-row glass" data-key={k.prefix} data-key-kind={k.kind}>
            <code className="key-prefix">{`pvb_${k.prefix}_••••••••••••`}</code>
            <span className={`key-kind kind-${k.kind.toLowerCase()}`} data-key-kind-label>
              {k.kind === 'GATEWAY' ? 'gateway' : 'sdk'}
            </span>
            <span className="key-state state-active" data-key-state>
              active
            </span>
            {k.kind === 'GATEWAY' && k.agentKey ? (
              <span className="key-binding">
                {k.agentKey}
                {k.taskKey ? `·${k.taskKey}` : ''}
              </span>
            ) : null}
            {k.label ? <span className="key-label">{k.label}</span> : null}
            {canManage ? (
              <button className="lens" onClick={() => revoke(k.prefix)} disabled={busy}>
                Revoke
              </button>
            ) : null}
          </li>
        ))}
        {keys.length === 0 ? <li className="empty">No active keys.</li> : null}
      </ul>

      {revealed !== null ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal glass" data-key-reveal>
            <p>Copy this key now — it is shown once and cannot be retrieved again.</p>
            <code data-new-key>{revealed}</code>
            <button className="lens" onClick={() => setRevealed(null)}>
              Done
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
