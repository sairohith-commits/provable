# PROVABLE — Build Plan (locked)

> The first **vertical slice**: one agent's decisions flowing end-to-end to the dashboard,
> real Claude calls, real earned scores. This *is* the pitch demo.
> See PROVABLE_CORE_ARCHITECTURE.md (the contract) and PROVABLE_STACK.md (the tools).

---

## Governing principle: thin in scope, production-grade in quality

This is **not a throwaway demo**. It is **increment 1 of the real product** — built to be
improved and built upon.

- **Everything in the slice is keep-forward foundation:** `contracts · core · lifecycle ·
  persistence · api · sdk-python · web`. Permanent.
- **Thinness lives only in *scope*** — one adapter, one dashboard screen, deferred features.
- **Deferred = additive later, never rebuilt later.** Guardrails, more adapters, billing,
  self-hosting, the async queue all bolt onto this foundation without touching it.
- **No demo shortcuts that must be torn out:** no hardcoded/fake data in the UI, no stubbed
  scoring, no bypassed validation, no skipped tests. If it ships in a phase, it's real.

If a phase tempts a shortcut to "make the demo work," that's the signal it's being built
wrong — the slice must be the genuine first layer of the production system.

---

## Standing gates (green at every phase)

1. **dependency-cruiser** architecture rule — `core` never imports an adapter or domain term.
2. **Tenant isolation** — `orgId` scoping holds (a second org sees nothing of the first).
3. **Tests pass** — every phase lands with real unit/integration tests by Claude Code.

---

## The slice — 8 phases, each with an acceptance gate

### 1 · `contracts`
Canonical decision model + 5 verdict primitives + port interfaces (TS, dependency-free).
**Gate:** types compile; nothing imports up the chain; dependency-cruiser green.

### 2 · `core`  *(the moat — proven before any infra exists)*
Readiness engine + lifecycle state machine (effectiveMode, Transitions, promote-gated /
demote-auto, hysteresis), pure, driven only by `contracts`. Vitest with **synthetic** events.
**Gate:** a synthetic event stream drives one task Shadow→Co-Pilot→Solo *and* triggers an
auto-demotion — all in unit tests, no DB, no adapter.

### 3 · `persistence`
Prisma schema (`org, agent, task, decision, transition, score`) + tenant-guard implementing
core's repository ports.
**Gate:** isolation check green; core ports satisfied against a real Neon branch.

### 4 · `apps/api`
Fastify; ingestion endpoint with **zod** gatekeeper; machine-key auth; **synchronous**
recompute wired to core.
**Gate:** POST one canonical event → decision persisted, score + effectiveMode updated, any
transition recorded — in a single request.

### 5 · `sdk-python`
The first adapter: `register()` + `track()`, Pydantic models mirroring `contracts`; pytest.
**Gate:** Python → wire → API → core round-trip green; a drifted schema is rejected by zod.

### 6 · Demo agent  *(separate project — scenario TBD)*
Real Claude calls (worker + reviewer producing genuine overrides / escalations / outcomes),
instrumented with `sdk-python`. Earns real scores.
**Gate:** a run produces a real, defensible readiness band per task.

### 7 · `apps/web`
Next.js + light-glass dashboard. Overview bound to **real** core read models — registry,
readiness ladder, autonomy distribution, ROI, governance feed — including the live-crossing
moment. No mock data.
**Gate:** the dashboard reflects an actual demo-agent run end-to-end.

### 8 · Deploy
Web → Vercel · API → Render · DB → Neon. Shareable URL for the pitch.
**Gate:** the full loop runs on the live URL.

---

## Building forward from the slice (proof it's a foundation, not a demo)

Each of these is **additive** on the locked foundation — no rebuild:

- **Guardrails** — a synchronous pre-action gate port (own source-of-truth doc) that feeds the
  lifecycle (trip → SUSPENDED / demotion).
- **More adapters** — gateway, then real platform connectors, via an Adapter SDK. Each is a new
  package depending only on `contracts`.
- **Async recompute** — swap synchronous for BullMQ/Redis behind the same core port when scale
  demands it. Core unchanged.
- **Deferred pillars** — billing, self-hosting (Docker/Helm), drift jobs, score history — all
  bolt on.

---

## Division of labor

- **Claude Code** — all implementation + tests, phase by phase, against the gates above.
- **Rohith** — infra accounts (Vercel/Render/Neon) + env vars; decisions + orchestration.

## Open item

- **Demo-agent scenario** (phase 6) — TBD. Must demo well, produce clean override/escalate/
  outcome signals, and *not* re-anchor the narrative to a single vertical. Decided before phase 6;
  phases 1–5 + 7 are domain-agnostic and proceed regardless.
