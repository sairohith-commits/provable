/**
 * @provable/contracts — the dependency-free lingua franca.
 *
 * Canonical decision model, the closed verdict primitive set, the async resolver,
 * lifecycle vocabulary (types only), and port interfaces. The entire runtime
 * surface is the `as const` arrays + `assertNever`; everything else is type-level.
 */

export * from './identifiers.js';
export * from './verdict.js';
export * from './outcome.js';
export * from './source.js';
export * from './decision.js';
export * from './events.js';
export * from './lifecycle.js';
export * from './ports.js';
export * from './rbac.js';
export * from './assert-never.js';
