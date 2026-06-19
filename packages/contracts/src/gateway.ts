/**
 * Gateway wire contract (Phase C2) — the header names + base path the Observe-only LLM proxy
 * reads. Lives in contracts so the proxy (apps/api) and the onboarding RECIPE (apps/web) bind to
 * the SAME literals and can never drift; a lockstep test asserts the recipe renders all of them.
 *
 * `key`   — the Provable machine key (authenticates the agent to Provable; DISTINCT from the
 *           caller's upstream LLM key, which rides the standard Authorization header).
 * `agent` / `task` — identify the agent×task the gateway call belongs to.
 */
export const GATEWAY_HEADERS = {
  key: 'x-provable-key',
  agent: 'x-provable-agent',
  task: 'x-provable-task',
} as const;

/** The OpenAI-compatible base path clients repoint their LLM base URL to. */
export const GATEWAY_BASE_PATH = '/gateway/v1';

/**
 * Tier-1 Anthropic gateway (Phase O2). A transparent /v1/messages proxy keyed by a PER-AGENT
 * gateway key carried in the URL PATH (not a header): the client repoints its Anthropic base URL
 * to `<api>${ANTHROPIC_GW_PREFIX}/<gateway-key>` and keeps using its OWN Anthropic key (x-api-key,
 * forwarded upstream, never stored). The full proxy path is `${ANTHROPIC_GW_PREFIX}/:key/v1/messages`.
 * Lives here so the proxy route (apps/api) and the Connect recipe (apps/web) bind to the SAME
 * literal and cannot drift (lockstep test).
 */
export const ANTHROPIC_GW_PREFIX = '/gw';
