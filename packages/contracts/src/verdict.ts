/**
 * Verdict — the closed primitive set (PROVABLE_CORE_ARCHITECTURE.md §1.2).
 *
 * The entire vocabulary of "what happened to the agent's judgment". Adapters map
 * their domain's signals onto these; the core only ever sees these.
 *
 *   ACCEPTED   — output used as-is
 *   OVERRIDDEN — a human changed the output (optional 0..1 magnitude)
 *   ESCALATED  — agent handed off to a human
 *   FAILED     — action errored or was rejected outright
 *   PENDING    — not yet resolved (transient; resolved later by a VerdictEvent)
 *
 * `VERDICT_KINDS` is the single source of truth for the discriminant; the
 * discriminated `Verdict` union below is pinned to it by the lockstep test.
 */
export const VERDICT_KINDS = ['PENDING', 'ACCEPTED', 'OVERRIDDEN', 'ESCALATED', 'FAILED'] as const;

export type VerdictKind = (typeof VERDICT_KINDS)[number];

export type Verdict =
  | { kind: 'PENDING' }
  | { kind: 'ACCEPTED' }
  | { kind: 'OVERRIDDEN'; magnitude?: number } // magnitude 0..1, optional
  | { kind: 'ESCALATED' }
  | { kind: 'FAILED' };
