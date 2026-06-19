'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  type ConnectorForm,
  type ValueMapRow,
  buildMapping,
  emptyForm,
  governLabel,
  mappingComplete,
  parseSample,
} from '@/lib/connectors-view';
import type { ConnectorRow } from '@/lib/api';

interface DryRun {
  ok: boolean;
  event?: unknown;
  governed?: boolean;
  error?: string;
}
interface PullSummary {
  received?: number;
  mapped?: number;
  governed?: number;
  observeOnly?: number;
  errors?: unknown[];
  error?: string;
}

const SAMPLE_PLACEHOLDER = `{
  "agent": "support-bot",
  "task": "triage",
  "id": "ticket-4821",
  "verdict": "approved",
  "outcome": "success",
  "confidence": 0.92
}`;

export function ConnectorsClient({ apiUrl }: { apiUrl: string }) {
  const [connectors, setConnectors] = useState<ConnectorRow[]>([]);
  const [form, setForm] = useState<ConnectorForm>(emptyForm());
  const [sampleText, setSampleText] = useState('');
  const [dry, setDry] = useState<DryRun | null>(null);
  // Source (pull) — the credential is WRITE-ONLY: typed here, sent on save, NEVER rendered back.
  const [sourceUrl, setSourceUrl] = useState('');
  const [authHeaderName, setAuthHeaderName] = useState('');
  const [authHeaderValue, setAuthHeaderValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pullingId, setPullingId] = useState<string | null>(null);
  const [pullSummary, setPullSummary] = useState<Record<string, PullSummary>>({});

  const set = <K extends keyof ConnectorForm>(k: K, v: ConnectorForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const refresh = useCallback(async () => {
    const res = await fetch('/api/connectors', { cache: 'no-store' });
    if (res.ok) setConnectors(((await res.json()) as { connectors: ConnectorRow[] }).connectors);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live dry-run — runs the REAL engine via the backend whenever the sample/mapping changes.
  useEffect(() => {
    const parsed = parseSample(sampleText);
    if (!parsed.ok || !mappingComplete(form)) {
      setDry(sampleText.trim().length > 0 && !parsed.ok ? { ok: false, error: 'sample is not valid JSON' } : null);
      return;
    }
    const handle = setTimeout(async () => {
      const res = await fetch('/api/connectors/dry-run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mapping: buildMapping(form), sample: parsed.value }),
      });
      setDry(res.ok ? ((await res.json()) as DryRun) : { ok: false, error: `dry-run failed: ${res.status}` });
    }, 350);
    return () => clearTimeout(handle);
  }, [form, sampleText]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const source =
        sourceUrl.trim().length > 0
          ? {
              url: sourceUrl.trim(),
              ...(authHeaderName.trim().length > 0 ? { authHeaderName: authHeaderName.trim() } : {}),
              ...(authHeaderValue.length > 0 ? { authHeaderValue } : {}),
            }
          : undefined;
      const res = await fetch('/api/connectors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: form.name.trim(), mapping: buildMapping(form), ...(source ? { source } : {}) }),
      });
      if (!res.ok) {
        setError('Save failed — check the mapping (name + agent/task/id paths required).');
        return;
      }
      setAuthHeaderValue(''); // write-only: clear after save, never echoed
      await refresh();
    } finally {
      setSaving(false);
    }
  }, [form, sourceUrl, authHeaderName, authHeaderValue, refresh]);

  const pull = useCallback(async (id: string) => {
    setPullingId(id);
    try {
      const res = await fetch(`/api/connectors/${id}/pull`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as PullSummary;
      setPullSummary((p) => ({ ...p, [id]: body }));
    } finally {
      setPullingId(null);
    }
  }, []);

  const updateRow = (which: 'verdictMap' | 'outcomeMap', i: number, patch: Partial<ValueMapRow>) =>
    setForm((f) => ({ ...f, [which]: f[which].map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const addRow = (which: 'verdictMap' | 'outcomeMap') =>
    setForm((f) => ({ ...f, [which]: [...f[which], { from: '', to: '' }] }));

  return (
    <div className="connectors" data-connectors>
      <section className="pillar">
        <h2>Connectors</h2>
        <p className="connect-lead">
          Map your existing logs to Provable primitives — no agent code. A record with a{' '}
          <strong>verdict</strong> is <strong>governed</strong> (scored); without one it is{' '}
          <strong>observe-only</strong>. The dry-run below uses the real ingestion engine.
        </p>
      </section>

      {connectors.length > 0 ? (
        <section className="pillar">
          <h3>Your connectors</h3>
          <ul className="member-list" data-connector-list>
            {connectors.map((c) => (
              <li key={c.id} className="member-row glass" data-connector={c.id}>
                <span className="member-email">{c.name}</span>
                <span className="member-status" data-status={c.enabled ? 'active' : 'invited'}>
                  {c.enabled ? 'enabled' : 'disabled'}
                </span>
                <span className="task-key">{c.sourceUrl ? 'push + pull' : 'push'}</span>
                {c.hasCredential ? <span className="task-key">credential: configured</span> : null}
                {c.sourceUrl ? (
                  <button className="lens" onClick={() => pull(c.id)} disabled={pullingId === c.id} data-pull={c.id}>
                    {pullingId === c.id ? 'Pulling…' : 'Pull now'}
                  </button>
                ) : null}
                {pullSummary[c.id] ? (
                  <span className="task-key" data-pull-summary={c.id}>
                    {pullSummary[c.id]!.error
                      ? `error: ${pullSummary[c.id]!.error}`
                      : `mapped ${pullSummary[c.id]!.mapped ?? 0} · governed ${pullSummary[c.id]!.governed ?? 0} · observe-only ${pullSummary[c.id]!.observeOnly ?? 0} · errors ${(pullSummary[c.id]!.errors ?? []).length}`}
                  </span>
                ) : null}
                <span className="task-key">
                  POST {apiUrl}/connectors/{c.id}/ingest
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="pillar">
        <h3>New connector</h3>
        <div className="conn-grid">
          <label className="conn-field">
            <span>Name</span>
            <input className="gw-input" value={form.name} onChange={(e) => set('name', e.target.value)} data-f="name" />
          </label>
          <label className="conn-field">
            <span>agentKey path</span>
            <input className="gw-input" value={form.agentKey} onChange={(e) => set('agentKey', e.target.value)} data-f="agentKey" />
          </label>
          <label className="conn-field">
            <span>taskKey path</span>
            <input className="gw-input" value={form.taskKey} onChange={(e) => set('taskKey', e.target.value)} data-f="taskKey" />
          </label>
          <label className="conn-field">
            <span>externalRef (id) path</span>
            <input className="gw-input" value={form.externalRef} onChange={(e) => set('externalRef', e.target.value)} data-f="externalRef" />
          </label>
          <label className="conn-field">
            <span>confidence path (optional)</span>
            <input className="gw-input" value={form.confidence} onChange={(e) => set('confidence', e.target.value)} data-f="confidence" />
          </label>
          <label className="conn-field">
            <span>timestamp path (optional)</span>
            <input className="gw-input" value={form.timestamp} onChange={(e) => set('timestamp', e.target.value)} data-f="timestamp" />
          </label>
        </div>

        <div className="conn-grid">
          <div className="conn-field">
            <span>verdict path + value-map (→ governed)</span>
            <input className="gw-input" placeholder="e.g. verdict" value={form.verdictPath} onChange={(e) => set('verdictPath', e.target.value)} data-f="verdictPath" />
            {form.verdictMap.map((r, i) => (
              <div className="conn-row" key={i}>
                <input className="gw-input" placeholder="source value" value={r.from} onChange={(e) => updateRow('verdictMap', i, { from: e.target.value })} />
                <span>→</span>
                <input className="gw-input" placeholder="ACCEPTED|OVERRIDDEN|ESCALATED|FAILED|PENDING" value={r.to} onChange={(e) => updateRow('verdictMap', i, { to: e.target.value })} />
              </div>
            ))}
            <button className="lens" onClick={() => addRow('verdictMap')}>+ value</button>
          </div>
          <div className="conn-field">
            <span>outcome path + value-map (optional)</span>
            <input className="gw-input" placeholder="e.g. outcome" value={form.outcomePath} onChange={(e) => set('outcomePath', e.target.value)} data-f="outcomePath" />
            {form.outcomeMap.map((r, i) => (
              <div className="conn-row" key={i}>
                <input className="gw-input" placeholder="source value" value={r.from} onChange={(e) => updateRow('outcomeMap', i, { from: e.target.value })} />
                <span>→</span>
                <input className="gw-input" placeholder="SUCCESS|PARTIAL|FAILURE" value={r.to} onChange={(e) => updateRow('outcomeMap', i, { to: e.target.value })} />
              </div>
            ))}
            <button className="lens" onClick={() => addRow('outcomeMap')}>+ value</button>
          </div>
        </div>

        <div className="conn-grid">
          <label className="conn-field">
            <span>Pull source URL (optional, public http/https)</span>
            <input className="gw-input" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} data-f="sourceUrl" />
          </label>
          <label className="conn-field">
            <span>Auth header name (optional)</span>
            <input className="gw-input" value={authHeaderName} onChange={(e) => setAuthHeaderName(e.target.value)} data-f="authHeaderName" />
          </label>
          <label className="conn-field">
            <span>Auth header value (write-only — never shown again)</span>
            <input className="gw-input" type="password" value={authHeaderValue} onChange={(e) => setAuthHeaderValue(e.target.value)} data-f="authHeaderValue" />
          </label>
        </div>
      </section>

      <section className="pillar">
        <h3>Sample record → dry-run</h3>
        <textarea
          className="quickstart conn-sample"
          placeholder={SAMPLE_PLACEHOLDER}
          value={sampleText}
          onChange={(e) => setSampleText(e.target.value)}
          data-sample
          rows={8}
        />
        {dry === null ? (
          <p className="disclosure">Paste a sample record and fill the required paths to preview.</p>
        ) : dry.ok ? (
          <div className={`conn-verdict glass ${dry.governed ? 'is-govern' : 'is-observe'}`} data-dry-verdict={dry.governed ? 'govern' : 'observe'}>
            <strong>{governLabel(dry.governed === true)}</strong>
            <pre className="quickstart">
              <code>{JSON.stringify(dry.event, null, 2)}</code>
            </pre>
          </div>
        ) : (
          <p className="connect-error" data-dry-error>
            {dry.error}
          </p>
        )}
      </section>

      <section className="pillar">
        {error ? <p className="connect-error">{error}</p> : null}
        <button className="approve" onClick={save} disabled={saving || !mappingComplete(form)} data-save>
          {saving ? 'Saving…' : 'Save connector'}
        </button>
      </section>
    </div>
  );
}
