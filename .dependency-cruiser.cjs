// @ts-check
/**
 * Provable — architecture gate (dependency-cruiser).
 *
 * The mechanically-enforced dependency rule from PROVABLE_CORE_ARCHITECTURE.md §3:
 *
 *   contracts   -> (nothing)
 *   core        -> contracts                 # NEVER an adapter, NEVER a vendor name
 *   adapters    -> contracts                 # NEVER core internals
 *   persistence -> contracts + core ports
 *   apps        -> all of the above          # the only place wiring happens
 *
 * Phase 1 only ships `packages/contracts`. The `core`/`adapters`/`apps`/`persistence`
 * rules below are ACTIVE (not commented) so they cannot rot — they simply match nothing
 * until those packages land, then enforce the forward law by construction.
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies are forbidden everywhere.',
      from: {},
      to: { circular: true },
    },

    // ── contracts is the leaf ────────────────────────────────────────────────
    {
      name: 'contracts-is-leaf',
      severity: 'error',
      comment:
        'contracts depends on NOTHING in the workspace. It is the dependency-free lingua franca.',
      from: { path: '^packages/contracts/' },
      to: { path: '^(packages/(?!contracts/)|apps/)' },
    },
    {
      name: 'contracts-zero-runtime-deps',
      severity: 'error',
      comment:
        'contracts has ZERO runtime dependencies. Only devDependencies (npm-dev) may be imported, ' +
        'and only from test files.',
      from: { path: '^packages/contracts/' },
      to: { dependencyTypes: ['npm'] },
    },

    // ── core forward law (pre-encoded for later phases) ─────────────────────
    {
      name: 'core-only-imports-contracts',
      severity: 'error',
      comment:
        'core (the pure domain) may import ONLY contracts among workspace packages — ' +
        'NEVER an adapter, app, persistence, or vendor SDK. PROVABLE_CORE_ARCHITECTURE.md §3/§6.',
      from: { path: '^packages/core/' },
      to: { path: '^(packages/(?!core/|contracts/)|apps/)' },
    },
    {
      name: 'core-no-adapters-or-apps',
      severity: 'error',
      comment: 'core must never reach an adapter or an app. The inversion is the whole design (§4).',
      from: { path: '^packages/core/' },
      to: { path: '^(packages/adapters/|apps/)' },
    },

    // ── adapters never reach into core internals ────────────────────────────
    {
      name: 'adapters-only-contracts',
      severity: 'error',
      comment: 'adapters speak only the canonical contract; never core internals (§3).',
      from: { path: '^packages/adapters/' },
      to: { path: '^packages/core/' },
    },

    // ── persistence may import contracts + core ports only ──────────────────
    {
      name: 'persistence-no-adapters-or-apps',
      severity: 'error',
      comment: 'persistence implements core ports; it must not reach adapters or apps (§3).',
      from: { path: '^packages/persistence/' },
      to: { path: '^(packages/adapters/|apps/)' },
    },

    /*
     * ── FORWARD LAW: no vendor names / domain nouns in core or contracts ─────
     * PROVABLE_CORE_ARCHITECTURE.md §6 bans vendor names and domain nouns from
     * `core`/`contracts`. Path-based cruising cannot read identifiers, so this is
     * kept commented-ready: uncomment (and extend the alternation) once vendor
     * SDKs exist in the tree to forbid them from being imported by core/contracts.
     *
     * {
     *   name: 'core-no-vendor-sdks',
     *   severity: 'error',
     *   comment: 'No vendor SDK may be imported by core or contracts (§6 anti-leak list).',
     *   from: { path: '^packages/(contracts|core)/' },
     *   to: {
     *     path:
     *       'node_modules/(zendesk|@zendesk|intercom|@octokit|@slack|salesforce|jsforce|' +
     *       'sap|@sap|stripe|openai|@anthropic-ai)',
     *   },
     * },
     */
  ],

  options: {
    tsConfig: { fileName: 'tsconfig.base.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'types', 'node', 'default'],
    },
    doNotFollow: { path: 'node_modules' },
    includeOnly: '^(packages|apps)/',
    exclude: { path: '(/dist/|/node_modules/)' },
  },
};
