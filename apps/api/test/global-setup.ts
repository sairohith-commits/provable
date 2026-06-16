import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

// Load DB creds and ensure migrations are applied (idempotent) before the suite.
export default function setup(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, '..', '..', '..');
  config({ path: resolve(repoRoot, 'packages', 'persistence', '.env') });
  execSync('pnpm -F @provable/persistence exec prisma migrate deploy', {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });
}
