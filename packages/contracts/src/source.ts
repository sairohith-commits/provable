/**
 * Source — adapter-origin / provenance (PROVABLE_CORE_ARCHITECTURE.md §1.1).
 *
 * The doc types `source` as a free `string` and gives the values
 * `"gateway" | "connector:zendesk" | "sdk" | "otel"` (line 57). We model it as a
 * CLOSED set of origin *kinds* instead, because:
 *   - every closed set must be a single-source-of-truth array;
 *   - §6 BANS vendor names from `contracts`/`core`, so the value
 *     `"connector:zendesk"` cannot be baked in as a literal here. The specific
 *     connector vendor is carried at runtime (e.g. via `externalRef`/`metadata`),
 *     never as a contracts literal.
 *
 * Every member is named by the doc:
 *   - gateway (line 57, verbatim) — LLM proxy
 *   - sdk     (line 57, verbatim) — in-process SDK adapter
 *   - otel    (line 57, verbatim) — telemetry instrumentation
 *   - connector — the §6-safe normalization of the doc's `"connector:zendesk"`
 *     (vendor suffix stripped); the "connector" kind also appears in §3/§5 prose.
 */
export const SOURCES = ['gateway', 'sdk', 'connector', 'otel'] as const;

export type Source = (typeof SOURCES)[number];
