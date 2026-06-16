import type { CanonicalEvent } from './events.js';

/**
 * Port interfaces (PROVABLE_CORE_ARCHITECTURE.md §4; listed as a Phase 1
 * deliverable in PROVABLE_BUILD_PLAN.md §1). Type-only — zero runtime surface.
 */

/**
 * The driving adapter contract. An adapter's only job: translate a foreign
 * system into a stream of `CanonicalEvent`s. It returns canonical types ONLY —
 * never a domain noun. An adapter implements whichever ingestion mode(s) its
 * source supports.
 */
export interface IngestionAdapter {
  id: string; // e.g. "gateway", "sdk", a connector id
  poll?(cursor?: string): Promise<{ events: CanonicalEvent[]; cursor?: string }>;
  webhook?(payload: unknown): CanonicalEvent[];
  proxy?(req: unknown, res: unknown): CanonicalEvent[];
}

/**
 * The single driven ingestion port the core exposes. It accepts
 * `CanonicalEvent[]` and (in later phases) upserts agent/task → persists the
 * decision → resolves verdicts → triggers recompute. Adapters depend on this
 * port; core depends on no adapter. That inversion is the whole design.
 */
export interface IngestionPort {
  ingest(events: CanonicalEvent[]): Promise<void>;
}
