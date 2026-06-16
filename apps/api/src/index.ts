/**
 * @provable/api — Fastify ingestion + zod gatekeeper + synchronous atomic recompute.
 * The composition root that wires core's pure compute functions to persistence's
 * concrete repos (typed as core's outbound ports).
 */
export { buildApp } from './app.js';
export type { BuildAppOptions } from './app.js';
export { generateApiKey, hashApiKey } from './auth.js';
export { recompute } from './recompute.js';
export type { RecomputeResult, RecomputeNotFound } from './recompute.js';
