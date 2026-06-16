/**
 * @provable/core — the moat. Pure, deterministic domain logic over @provable/contracts.
 *
 * Two sub-domains:
 *   - readiness: the locked formula mapping verdict/outcome primitives → a score + band.
 *   - lifecycle: the governed autonomy state machine (effectiveMode via Transitions)
 *     and the agent identity state machine.
 *
 * No I/O, no clock, no randomness, no framework — imports ONLY @provable/contracts.
 */

export * from './policy.js';
export * from './readiness.js';
export * from './signals.js';
export * from './lifecycle.js';
export * from './identity.js';
