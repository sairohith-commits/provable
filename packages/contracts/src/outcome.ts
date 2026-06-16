/**
 * Outcome — the async ground-truth axis (PROVABLE_CORE_ARCHITECTURE.md §1.2).
 *
 * Eventual ground truth, when knowable. Values are UPPERCASE per the locked doc
 * (`type Outcome = "SUCCESS" | "PARTIAL" | "FAILURE"`).
 *
 * The `as const` array is the single source of truth; the union is derived from
 * it (Phase 4 zod / Phase 5 Pydantic mirror this array, and the tests iterate it).
 */
export const OUTCOMES = ['SUCCESS', 'PARTIAL', 'FAILURE'] as const;

export type Outcome = (typeof OUTCOMES)[number];
