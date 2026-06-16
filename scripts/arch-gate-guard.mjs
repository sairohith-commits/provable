#!/usr/bin/env node
/**
 * Architecture-gate guard (permanent, automated).
 *
 * The dependency-cruiser gate has silently vacated TWICE due to config regressions
 * (an `includeOnly`/`exclude` that pruned the very edges the rules check). A passing
 * `depcruise` only proves "no CURRENT violations" — it does NOT prove the gate can
 * still SEE a violation. This guard proves the latter: it plants known-bad imports as
 * throwaway fixtures and asserts each is REPORTED by the gate. If any bad import is
 * NOT reported, the guard exits non-zero — so a future config regression that
 * re-vacates the gate fails CI loudly instead of silently.
 *
 * Run: `node scripts/arch-gate-guard.mjs` (also wired as `pnpm arch:guard` + a CI step).
 */
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, writeFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = '.dependency-cruiser.cjs';
const FIXTURE = '__arch_guard__.ts';

/** Known-bad imports that MUST be reported, with the rule(s) that should fire. */
const cases = [
  {
    name: 'core → persistence',
    dir: 'packages/core/src',
    code: `import { withTenant } from '@provable/persistence';\nexport const _guard = withTenant;\n`,
    expectRules: ['core-src-only-contracts'],
  },
  {
    name: 'core → api (apps)',
    dir: 'packages/core/src',
    code: `import { buildApp } from '@provable/api';\nexport const _guard = buildApp;\n`,
    expectRules: ['core-src-only-contracts', 'nothing-imports-apps'],
  },
  {
    name: 'persistence → api (apps)',
    dir: 'packages/persistence/src',
    code: `import { buildApp } from '@provable/api';\nexport const _guard = buildApp;\n`,
    expectRules: ['nothing-imports-apps'],
  },
  {
    name: 'core → node builtin (node:fs)',
    dir: 'packages/core/src',
    code: `import * as fs from 'node:fs';\nexport const _guard = fs;\n`,
    expectRules: ['core-src-only-contracts'],
  },
];

/** Cruise the given (already-quoted) path args; return { exitCode, output }. */
function cruise(quotedPathArgs) {
  try {
    const output = execSync(`pnpm exec depcruise ${quotedPathArgs} --config ${CONFIG}`, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, output };
  } catch (err) {
    return {
      exitCode: typeof err.status === 'number' ? err.status : 1,
      output: `${err.stdout ?? ''}${err.stderr ?? ''}`,
    };
  }
}

let failures = 0;

// 1) The clean tree must currently PASS (a sanity baseline + no stray fixtures).
{
  const { exitCode, output } = cruise('"packages/*/src" "apps/*/src"');
  if (exitCode !== 0) {
    failures += 1;
    console.error(`✘ baseline: expected a clean cruise to pass, but it reported violations:\n${output}`);
  } else {
    console.log('✓ baseline: clean tree passes');
  }
}

// 2) Each known-bad import must be REPORTED (non-zero exit + the expected rule named).
for (const c of cases) {
  const rel = `${c.dir}/${FIXTURE}`;
  const abs = resolve(root, rel);
  writeFileSync(abs, c.code);
  try {
    const { exitCode, output } = cruise(`"${rel}"`);
    const reported = exitCode !== 0 && c.expectRules.some((r) => output.includes(r));
    if (reported) {
      console.log(`✓ reported: ${c.name}`);
    } else {
      failures += 1;
      console.error(
        `✘ NOT reported: ${c.name} (exit=${exitCode}). The gate failed to flag a known-bad import — ` +
          `the architecture gate may have silently vacated.\n${output}`,
      );
    }
  } finally {
    rmSync(abs, { force: true });
  }
}

if (failures > 0) {
  console.error(`\narch-gate guard FAILED: ${failures} check(s) did not behave as required.`);
  process.exit(1);
}
console.log('\narch-gate guard PASSED: every known-bad import is reported by the gate.');
