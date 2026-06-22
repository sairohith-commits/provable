'use client';

import { type Role, can } from '@provable/contracts';
import { useCallback, useEffect, useState } from 'react';
import { anthropicGatewayRecipe, maskedKey, quickstart } from '@/lib/connect';
import type { OverviewData } from '@/lib/types';

const POLL_MS = 4000;

export function ConnectClient({
  apiUrl,
  keyPrefix,
  initialAgentCount,
  role,
}: {
  apiUrl: string;
  keyPrefix: string | null;
  initialAgentCount: number;
  role: Role;
}) {
  // UX-only: the API enforces manage_keys on rotate regardless of this.
  const canManageKeys = can(role, 'manage_keys');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [connectedAgent, setConnectedAgent] = useState<string | null>(null);
  const [agentCount, setAgentCount] = useState(initialAgentCount);
  // Tier-1 Anthropic gateway key (Phase O2): bound to an agent×task, shown once.
  const [gwAgent, setGwAgent] = useState('my-agent');
  const [gwTask, setGwTask] = useState('chat');
  const [gwKey, setGwKey] = useState<string | null>(null);
  const [gwMinting, setGwMinting] = useState(false);
  const [gwError, setGwError] = useState<string | null>(null);

  // Live onboarding beat: poll the registry; flip waiting → connected when an agent appears.
  const poll = useCallback(async () => {
    const res = await fetch('/api/overview', { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as OverviewData;
    setAgentCount(data.registry.length);
    if (data.registry.length > 0) {
      const newest = [...data.registry].sort((a, b) =>
        (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''),
      )[0];
      setConnectedAgent(newest?.agentKey ?? null);
    } else {
      setConnectedAgent(null);
    }
  }, []);

  useEffect(() => {
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  const rotate = useCallback(async () => {
    setRotating(true);
    setError(null);
    try {
      const res = await fetch('/api/key-rotate', { method: 'POST' });
      if (!res.ok) {
        setError('Rotate failed — are you signed in with an org?');
        return;
      }
      const body = (await res.json()) as { key: string };
      setNewKey(body.key);
      setCopied(false);
    } finally {
      setRotating(false);
    }
  }, []);

  const mintGateway = useCallback(async () => {
    setGwMinting(true);
    setGwError(null);
    try {
      const res = await fetch('/api/gateway-key', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentKey: gwAgent, taskKey: gwTask }),
      });
      if (!res.ok) {
        setGwError('Could not mint a gateway key — are you an Owner?');
        return;
      }
      const body = (await res.json()) as { key: string };
      setGwKey(body.key);
    } finally {
      setGwMinting(false);
    }
  }, [gwAgent, gwTask]);

  const copy = useCallback(async () => {
    if (newKey === null) return;
    try {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, [newKey]);

  const snippetKey = newKey ?? '<YOUR_API_KEY>';

  return (
    <div className="connect">
      <section className="pillar">
        <h2>Connect an agent</h2>
        <p className="connect-lead">
          Provable <strong>governs agents it doesn&apos;t own</strong> — there is nothing to create.
          Wire your agent to the SDK and it appears here as it reports decisions. Your decision data
          stays in your tenant.
        </p>

        <div className="maturity">
          <span className="mat-step"><strong>Observe</strong> — activity &amp; cost, no score yet</span>
          <span className="mat-arrow">→</span>
          <span className="mat-step"><strong>Score</strong> — readiness once verdicts/outcomes flow</span>
          <span className="mat-arrow">→</span>
          <span className="mat-step"><strong>Govern</strong> — gated promotion, auto-demotion</span>
        </div>
      </section>

      <section className="pillar">
        <h3>API key</h3>
        <div className="key-row glass">
          <code className="key-prefix" data-key-prefix>
            {maskedKey(keyPrefix)}
          </code>
          {canManageKeys ? (
            <button className="approve" onClick={rotate} disabled={rotating}>
              {rotating ? 'Rotating…' : 'Rotate key'}
            </button>
          ) : null}
        </div>
        <p className="disclosure">
          The existing key is hashed at rest and cannot be shown again. Rotating reveals a new key
          <strong> once</strong> and <strong>invalidates the old key immediately</strong>.
        </p>
        {error ? <p className="connect-error">{error}</p> : null}
      </section>

      <section className="pillar">
        <h3>SDK quickstart</h3>
        <pre className="quickstart" data-quickstart>
          <code>{quickstart(apiUrl, snippetKey)}</code>
        </pre>
        <p className="disclosure">
          Python SDK over HTTP — the same machine contract the dashboard reads. Prefer{' '}
          <strong>zero code</strong>? The Anthropic gateway below needs no SDK changes.
        </p>
      </section>

      <section className="pillar" data-tier1-anthropic>
        <h3>Tier 1 — Anthropic gateway (zero code)</h3>
        <p className="connect-lead">
          Repoint your agent&apos;s Anthropic <code>base_url</code> to Provable and keep using your{' '}
          <strong>own</strong> Anthropic key — Provable forwards it upstream and{' '}
          <strong>never stores it</strong>. You get real USD cost + activity. Readiness stays{' '}
          <strong>N/A</strong> (Observe-only): a gateway agent is never promotable until verdicts
          flow via the SDK.
        </p>
        {canManageKeys ? (
          <div className="key-row glass">
            <input
              className="gw-input"
              aria-label="agent key"
              value={gwAgent}
              onChange={(e) => setGwAgent(e.target.value)}
              data-gw-agent
            />
            <input
              className="gw-input"
              aria-label="task key"
              value={gwTask}
              onChange={(e) => setGwTask(e.target.value)}
              data-gw-task
            />
            <button className="approve" onClick={mintGateway} disabled={gwMinting} data-gw-mint>
              {gwMinting ? 'Generating…' : 'Generate gateway key'}
            </button>
          </div>
        ) : (
          <p className="disclosure">Only an Owner can mint a gateway key.</p>
        )}
        {gwError ? <p className="connect-error">{gwError}</p> : null}
        <pre className="quickstart" data-anthropic-recipe>
          <code>{anthropicGatewayRecipe(apiUrl, gwKey ?? '<YOUR_GATEWAY_KEY>')}</code>
        </pre>
        {gwKey !== null ? (
          <p className="disclosure" data-gw-key-once>
            Your gateway key is shown <strong>once</strong>, embedded in the snippet above. Copy it
            now — it is hashed at rest and cannot be shown again.
          </p>
        ) : null}
      </section>

      <section className="pillar">
        <h3>First signal</h3>
        {connectedAgent !== null ? (
          <div className="connected glass" data-connected>
            ✓ <strong>{connectedAgent}</strong> connected — {agentCount} agent
            {agentCount === 1 ? '' : 's'} reporting. Open the Overview to watch it climb.
          </div>
        ) : (
          <div className="waiting glass" data-waiting>
            <span className="pulse" /> Waiting for your first decision…
          </div>
        )}
      </section>

      {newKey !== null ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal glass" data-rotate-modal>
            <h3>Your new API key</h3>
            <p className="modal-warn">
              Copy it now — it <strong>won&apos;t be shown again</strong>. This{' '}
              <strong>invalidated the old key</strong>.
            </p>
            <code className="new-key" data-new-key>
              {newKey}
            </code>
            <div className="modal-actions">
              <button className="approve" onClick={copy}>
                {copied ? 'Copied ✓' : 'Copy key'}
              </button>
              <button className="lens" onClick={() => setNewKey(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
