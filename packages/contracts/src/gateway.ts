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
