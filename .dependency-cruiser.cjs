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
    {
      name: 'contracts-src-self-contained',
      severity: 'error',
      comment:
        'contracts SOURCE is the dependency-free leaf — it imports ONLY its own local files: no npm ' +
        '(prod OR dev), no Node built-ins, no other workspace package. (Scoped to src/ so tests may ' +
        'use the runner.)',
      from: { path: '^packages/contracts/src/' },
      to: { dependencyTypesNot: ['local'] },
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
    {
      name: 'core-src-only-contracts',
      severity: 'error',
      comment:
        'core SOURCE may import ONLY local core files + @provable/contracts. This forbids Node ' +
        'built-ins (no I/O/clock), any npm package (framework/vendor SDK), and any other workspace ' +
        'package. PROVABLE_CORE_ARCHITECTURE.md §3/§6. (Scoped to src/ so tests may use the runner.)',
      from: { path: '^packages/core/src/' },
      to: {
        dependencyTypesNot: ['local'],
        pathNot: '(@provable/contracts|^packages/contracts/)',
      },
    },

    // ── adapters speak ONLY the canonical contract (among workspace pkgs) ─────
    // An adapter is an anti-corruption layer: it maps foreign data to canonical events and
    // nothing more. Among internal packages it may import @provable/contracts ONLY — never core
    // (no engine internals), persistence (no DB), api/web (no composition root). npm deps (zod)
    // and Node built-ins are allowed — the boundary is about WORKSPACE coupling, not all imports.
    // (Scoped to src/ so tests may use the runner.) PROVABLE_CORE_ARCHITECTURE.md §3/§4.
    {
      name: 'adapters-only-contracts',
      severity: 'error',
      comment:
        'adapters import @provable/contracts ONLY among workspace packages; never core, ' +
        'persistence, api, or web (§3/§4). The inversion — core↛adapters — is enforced separately.',
      from: { path: '^packages/adapters/src/' },
      to: {
        path: '(^packages/(core|persistence)/|^apps/|@provable/(core|persistence|api|web))',
      },
    },

    // ── persistence may import contracts + core (ports) — NOT adapters/apps ──
    {
      name: 'persistence-no-adapters-or-apps',
      severity: 'error',
      comment:
        'persistence implements core ports (so persistence → core is allowed, §3); it must not ' +
        'reach adapters or apps.',
      from: { path: '^packages/persistence/' },
      to: { path: '^(packages/adapters/|apps/)' },
    },

    // ── apps/web is a PURE HTTP client — contracts (types) only among internal pkgs ──
    {
      name: 'web-only-contracts',
      severity: 'error',
      comment:
        'apps/web talks to the API over HTTP. Among internal packages it imports ONLY ' +
        '@provable/contracts (types) — never persistence, core, or the api package (no DB ' +
        'credentials, no shared server code). Phase 7.',
      from: { path: '^apps/web/src/' },
      to: { path: '(^packages/(persistence|core)/|@provable/(persistence|core|api))' },
    },

    // ── apps are the composition root — nothing may import them ──────────────
    {
      name: 'nothing-imports-apps',
      severity: 'error',
      comment:
        'apps/* wire everything; no package or other app dependency points INTO an app (§3). Matches ' +
        'both a resolved apps/ path and the app package names (which are unresolvable from a ' +
        'non-dependent package, hence matched by specifier).',
      from: { pathNot: '^apps/' },
      to: { path: '(^apps/|^@provable/(api|web)$)' },
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
    // Capture type-only imports too (so a leaked vendor TYPE is still seen).
    tsPreCompilationDeps: true,
    // Resolve bare specifiers (`@provable/contracts`, npm pkgs) reliably under
    // pnpm + NodeNext: enhanced-resolve needs the TS/declaration extensions and
    // the package `exports` conditions, otherwise these edges silently drop and
    // the npm/purity gates become vacuous.
    enhancedResolveOptions: {
      extensions: ['.ts', '.d.ts', '.tsx', '.js', '.jsx', '.json'],
      mainFields: ['types', 'module', 'main'],
      exportsFields: ['exports'],
      conditionNames: ['types', 'import', 'node', 'default'],
    },
    // doNotFollow (NOT includeOnly/exclude): keep the dependency EDGES into
    // node_modules, Node built-ins, AND our own built dist/ (a workspace import like
    // `@provable/api` resolves to `apps/api/dist/...`) so the path/type rules above
    // can fire on them — we just don't recurse into those modules. `exclude` would
    // DROP those edges and silently neuter the gates. The cruise entry points are
    // src/ only (see the depcruise script), so dist is never cruised as a source.
    doNotFollow: { path: '(node_modules|/dist/)' },
  },
};
