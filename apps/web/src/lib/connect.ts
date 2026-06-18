import { GATEWAY_BASE_PATH, GATEWAY_HEADERS } from '@provable/contracts';

/**
 * Tier 1 — Gateway recipe (zero code) → Observe-only: cost + activity, readiness N/A until
 * verdicts arrive. Repoint the LLM base URL to Provable; the caller keeps using their OWN
 * provider key (Provable never stores it). Bound to GATEWAY_HEADERS/GATEWAY_BASE_PATH so the
 * recipe and the proxy cannot drift (lockstep test).
 */
export function gatewayRecipe(
  apiUrl: string,
  key: string,
  agentKey = 'my-agent',
  taskKey = 'classify',
): string {
  const base = `${apiUrl}${GATEWAY_BASE_PATH}`;
  return `# Tier 1 - Gateway (zero code) -> Observe-only: cost + activity.
# Repoint your LLM base URL to Provable; keep using your OWN provider key.

curl ${base}/chat/completions \\
  -H "${GATEWAY_HEADERS.key}: ${key}" \\
  -H "${GATEWAY_HEADERS.agent}: ${agentKey}" \\
  -H "${GATEWAY_HEADERS.task}: ${taskKey}" \\
  -H "Authorization: Bearer $OPENAI_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}'

# OpenAI Python SDK:
from openai import OpenAI
client = OpenAI(
    base_url="${base}",
    api_key="$OPENAI_API_KEY",   # your OWN provider key - Provable never stores it
    default_headers={
        "${GATEWAY_HEADERS.key}": "${key}",
        "${GATEWAY_HEADERS.agent}": "${agentKey}",
        "${GATEWAY_HEADERS.task}": "${taskKey}",
    },
)
# Readiness stays N/A (Observe-only) until you add verdicts (Tier 3 SDK / Tier 2 adapter).`;
}

/**
 * Tier 2 — Connector recipe (Phase C3, no agent code). Deliver the events your agent ALREADY
 * emits to the reference connector; a declarative mapping turns source fields into canonical
 * Decisions. Verdict present → full governance (scored); absent → Observe-only (readiness N/A).
 * The source MUST supply a stable id (mapped to externalRef) — redelivery is deduped on it.
 */
export function connectorRecipe(apiUrl: string, key: string): string {
  return `# Tier 2 - Connector (no agent code) -> full governance if your data has verdicts.
# POST the events your agent already emits; a declarative mapping does the rest.

curl ${apiUrl}/connector/events \\
  -H "Authorization: Bearer ${key}" \\
  -H "content-type: application/json" \\
  -d '[
    {
      "agent": "support-bot",          # -> agentKey
      "task": "classify",              # -> taskKey
      "id": "ticket-4821",             # -> externalRef (REQUIRED: a STABLE id; dedups redelivery)
      "input": {"subject": "refund"},  # -> action (opaque)
      "confidence": 0.92,              # -> confidence (optional)
      "verdict": "approved",           # -> ACCEPTED  (omit -> Observe-only, readiness N/A)
      "outcome": "success"             # -> SUCCESS   (optional)
    }
  ]'

# Field mapping (default; override per deployment via CONNECTOR_MAPPING):
#   agent->agentKey  task->taskKey  id->externalRef  input->action  confidence->confidence
#   verdict: approved|accepted->ACCEPTED  overridden->OVERRIDDEN  escalated->ESCALATED  failed->FAILED
#   outcome: success->SUCCESS  partial->PARTIAL  failure->FAILURE
# Events WITHOUT a recognized verdict are ingested as Observe-only (cost/activity, no score).`;
}

/**
 * Tier 3 — SDK quickstart. Mirrors the actual provable_sdk surface (Client.register /
 * Client.track with Verdict/Outcome/Source) — highest fidelity. Shows ONLY the real SDK path;
 * direct REST is the same profile minus the dependency.
 */
export function quickstart(apiUrl: string, key: string): string {
  return `pip install provable_sdk

from provable_sdk import Client, Verdict, VerdictKind, Outcome, Source

client = Client("${apiUrl}", api_key="${key}")  # or set PROVABLE_API_KEY

# 1. Register the agent + task (idempotent)
client.register("my-agent", "classify")

# 2. Track each decision — Provable scores & governs it
client.track(
    agent_key="my-agent",
    task_key="classify",
    action={"input": "..."},          # opaque to Provable
    verdict=Verdict(kind=VerdictKind.ACCEPTED),
    outcome=Outcome.SUCCESS,
    confidence=0.9,
    source=Source.SDK,
    external_ref="case-001",          # your id — used for idempotency + async resolve
)`;
}

export function maskedKey(prefix: string | null): string {
  return prefix ? `pvb_${prefix}_${'•'.repeat(12)}` : 'no key provisioned';
}
