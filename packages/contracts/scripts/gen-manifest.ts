import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANIFEST_FILENAME, buildManifest, serializeManifest } from './manifest.js';

// Writes the committed contract-manifest.json from the const arrays.
const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '..', MANIFEST_FILENAME);
writeFileSync(outPath, serializeManifest(buildManifest()));
console.log(`wrote ${outPath}`);
