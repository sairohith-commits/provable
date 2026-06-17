# PROVABLE — Core Architecture (source of truth)

> The contract that makes Provable govern **any agent, any vendor, any domain**.
> If domain-specific logic ever appears inside `core`, this document has been violated.

---

## 0. The one principle

**Provable governs *decisions*, not *agents*.**

Every agent that can exist — support bot, coding agent, invoice/AP agent, contract-review
agent, an RPA script, LLM-based or not — reduces to one universal unit:

> a judgment was made → a verdict followed (or didn't) → an outcome resulted.

The core understands only that sentence. It never knows whether the decision was a refund,
a pull request, or an invoice. All domain knowledge lives in **adapters** at the edge.

---

## 1. The two universal interfaces

Everything in the system communicates through exactly two contracts. The core depends on
nothing else; every adapter speaks only these.

### 1.1 Canonical Decision Model

The **unit of governance is a `Decision`** — one task-level judgment by an agent. A Decision
may internally involve many LLM/tool calls; those are captured as *telemetry* (cost), but
governance and scoring happen at Decision granularity.

```ts
// packages/contracts — dependency-free, the lingua franca

type Confidence = number; // 0.0 – 1.0

interface Decision {
  id: string;               // Provable-assigned
  orgId: string;            // tenant
  agentKey: string;         // org-scoped stable agent name (NOT an internal id)
  taskKey: string;          // org-scoped task name, e.g. "classify", "estimate_refund"
  at: string;               // ISO timestamp of the decision

  action: unknown;          // OPAQUE to core — a label, text, or reference. Core never reads it.
  confidence?: Confidence;  // agent self-reported, if available

  cost?: {                  // telemetry, never governance logic
    tokens?: number;
    usd?: number;
    latencyMs?: number;
  };

  verdict: Verdict;         // see 1.2 — may start as PENDING and resolve later
  outcome?: Outcome;        // eventual ground truth, may arrive async

  source: string;           // provenance: "gateway" | "connector:zendesk" | "sdk" | "otel"
  externalRef?: string;     // id in the source system — used for idempotency + linkback
  metadata?: Record<string, unknown>; // opaque bag
}
```

**Idempotency:** `(source, externalRef)` is the dedup key. An adapter that replays events
must never double-count. Required for connectors that re-poll.

**Verdicts lag actions (universal).** A human edits the draft minutes later; an outcome is
known the next day. So a Decision is created with `verdict: PENDING` and **resolved by a
later `VerdictEvent`** keyed to the same `externalRef`. The model MUST support async
resolution — this is true in every domain, not a support quirk.

### 1.2 Verdict Primitives

A small **closed set**. Adapters map their domain's signals onto these; the core only ever
sees these. This is the entire vocabulary of "what happened to the agent's judgment."

| Primitive | Meaning | Feeds |
|---|---|---|
| `ACCEPTED` | Output used as-is by human/downstream | accuracy (+) |
| `OVERRIDDEN` | A human changed the output (optional diff/magnitude) | override rate |
| `ESCALATED` | Agent handed off to a human (declined / low-confidence / policy) | escalation rate |
| `FAILED` | Action errored or was rejected outright | accuracy (−) |
| `PENDING` | Not yet resolved (transient) | — |

```ts
type Verdict =
  | { kind: "PENDING" }
  | { kind: "ACCEPTED" }
  | { kind: "OVERRIDDEN"; magnitude?: number } // 0..1, optional
  | { kind: "ESCALATED" }
  | { kind: "FAILED" };

type Outcome = "SUCCESS" | "PARTIAL" | "FAILURE"; // eventual ground truth, when knowable

interface VerdictEvent {       // resolves a prior Decision asynchronously
  orgId: string;
  source: string;
  externalRef: string;         // links to Decision.externalRef
  verdict?: Verdict;
  outcome?: Outcome;
  at: string;
}

type CanonicalEvent = Decision | VerdictEvent;
```

---

## 2. The readiness formula maps ONLY from primitives

The locked formula is unchanged and remains the single source of truth:

```
readiness = ( accuracyRate   × 0.40
            + confidenceAvg  × 0.25
            + (1 − overrideRate)   × 0.20
            + (1 − escalationRate) × 0.15 ) × 100

band = readiness ≤ 40 → Shadow | 41–70 → Co-Pilot | 71–100 → Solo   # SCORE-IMPLIED only
window = rolling 30 days, per (agentKey × taskKey)
# NOTE: this band is what the score *implies*. The mode the agent *operates in*
# (effectiveMode) is a GOVERNED state changed only via a Transition — see §2A.
```

Canonical derivation (the **only** place primitives become formula inputs):

- `accuracyRate`  = successes / resolved, where success = `OUTCOME=SUCCESS` OR (`ACCEPTED` with no failing outcome); `FAILED` and `OUTCOME=FAILURE` count against. **`OVERRIDDEN` counts as a failure (0) regardless of outcome** — readiness measures solo-quality, and an override means the agent's own call was wrong (a human had to correct it), so a rescued outcome must not inflate readiness. (`ESCALATED` is excluded — knowing one's limits is not being wrong.)
- `confidenceAvg` = mean(`confidence`) over resolved decisions that reported one.
- `overrideRate`  = `OVERRIDDEN` / decisions a human engaged with (`OVERRIDDEN` + `ACCEPTED`).
- `escalationRate`= `ESCALATED` / resolved decisions in window.

