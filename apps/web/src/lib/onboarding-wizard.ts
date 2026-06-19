import { ANTHROPIC_GW_PREFIX } from '@provable/contracts';
import type { FleetOverview } from '@provable/contracts';

// Phase W1 — pure view-logic for the in-dashboard "Add an agent" wizard. ALL snippet/base_url
// assembly and step/validity state lives here (node-tested), never inline in JSX — so the proxy
// path, the displayed base_url, and the step gating can't silently drift. The wizard NEVER
// fabricates an agent/task/score: this module only builds strings and validates input; the agent
// appears solely when the real fleet read-model reports it (see fleetHasAgent).

export type WizardTier = 'gateway' | 'connector' | 'sdk';

export type StepId = 'identify' | 'tier' | 'setup' | 'signal';
export const STEP_ORDER: readonly StepId[] = ['identify', 'tier', 'setup', 'signal'];

/** Step 1 input. taskKey is only meaningful for the gateway tier (which binds agent×task). */
export interface IdentifyState {
  readonly agentKey: string;
  readonly displayName: string;
  readonly taskKey: string;
}

/** A sensible default task so a blank gateway taskKey never blocks or fabricates intent. */
export const DEFAULT_TASK_KEY = 'default';

/** Trim + normalize; the gateway taskKey falls back to DEFAULT_TASK_KEY when blank. */
export function normalizeIdentify(raw: IdentifyState): IdentifyState {
  return {
    agentKey: raw.agentKey.trim(),
    displayName: raw.displayName.trim(),
    taskKey: raw.taskKey.trim(),
  };
}

/** agentKey is the only hard requirement to leave Step 1. */
export function identifyValid(raw: IdentifyState): boolean {
  return normalizeIdentify(raw).agentKey.length > 0;
}

/** The effective gateway taskKey: entered value, or the sensible default when blank. */
export function effectiveTaskKey(raw: IdentifyState): string {
  const t = raw.taskKey.trim();
  return t.length > 0 ? t : DEFAULT_TASK_KEY;
}

/** Can the wizard advance PAST `step` given the current state + tier choice? */
export function canAdvance(step: StepId, identify: IdentifyState, tier: WizardTier | null): boolean {
  switch (step) {
    case 'identify':
      return identifyValid(identify);
    case 'tier':
      return tier !== null;
    case 'setup':
      return true; // setup → signal is always allowed; the signal step just watches.
    case 'signal':
      return false; // terminal.
  }
}

// ── Tier cards: the HONEST trade-offs (Readiness Ladder language) ───────────────
export interface TierChoice {
  readonly id: WizardTier;
  readonly title: string;
  readonly tagline: string;
  readonly detail: string;
  /** Whether this tier yields a readiness score, stated plainly (never a fabricated score). */
  readonly readiness: string;
}

export const TIER_CHOICES: readonly TierChoice[] = [
  {
    id: 'gateway',
    title: 'Gateway · zero code',
    tagline: 'Repoint your LLM base_url',
    detail:
      'Point your agent’s base_url at Provable and keep using your own provider key. Activity and real cost land immediately — no agent changes.',
    readiness: 'Observe-only — no readiness score until verdicts exist.',
  },
  {
    id: 'connector',
    title: 'Connector · no agent code',
    tagline: 'Ingest your existing logs',
    detail:
      'Map the events your system already emits (a review queue, a ticketing tool) to Provable. No changes to your agent.',
    readiness: 'Full governance if your logs carry verdict + outcome.',
  },
  {
    id: 'sdk',
    title: 'SDK · minimal code',
    tagline: 'Wrap the decision boundary',
    detail:
      'A few lines around each decision report the verdict and outcome. Highest fidelity into the Readiness Ladder.',
    readiness: 'Highest fidelity — scored and governable.',
  },
];

