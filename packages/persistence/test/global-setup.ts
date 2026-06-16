import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

// Runs once before the suite: load env and apply migrations to a fresh DB
// (idempotent — "no pending migrations" on an already-migrated DB). This makes
// `pnpm test` self-contained given a running Postgres (docker compose up -d).
export default function setup(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgDir = resolve(here, '..');
  config({ path: resolve(pkgDir, '.env') });
  execSync('pnpm exec prisma migrate deploy', { cwd: pkgDir, stdio: 'inherit', env: process.env });
}