If a domain can't supply a signal (e.g. no confidence), that term degrades gracefully —
see §5 Observe-vs-Score boundary.

---

## 2A. Agent lifecycle — the governed state machine

Readiness produces a *number*. The lifecycle is what that number **governs**. This is the
flagship (the Human↔Agent Transition Tracker). It is fully domain-agnostic and lives in
`core/lifecycle`, beside `core/readiness`.

### Two intertwined state machines

**Agent identity** (per `agent`):
`DISCOVERED → ACTIVE → DORMANT → RETIRED`

**Autonomy** (per `agent × task` — the real lifecycle):
`OBSERVING → SHADOW → CO_PILOT → SOLO`  (+ `SUSPENDED`, `RETIRED`)

- `OBSERVING` — decisions flowing, not enough signal/window to score. Cost visible, no mode yet.
- `SHADOW / CO_PILOT / SOLO` — the operating modes.
- `SUSPENDED` — manually paused, or a guardrail tripped.
- `RETIRED` — this task decommissioned for this agent.

### `effectiveMode` ≠ `scoreImpliedBand`

The band the score *implies* is **not** the mode the agent *operates in*. `effectiveMode` is
a **governed state** that changes ONLY through a `Transition`. A task can score 75
(Solo-implied) yet remain in Co-Pilot until a human approves the promotion. The gap between
implied and effective is itself a signal ("scored Solo · awaiting approval").

### `Transition` — first-class, immutable, audited

```ts
type Mode = "OBSERVING" | "SHADOW" | "CO_PILOT" | "SOLO" | "SUSPENDED" | "RETIRED";

interface Transition {
  orgId: string; agentKey: string; taskKey: string;
  fromMode: Mode; toMode: Mode;
  direction: "PROMOTION" | "DEMOTION" | "LATERAL";
  trigger:   "SCORE_CROSS" | "DRIFT" | "GUARDRAIL" | "SIGNAL_LOSS" | "MANUAL" | "SCHEDULED";
  // SIGNAL_LOSS: a governed task auto-demotes after its verdict/outcome signal goes absent
  // (readiness INSUFFICIENT for a grace window). Distinct from DRIFT (genuine performance
  // decline) so Legal/audit can tell "we lost visibility" apart from "the agent got worse".
  status:    "PROPOSED" | "PENDING_APPROVAL" | "APPLIED" | "AUTO_APPLIED" | "REJECTED";
  approver?: string;   // REQUIRED for PROMOTION
  reason:    string;   // evidence: score delta, drift metric, guardrail id
  at:        string;
}
```

