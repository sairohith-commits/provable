import type { Cost, Outcome, Source, Verdict } from '@provable/contracts';

/**
 * The adapter framework's emission type — a canonical Decision/VerdictEvent MINUS the fields the
 * composition root owns: `id` (Provable-assigned at persistence) and `orgId` (from machine-key
 * auth). An adapter has NO way to set a tenant, so a payload that names a different org simply
 * cannot leak — tenant safety is structural, not a runtime check.
 *
 * `externalRef` is REQUIRED on a mapped decision (idempotency on a redelivery-prone path): the
 * source must supply a stable id. Shapes the existing recompute `TrackBody`, which the
 * composition root converts to 1:1.
 */
export interface MappedDecision {
  readonly type: 'decision';
  readonly agentKey: string;
  readonly taskKey: string;
  readonly at?: string;
  readonly action: unknown; // OPAQUE to core
  readonly confidence?: number;
  readonly cost?: Cost;
  readonly verdict?: Verdict; // absent ⇒ Observe-only (readiness N/A, never fabricated)
  readonly outcome?: Outcome;
  readonly source: Source;
  readonly externalRef: string; // REQUIRED — idempotency key
  readonly metadata?: Record<string, unknown>;
}

export interface MappedVerdictEvent {
  readonly type: 'verdict';
  readonly source: Source;
  readonly externalRef: string;
  readonly verdict?: Verdict;
  readonly outcome?: Outcome;
  readonly at?: string;
}

export type MappedEvent = MappedDecision | MappedVerdictEvent;

/**
 * A connector: an anti-corruption layer. Its ONLY job is to validate a foreign payload and map
 * it to canonical mapped events. It never ingests, never touches a DB, never sees a tenant — the
 * composition root stamps orgId and feeds the result to the existing recompute path.
 */
export interface Connector {
  readonly id: string;
  /** Validate (throws on invalid input) + map an external payload to canonical mapped events. */
  map(payload: unknown): MappedEvent[];
}
