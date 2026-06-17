/**
 * PURE Connect helpers. The SDK quickstart mirrors the actual Phase-5 provable_sdk surface
 * (Client.register / Client.track with Verdict/Outcome/Source). It shows ONLY the real SDK
 * path — never a gateway URL or any non-real endpoint (the gateway isn't built here).
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
