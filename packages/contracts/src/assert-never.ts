/**
 * Exhaustiveness helper. Placing `assertNever(x)` in the `default` branch of a
 * switch over a closed union makes the compiler reject the code the moment a new
 * union member is added without a matching case — `x` would no longer be `never`.
 *
 * This is one of only two runtime exports in the whole package (the other being
 * the `as const` arrays). Everything else is type-level.
 */
export function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(x)}`);
}