### The asymmetry (the whole governance value)

- **Promotion** (toward more autonomy): score must cross the upper threshold **and sustain
  it** (hysteresis — N sustained decisions/days), then it is *proposed* and **requires human
  approval** before `APPLIED`. Deliberate, gated, signed.
- **Demotion** (toward less autonomy): the instant score drops below threshold, or drift /
  a guardrail trips → **`AUTO_APPLIED`, no approval.** Safety-biased.

Easy to fall, hard to climb. **Auto-demotion** is the marquee differentiator and only exists
because the lifecycle is a real state machine, not `mode = f(score)`.

### Lifecycle inputs

- **Score crossings** (readiness engine) — propose promotions / fire demotions.
- **Drift** — sustained negative deviation from baseline → demotion or flag.
- **Guardrails** — a pre-action gate trip → immediate `SUSPENDED` / demotion.
- **Hysteresis window** — prevents flapping at band edges.
- **Manual / scheduled** — operator overrides; planned retirement.

### Retirement

An `agent × task` reaches `RETIRED` when superseded or deprecated (Retirement Planner
surfaces candidates: low readiness + low usage, or replaced by a higher-scoring agent).
Terminal, audited transition.

### Separation of concerns

`core/readiness` **computes**; `core/lifecycle` **governs**. The lifecycle engine consumes
`score + drift + guardrail + approval` and manages `effectiveMode` via `Transition`s. No
domain term appears in either.

---

## 3. The architecture: hexagonal (ports & adapters)

Three rings, one mechanically-enforced dependency rule.

```
                ┌───────────────────────────────────────────┐
                │                  apps/                      │  composition root
                │   api (HTTP, machine-key auth)  ·  web      │  wires everything
                └───────────────▲─────────────▲───────────────┘
                                │             │
        ┌───────────────────────┘             └───────────────────────┐
        │                                                             │
 ┌──────┴───────────┐                                       ┌─────────┴─────────┐
 │   adapters/       │   emit CanonicalEvents only           │   persistence/     │
 │  gateway          │──────────────┐         ┌──────────────│  Prisma + tenant-  │
 │  sdk              │              ▼         ▼               │  guard (driven)    │
 │  connectors/*     │        ┌─────────────────────┐        └─────────┬─────────┘
 │  (anti-corruption │        │        core/         │                  │
 │   layers)         │        │  canonical model,    │◀─────────────────┘
 └──────┬───────────┘         │  readiness engine,   │   implements core ports
        │                     │  ladder, policy,     │
        │ depends on          │  audit  (PURE)       │
        ▼                     └──────────▲───────────┘
 ┌──────────────┐                        │ depends on
 │  contracts/  │◀───────────────────────┘
 │ (events,     │
 │  primitives, │   dependency-free
 │  ports)      │
 └──────────────┘
```

### Packages

| Package | Contains | May import |
|---|---|---|
| `contracts` | canonical events, verdict primitives, port interfaces | **nothing** |
| `core` | readiness engine, ladder, policy, governance, audit — pure domain logic | `contracts` only |
| `persistence` | Prisma repos implementing core ports; tenant-guard lives here | `contracts`, `core` ports |
| `adapters/gateway` | LLM proxy → canonical events | `contracts` (+ adapter-sdk) |
| `adapters/sdk` | `@provable/sdk` → canonical events | `contracts` |
| `adapters/connectors/*` | Zendesk, GitHub, SAP… each an anti-corruption layer | `contracts` |
| `apps/api`, `apps/web` | composition + HTTP + dashboard | everything |

### The dependency rule (the thing that keeps it universal)

```
contracts → (nothing)
core      → contracts                       # NEVER an adapter, NEVER a vendor name
adapters  → contracts                       # NEVER core internals
persistence → contracts + core ports
apps      → all of the above                # the only place wiring happens
```

