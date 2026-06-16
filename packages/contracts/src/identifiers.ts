/**
 * Branded string identifiers — nominal safety only, ZERO runtime cost.
 *
 * Each is structurally a `string`, so it serialises/compares like one, but the
 * phantom `__brand` makes the compiler refuse to mix an `OrgId` with an
 * `AgentKey` (etc.). Per PROVABLE_CORE_ARCHITECTURE.md §1.1 these are plain
 * strings on the wire; the brand exists purely to catch transposed arguments at
 * compile time.
 */

export type OrgId = string & { readonly __brand: 'OrgId' };
export type AgentKey = string & { readonly __brand: 'AgentKey' };
export type TaskKey = string & { readonly __brand: 'TaskKey' };
export type DecisionId = string & { readonly __brand: 'DecisionId' };
export type ExternalRef = string & { readonly __brand: 'ExternalRef' };
