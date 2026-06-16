# PROVABLE — Tech Stack (locked)

> Fresh repo. Goal: **investor / accelerator pitch** — a thin but *real* vertical slice of the
> universal architecture (see PROVABLE_CORE_ARCHITECTURE.md), demoable and credible.
> Optimised for: fastest path to a clean demo, fewest moving parts, Claude Code builds + tests all.

---

## Decision: hybrid language

- **TypeScript** — the entire control plane (`contracts · core · persistence · adapters · apps`).
- **Python** — the SDK adapter only.

Rationale: one shared `contracts` package across backend **and** the Next.js dashboard (single
source of truth, compile-time end-to-end); single toolchain for the control plane. Python where
it belongs — the SDK, native to customers' (mostly-Python) agents. The two speak the canonical
wire contract, which is itself a pitch flourish: *Python agent → TS core, same contract = proof
of language-agnostic universality.*

---

## Stack by layer

| Layer | Choice | Notes |
|---|---|---|
| Monorepo | **pnpm + Turborepo** | packages: `contracts · core · persistence · adapters/* · apps/{api,web}` |
| Python SDK | isolated `sdk-python/` | own **uv** toolchain, outside the Turbo pipeline |
| Contracts | **TypeScript types** | canonical decision model + verdict primitives + ports; dependency-free |
| Core | **pure TS, no framework** | readiness engine + lifecycle state machine; **Vitest** |
| Arch rule | **dependency-cruiser** in CI | fails build if `core` imports an adapter or domain term |
| Validation | **zod** (API boundary) · **Pydantic** (SDK) | API zod check is the contract gatekeeper |
| DB | **PostgreSQL (Neon) + Prisma** | tenant-guard extension; `orgId` everywhere |
| API | **Fastify** | machine-key auth; ingestion endpoint |
| Recompute | **synchronous, in-process** | NO BullMQ / Redis. event in → recompute → lifecycle transition, one request. Deterministic "watch the score cross live" demo. Queue is a post-pitch scale concern. |
| Frontend | **Next.js (App Router) + Tailwind v4 + shadcn + Recharts** | light-glass design; v3 only if a shadcn component forces it |
| Auth | **Clerk Organizations** | minimal/single-org for the demo; multi-tenant data model retained |
| Hosting | **Web → Vercel · API → Render · DB → Neon** | Vercel preview URLs = shareable pitch link; no Redis |
| Tests | Vitest (core/api) · Playwright (web E2E) · pytest (SDK) | all by Claude Code |

---

## Division of labor

- **Claude Code** — all implementation + tests, against phased acceptance gates.
- **Rohith** — infra account setup (Vercel / Render / Neon) and env vars; decisions + orchestration.

## Deliberately deferred (NOT in the pitch build)

Self-hosting (Docker/Helm), billing/plan-gating, the connector library, BullMQ/Redis,
multi-tenant hardening. All are slide line-items for the pitch, not code.

## Standing gates (green every phase)

1. `dependency-cruiser` architecture rule.
2. Minimal tenant-isolation check (`orgId` scoping holds).