**Enforced, not aspirational:** a `dependency-cruiser` (or eslint-boundaries) rule fails CI
if `core` imports any adapter or any domain term. `core` literally cannot list an adapter in
its `package.json`. This is what guarantees "any agent" by construction.

---

## 4. The Adapter port (one contract, every ingestion mode)

An adapter's only job: translate a foreign system into a stream of `CanonicalEvent`s. It
returns canonical types **only** — never a `Ticket`, `PullRequest`, or `Invoice`.

```ts
interface IngestionAdapter {
  id: string;                                  // "connector:zendesk"
  // choose whichever the source supports:
  poll?(cursor?: string):  Promise<{ events: CanonicalEvent[]; cursor?: string }>;
  webhook?(payload: unknown): CanonicalEvent[];
  proxy?(req: unknown, res: unknown): CanonicalEvent[];
}
```

The **ingestion orchestration** — upsert agent/task → persist decision → resolve verdicts →
trigger recompute — lives in the composition root (`apps/api`) and runs as one atomic,
tenant-scoped transaction. `core` stays pure: it exposes **outbound port interfaces** only (the
readers/writers a recompute needs), `persistence` **implements** them, and `apps/api` wires those
concrete repos to core's pure compute functions. Core still depends on no adapter and no
persistence. **That inversion is the whole design.**

---

## 5. Universality, proved — and its one honest limit

**Every agent on earth sits on a 2×2**, and every cell is served by the adapter framework:

| | Verdict in **same** system | Verdict in **separate** system | Verdict **nowhere explicit** |
|---|---|---|---|
| **Runtime you control** | gateway/SDK + same-system verdict | gateway/SDK + 2nd adapter | gateway + inference / 1-line instrument |
| **Vendor SaaS runtime** | one platform connector (both sides) | connector + 2nd adapter | connector + inference |

Support was just the top-right-ish cell. Nothing in core knows that.

**The one universal boundary (state it honestly):** readiness needs *some* verdict/outcome
signal. An agent running fully autonomous with zero downstream signal can only be
**Observed** (activity + cost), never **Scored**. True in every domain — a property of
information, not a gap in the product.

---

## 6. What is explicitly BANNED from `core`

The anti-leak list. If any of these appear in `core` or `contracts`, the architecture is broken:

- Vendor names (Zendesk, Intercom, GitHub, SAP, Salesforce…).
- Domain nouns: ticket, refund, PR, commit, invoice, claim, contract, candidate.
- Domain thresholds or domain-specific scoring tweaks.
- Any import from an adapter or connector.

**Core's entire vocabulary:** `org, agent, task, decision, verdict, outcome, score, mode,
policy, audit`. Nothing else.

---

## 7. Why this answers "build a product for any type of agent"

- The **core ships once** and never changes per domain.
- A new agent type / system = **a new adapter**, never a product change.
- Adapters are an **extensibility point**: an Adapter SDK lets you — then customers and
  partners — add systems cheaply. "Any agent" becomes a property of the *framework*, not a
  backlog of hand-built integrations.
- The **first adapter you implement** is whatever your first real user runs — but it is the
  first *instance* of a general mechanism, so the product never narrows to it.

---

## 8. Build order implied by this spec

1. `contracts` — events, primitives, ports. (Tiny, dependency-free, lock it first.)
2. `core` — readiness engine + ladder + policy operating only on contracts; unit-tested with
   synthetic canonical events (no adapters needed to test scoring).
3. `persistence` — Prisma repos + tenant-guard implementing core ports.
4. `apps/api` — composition root + ingestion port over HTTP (machine-key auth).
5. **One reference adapter** (the first real user's system) — proves the loop end-to-end.
6. `apps/web` — the universal dashboard over core's read models.
7. Adapter SDK — open the framework for the next N systems.

CI gate from step 1 onward: the dependency-rule check + tenant-isolation check stay green.
```
