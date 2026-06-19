'use client';

import type { FleetOverview } from '@provable/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type IdentifyState,
  type StepId,
  type WizardTier,
  STEP_ORDER,
  canAdvance,
  connectorHref,
  effectiveTaskKey,
  fleetHasAgent,
  gatewayBaseUrl,
  gatewaySnippet,
  identifyValid,
  normalizeIdentify,
  sdkSnippet,
  tierChoice,
  TIER_CHOICES,
} from '@/lib/onboarding-wizard';

const POLL_MS = 4000;

const STEP_LABELS: Record<StepId, string> = {
  identify: 'Identify',
  tier: 'Choose tier',
  setup: 'Set up',
  signal: 'First signal',
};

// Phase W1 — the in-dashboard "Add an agent" wizard. Steps are RENDERED (no display:none tabs);
// forward motion is gated on validity. The wizard mints keys via the authed proxy routes and then
// WATCHES the real fleet read-model — it never fabricates an agent, task, or score.
export function OnboardingWizardClient({ apiUrl }: { apiUrl: string }) {
  const [step, setStep] = useState<StepId>('identify');
  const [identify, setIdentify] = useState<IdentifyState>({ agentKey: '', displayName: '', taskKey: '' });
  const [tier, setTier] = useState<WizardTier | null>(null);

  // Minted secrets — returned once by the API, embedded in the snippet, never re-fetched.
  const [gwKey, setGwKey] = useState<string | null>(null);
  const [sdkKey, setSdkKey] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);

  // First-signal watch (Step 4) — driven solely by GET /api/overview/fleet.
  const [agentLive, setAgentLive] = useState(false);

  const norm = useMemo(() => normalizeIdentify(identify), [identify]);
  const idx = STEP_ORDER.indexOf(step);

  const next = useCallback(() => {
    if (!canAdvance(step, identify, tier)) return;
    const at = STEP_ORDER.indexOf(step);
    if (at < STEP_ORDER.length - 1) setStep(STEP_ORDER[at + 1] as StepId);
  }, [step, identify, tier]);

  const back = useCallback(() => {
    const at = STEP_ORDER.indexOf(step);
    if (at > 0) setStep(STEP_ORDER[at - 1] as StepId);
  }, [step]);

  const mintGateway = useCallback(async () => {
    setMinting(true);
    setMintError(null);
    try {
      const res = await fetch('/api/gateway-key', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentKey: norm.agentKey, taskKey: effectiveTaskKey(identify) }),
      });
      if (!res.ok) {
        setMintError('Could not mint a gateway key — are you an Owner?');
        return;
      }
      const body = (await res.json()) as { key: string };
      setGwKey(body.key);
    } finally {
      setMinting(false);
    }
  }, [norm.agentKey, identify]);

  const mintSdk = useCallback(async () => {
    setMinting(true);
    setMintError(null);
    try {
      const res = await fetch('/api/admin/keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: `sdk:${norm.agentKey}` }),
      });
      if (!res.ok) {
        setMintError('Could not mint an SDK key — are you an Owner?');
        return;
      }
      const body = (await res.json()) as { key: string };
      setSdkKey(body.key);
    } finally {
      setMinting(false);
    }
  }, [norm.agentKey]);

  // Poll the REAL fleet read-model while waiting; flip to Live when the agentKey appears.
  const poll = useCallback(async () => {
    const res = await fetch('/api/overview/fleet', { cache: 'no-store' });
    if (!res.ok) return;
    const fleet = (await res.json()) as FleetOverview;
    if (fleetHasAgent(fleet, norm.agentKey)) setAgentLive(true);
  }, [norm.agentKey]);

  useEffect(() => {
    if (step !== 'signal' || agentLive) return;
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [step, agentLive, poll]);

  const advanceDisabled = !canAdvance(step, identify, tier);

  return (
    <div className="onboarding wizard" data-wizard>
      <h1>Add an agent</h1>
      <p className="onboarding-lede">
        Onboard <strong>one</strong> agent end-to-end, in the dashboard. Provable governs agents it
        doesn’t own — the agent appears here only when <strong>real</strong> signal lands.
      </p>

      {/* Stepper — rendered, current step highlighted (no hidden tabs). */}
      <ol className="wiz-steps" data-wiz-steps>
        {STEP_ORDER.map((s, i) => (
          <li
            key={s}
            className={`wiz-step${i === idx ? ' active' : ''}${i < idx ? ' done' : ''}`}
            data-step={s}
            aria-current={i === idx ? 'step' : undefined}
          >
            <span className="wiz-step-n">{i + 1}</span>
            <span className="wiz-step-label">{STEP_LABELS[s]}</span>
          </li>
        ))}
      </ol>

      <section className="wiz-body card glass">
        {step === 'identify' && (
          <div className="wiz-pane" data-pane="identify">
            <h2>Identify the agent</h2>
            <label className="wiz-field">
              <span>Agent key <em>(required)</em></span>
              <input
                className="gw-input"
                value={identify.agentKey}
                onChange={(e) => setIdentify((p) => ({ ...p, agentKey: e.target.value }))}
                placeholder="support-bot"
                data-field-agent
                autoFocus
              />
            </label>
            <label className="wiz-field">
              <span>Display name <em>(optional)</em></span>
              <input
                className="gw-input"
                value={identify.displayName}
                onChange={(e) => setIdentify((p) => ({ ...p, displayName: e.target.value }))}
                placeholder="Support Triage Bot"
                data-field-name
              />
            </label>
            <label className="wiz-field">
              <span>Task key <em>(for the Gateway tier; defaults to “default”)</em></span>
              <input
                className="gw-input"
                value={identify.taskKey}
                onChange={(e) => setIdentify((p) => ({ ...p, taskKey: e.target.value }))}
                placeholder="classify"
                data-field-task
              />
            </label>
            {!identifyValid(identify) ? (
              <p className="disclosure">Enter an agent key to continue.</p>
            ) : null}
          </div>
        )}

        {step === 'tier' && (
          <div className="wiz-pane" data-pane="tier">
            <h2>Choose how this agent connects</h2>
            <div className="tier-cards" data-tier-cards>
              {TIER_CHOICES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`tier-card card glass${tier === t.id ? ' selected' : ''}`}
                  onClick={() => setTier(t.id)}
                  data-tier-card={t.id}
                  aria-pressed={tier === t.id}
                >
                  <h3>{t.title}</h3>
                  <p className="tier-tagline">{t.tagline}</p>
                  <p className="tier-detail">{t.detail}</p>
                  <span className="fidelity-badge">{t.readiness}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'setup' && tier !== null && (
          <div className="wiz-pane" data-pane="setup">
            <h2>{tierChoice(tier).title}</h2>

            {tier === 'gateway' && (
              <div data-setup="gateway">
                <p className="connect-lead">
                  Generate a per-agent gateway key bound to{' '}
                  <code>{norm.agentKey}</code> × <code>{effectiveTaskKey(identify)}</code>, then
                  repoint your <code>base_url</code>. Observe-only: cost + activity, no readiness
                  until verdicts flow.
                </p>
                <button className="approve" onClick={mintGateway} disabled={minting} data-mint-gateway>
                  {minting ? 'Generating…' : 'Generate gateway key'}
                </button>
                {mintError ? <p className="connect-error">{mintError}</p> : null}
                {gwKey !== null ? (
                  <>
                    <div className="key-row glass" data-gw-base-url>
                      <code className="key-prefix">{gatewayBaseUrl(apiUrl, gwKey)}</code>
                    </div>
                    <pre className="quickstart" data-gw-snippet>
                      <code>{gatewaySnippet(apiUrl, gwKey)}</code>
                    </pre>
                    <p className="disclosure" data-key-once>
                      Your gateway key is shown <strong>once</strong>, embedded above. Copy it now —
                      it is hashed at rest and cannot be shown again.
                    </p>
                  </>
                ) : null}
              </div>
            )}

            {tier === 'connector' && (
              <div data-setup="connector">
                <p className="connect-lead">
                  Map the events your system already emits into Provable — no agent changes. The
                  Connectors editor (with live dry-run) is where you build and test the mapping; we
                  carry <code>{norm.agentKey}</code> in as context.
                </p>
                <a className="approve" href={connectorHref(norm.agentKey)} data-connector-link>
                  Open the Connectors editor →
                </a>
                <p className="disclosure">
                  Full governance if your logs carry <strong>verdict + outcome</strong>; otherwise
                  Observe-only (cost + activity, no readiness).
                </p>
              </div>
            )}

            {tier === 'sdk' && (
              <div data-setup="sdk">
                <p className="connect-lead">
                  Generate an SDK key for your org, then wrap the decision boundary for{' '}
                  <code>{norm.agentKey}</code>. Highest fidelity into the Readiness Ladder.
                </p>
                <button className="approve" onClick={mintSdk} disabled={minting} data-mint-sdk>
                  {minting ? 'Generating…' : 'Generate SDK key'}
                </button>
                {mintError ? <p className="connect-error">{mintError}</p> : null}
                {sdkKey !== null ? (
                  <>
                    <pre className="quickstart" data-sdk-snippet>
                      <code>{sdkSnippet(apiUrl, norm.agentKey, effectiveTaskKey(identify), sdkKey)}</code>
                    </pre>
                    <p className="disclosure" data-key-once>
                      Your SDK key is shown <strong>once</strong>, embedded above. Copy it now — it
                      is hashed at rest and cannot be shown again.
                    </p>
                  </>
                ) : null}
              </div>
            )}
          </div>
        )}

        {step === 'signal' && (
          <div className="wiz-pane" data-pane="signal">
            <h2>Waiting for first signal</h2>
            {agentLive ? (
              <div className="connected glass" data-connected>
                ✓ <strong>{norm.agentKey}</strong> is live —{' '}
                <a className="nav-link" href="/" data-view-agent>
                  view agent in the Overview →
                </a>
              </div>
            ) : (
              <div className="waiting glass" data-waiting>
                <span className="pulse" /> Watching for <strong>{norm.agentKey}</strong>… make one
                call / ingest one event / track one decision and it appears here.
              </div>
            )}
          </div>
        )}
      </section>

      <footer className="wiz-nav">
        <button className="lens" onClick={back} disabled={idx === 0} data-wiz-back>
          Back
        </button>
        {step !== 'signal' ? (
          <button className="approve" onClick={next} disabled={advanceDisabled} data-wiz-next>
            Next
          </button>
        ) : null}
      </footer>
    </div>
  );
}