export function tierChoice(id: WizardTier): TierChoice {
  const t = TIER_CHOICES.find((x) => x.id === id);
  if (t === undefined) throw new Error(`unknown tier ${id}`);
  return t;
}

// ── Gateway base_url + snippet (bound to ANTHROPIC_GW_PREFIX so it can't drift) ──
/**
 * The displayed gateway base_url, EXACTLY `<api>/gw/<key>/` (trailing slash). The per-agent
 * gateway key is carried in the URL path; the trailing slash makes SDK base_url joins land on
 * `<api>/gw/<key>/v1/messages`, the proxy route. agentKey/taskKey are bound into the key at mint
 * time, so they are not in the URL.
 */
export function gatewayBaseUrl(apiUrl: string, key: string): string {
  return `${apiUrl}${ANTHROPIC_GW_PREFIX}/${key}/`;
}

/** Copy-paste snippet for the gateway tier: set the SDK base_url to the per-agent gateway URL. */
export function gatewaySnippet(apiUrl: string, key: string): string {
  const base = gatewayBaseUrl(apiUrl, key);
  return `# Gateway (zero code) -> Observe-only: real cost + activity, no readiness yet.
# Repoint base_url to Provable; KEEP using your own Anthropic key (Provable never stores it).

from anthropic import Anthropic
client = Anthropic(
    base_url="${base}",          # per-agent gateway key is IN the URL (trailing slash)
    api_key="$ANTHROPIC_API_KEY",  # your OWN key - Provable forwards it, never stores it
)
client.messages.create(model="claude-sonnet-4-6", max_tokens=256,
    messages=[{"role": "user", "content": "hi"}])
# Readiness stays N/A until verdicts flow (add the SDK or a connector to score this agent).`;
}

// ── SDK wrapper snippet (the real provable_sdk surface, parameterized by agentKey) ──
/**
 * Minimal Provable SDK wrapper referencing the entered agentKey. Built on the REAL provable_sdk
 * surface (Client.register / Client.track with Verdict/Outcome/Source) — the highest-fidelity
 * path — never a fabricated package. The minted key is interpolated once by the caller.
 */
export function sdkSnippet(apiUrl: string, agentKey: string, taskKey: string, key: string): string {
  const agent = agentKey.length > 0 ? agentKey : 'my-agent';
  const task = taskKey.length > 0 ? taskKey : DEFAULT_TASK_KEY;
  return `pip install provable_sdk

from provable_sdk import Client, Verdict, VerdictKind, Outcome, Source

client = Client("${apiUrl}", api_key="${key}")  # or set PROVABLE_API_KEY

# 1. Register this agent + task (idempotent)
client.register("${agent}", "${task}")

# 2. Wrap the decision boundary — report each verdict + outcome
client.track(
    agent_key="${agent}",
    task_key="${task}",
    action={"input": "..."},          # opaque to Provable
    verdict=Verdict(kind=VerdictKind.ACCEPTED),
    outcome=Outcome.SUCCESS,
    confidence=0.9,
    source=Source.SDK,
    external_ref="case-001",          # your id — idempotency + async resolve
)`;
}

// ── Connector tier handoff (reuse the real /connectors editor, carry agentKey) ──
/** The Connectors editor URL, carrying the entered agentKey as context (no editor duplication). */
export function connectorHref(agentKey: string): string {
  const a = agentKey.trim();
  return a.length > 0 ? `/connectors?agent=${encodeURIComponent(a)}` : '/connectors';
}

// ── First-signal detection (reads ONLY the real fleet read-model) ───────────────
/**
 * Has the entered agent appeared in the real fleet read-model yet? This is the ONLY way the
 * wizard learns an agent exists — it reads GET /overview/fleet and never synthesizes a row.
 */
export function fleetHasAgent(fleet: Pick<FleetOverview, 'tasks'>, agentKey: string): boolean {
  const a = agentKey.trim();
  if (a.length === 0) return false;
  return fleet.tasks.some((t) => t.agentKey === a);
}
