import type { Decision } from './decision.js';
import type { ExternalRef, OrgId } from './identifiers.js';
import type { Outcome } from './outcome.js';
import type { Source } from './source.js';
import type { Verdict } from './verdict.js';

/**
 * VerdictEvent — the async resolver (PROVABLE_CORE_ARCHITECTURE.md §1.2).
 *
 * Resolves a prior PENDING `Decision` asynchronously, linked by `externalRef`.
 * Carries the resolved `verdict` and/or `outcome`. Unlike `Decision`,
 * `externalRef` is REQUIRED here — it is the link key back to the Decision.
 */
export interface VerdictEvent {
  orgId: OrgId;
  source: Source;
  externalRef: ExternalRef; // links to Decision.externalRef
  verdict?: Verdict;
  outcome?: Outcome;
  at: string;
}

/** The two canonical events an adapter may emit (§1.2). */
export type CanonicalEvent = Decision | VerdictEvent;
