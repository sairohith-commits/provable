import type { AgentKey, DecisionId, ExternalRef, OrgId, TaskKey } from './identifiers.js';
import type { Outcome } from './outcome.js';
import type { Source } from './source.js';
import type { Verdict } from './verdict.js';

/** Agent self-reported confidence, 0.0 – 1.0 (PROVABLE_CORE_ARCHITECTURE.md §1.1). */
export type Confidence = number;

/** Telemetry — never governance logic. All fields optional. */
export interface Cost {
  tokens?: number;
  usd?: number;
  latencyMs?: number;
}

/**
 * The Canonical Decision Model — the unit of governance (§1.1).
 *
 * One task-level judgment by an agent. A Decision may internally involve many
 * LLM/tool calls; those are telemetry (`cost`). It is created with `verdict:
 * { kind: 'PENDING' }` and resolved later by a `VerdictEvent` keyed to the same
 * `externalRef`.
 *
 * `action` is OPAQUE to the core — typed `unknown` per the doc. Core never reads
 * it; it is never a domain-specific shape.
 *
 * Idempotency: `(source, externalRef)` is the dedup key.
 */
export interface Decision {
  id: DecisionId; // Provable-assigned
  orgId: OrgId; // tenant
  agentKey: AgentKey; // org-scoped stable agent name (NOT an internal id)
  taskKey: TaskKey; // org-scoped task name, e.g. "classify"
  at: string; // ISO timestamp of the decision

  action: unknown; // OPAQUE to core — a label, text, or reference. Core never reads it.
  confidence?: Confidence; // agent self-reported, if available

  cost?: Cost; // telemetry, never governance logic

  verdict: Verdict; // may start as PENDING and resolve later
  outcome?: Outcome; // eventual ground truth, may arrive async

  source: Source; // provenance
  // TODO(later): tighten to PENDING ⇒ externalRef required (discriminate on
  // verdict) — current flat-optional permits an un-resolvable PENDING decision.
  externalRef?: ExternalRef; // id in the source system — idempotency + linkback
  metadata?: Record<string, unknown>; // opaque bag
}
