import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MANIFEST_FILENAME, buildManifest } from '../scripts/manifest.js';

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(here, '..', MANIFEST_FILENAME);

describe('contract manifest is in lockstep with the const arrays', () => {
  it('the committed contract-manifest.json equals the freshly-built manifest', () => {
    const committed = JSON.parse(readFileSync(manifestPath, 'utf8'));
    // If a const array changed without re-running `pnpm -F @provable/contracts gen:manifest`,
    // the committed file is stale and this fails (and the Python drift test would too).
    expect(committed).toEqual(buildManifest());
  });
});
