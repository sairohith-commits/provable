// Phase 7b local demo seed (token-free, synthetic). Drives REAL safety events so the
// Guardrails + Legal pillars render on data, not just empty states:
//   • a GUARDRAIL trip  → AUTO_APPLIED SUSPENDED
//   • a SIGNAL_LOSS demotion → AUTO_APPLIED one band down (distinct from DRIFT)
// Run AFTER the support agent's synthetic warmup + live-climb (which seed the 3 showcase
// bands + a classify PENDING_APPROVAL). Usage:
//   node scripts/seed-7b.mjs <BASE> <MACHINE_KEY> <INTERNAL_TOKEN> <ORG_ID>
const [BASE, KEY, TOKEN, ORG] = process.argv.slice(2);
if (!BASE || !KEY || !TOKEN || !ORG) {
  console.error('usage: node scripts/seed-7b.mjs <BASE> <KEY> <TOKEN> <ORG>');
  process.exit(2);
}
// Now-relative anchoring (Phase U4): the demo timeline must never run into the future, or the
// dashboard renders "in 31 days" for a transition that supposedly already happened. We place the
// LATEST synthetic event (the signal-loss at index FAR+1) one hour before now and build backwards,
// then ASSERT every emitted `at(i)` is ≤ now — a hard guard against the old hard-coded 2026-06-15
// base that pushed the +35-day signal-loss track into the future.
const NOW_MS = Date.now();
const SAFETY_MARGIN_MS = 60 * 60 * 1000; // newest event sits 1h in the past (tolerates clock skew)
const LATEST_IDX = 35 * 24 * 60 + 1; // must match the highest index used below (FAR + 1)
const BASE_MS = NOW_MS - SAFETY_MARGIN_MS - LATEST_IDX * 60_000;
const at = (i) => {
  const ms = BASE_MS + i * 60_000;
  if (ms > NOW_MS) {
    throw new Error(`seed timestamp at(${i}) = ${new Date(ms).toISOString()} is in the future (now ${new Date(NOW_MS).toISOString()})`);
  }
  return new Date(ms).toISOString();
};

async function track(body) {
  const r = await fetch(`${BASE}/track`, {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`track ${r.status}: ${await r.text()}`);
  return r.json();
}
async function register(agentKey, taskKey) {
  await fetch(`${BASE}/register`, {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ agentKey, taskKey }),
  });
}
async function approve(agentKey, taskKey, approver) {
  const r = await fetch(`${BASE}/agents/${agentKey}/tasks/${taskKey}/approve`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-provable-internal-token': TOKEN,
      'x-provable-org-id': ORG,
      'x-provable-approver': approver,
    },
  });
  if (!r.ok) throw new Error(`approve ${r.status}: ${await r.text()}`);
  return r.json();
}

// ── 1) GUARDRAIL trip → SUSPENDED ──────────────────────────────────────────────
await register('billing-agent', 'auto_refund');
const g = await track({
  type: 'decision',
  agentKey: 'billing-agent',
  taskKey: 'auto_refund',
  at: at(0),
  action: { refund: 1200 },
  verdict: { kind: 'ACCEPTED' },
  outcome: 'SUCCESS',
  confidence: 0.8,
  source: 'sdk',
  externalRef: 'billing-agent:auto_refund:0',
  signals: { guardrail: { guardrailId: 'refund_cap', reason: 'auto-refund $1200 exceeds $500 cap' } },
});
console.log('guardrail →', g.effectiveMode, g.transitions.map((t) => `${t.trigger}/${t.status}`).join(','));

// ── 2) SIGNAL_LOSS demotion (climb → approve → signal goes absent) ──────────────
await register('vision-agent', 'classify');
for (let i = 0; i < 14; i += 1) {
  await track({
    type: 'decision',
    agentKey: 'vision-agent',
    taskKey: 'classify',
    at: at(i),
    action: { i },
    verdict: { kind: 'ACCEPTED' },
    outcome: 'SUCCESS',
    confidence: 0.95,
    source: 'sdk',
    externalRef: `vision-agent:classify:${i}`,
  });
}
const appr = await approve('vision-agent', 'classify', 'maria@acme.com');
console.log('signal-loss setup: approved →', appr.effectiveMode);
const FAR = 35 * 24 * 60;
let sl;
for (let i = 0; i < 2; i += 1) {
  sl = await track({
    type: 'decision',
    agentKey: 'vision-agent',
    taskKey: 'classify',
    at: at(FAR + i),
    action: { i },
    verdict: { kind: 'ACCEPTED' },
    outcome: 'SUCCESS',
    source: 'sdk', // NO confidence → INSUFFICIENT
    externalRef: `vision-agent:classify:sl-${i}`,
  });
}
console.log('signal-loss →', sl.effectiveMode, sl.transitions.map((t) => `${t.trigger}/${t.status}`).join(','));
