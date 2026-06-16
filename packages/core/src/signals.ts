/**
 * Lifecycle INPUT signals. Core only CONSUMES these — the drift-detection
 * algorithm and the guardrail rule engine are later phases. Here they are just
 * typed evidence the lifecycle engine reacts to.
 */

/** A sustained negative deviation from baseline (detection is a later phase). */
export interface DriftSignal {
  readonly detectedAt: string; // ISO
  readonly reason: string; // evidence: which metric, how far from baseline
  readonly magnitude?: number; // optional severity, 0..1
}

/** A pre-action guardrail gate trip (the rule engine is a later phase). */
export interface GuardrailTrip {
  readonly guardrailId: string;
  readonly trippedAt: string; // ISO
  readonly reason: string;
}

/** A human decision on a pending promotion proposal. */
export type ManualDecision =
  | { readonly kind: 'APPROVE'; readonly approver: string; readonly at: string; readonly reason?: string }
  | { readonly kind: 'REJECT'; readonly approver: string; readonly at: string; readonly reason?: string };
