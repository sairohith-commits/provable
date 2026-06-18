// BYOC bootstrap — IDEMPOTENT + ORDERED. Runs once before the app containers start.
//   1) create the scoped NON-OWNER app role (owner/DIRECT_URL)
//   2) prisma migrate deploy (owner/DIRECT_URL)
//   3) seed BOOTSTRAP_OWNER_EMAIL as the first Owner (app role/DATABASE_URL, via assignRole)
// Re-running is safe. This resolves the Phase B org-Owner deploy-ordering gate (no lockout).
//
// Imports ONLY @provable/persistence (a workspace symlink that resolves @prisma/client under
// pnpm); migrate runs via pnpm exec in the persistence package context.
import { execSync } from 'node:child_process';
// Relative dist import (like the other root scripts): @prisma/client + contracts resolve from
// persistence's own node_modules. A bare '@provable/persistence' would not resolve from /scripts.
import { assignRole, bootstrapAppRole, disconnect } from '../packages/persistence/dist/index.js';

const env = process.env;
const APP_ROLE = env['APP_DB_ROLE'] ?? 'provable_app';
const required = ['DIRECT_URL', 'DATABASE_URL', 'APP_DB_PASSWORD', 'POSTGRES_DB', 'WORKSPACE_ORG_ID', 'BOOTSTRAP_OWNER_EMAIL'];
for (const k of required) {
  if (!env[k]) {
    console.error(`[bootstrap] missing required env ${k}`);
    process.exit(2);
  }
}
if (!/^[A-Za-z0-9_\-.]+$/.test(env['APP_DB_PASSWORD'])) {
  console.error('[bootstrap] APP_DB_PASSWORD must be [A-Za-z0-9_-.] only (it is interpolated into CREATE ROLE)');
  process.exit(2);
}

// 1) Non-owner, RLS-scoped app role (idempotent).
await bootstrapAppRole({
  directUrl: env['DIRECT_URL'],
  role: APP_ROLE,
  password: env['APP_DB_PASSWORD'],
  database: env['POSTGRES_DB'],
});
console.log(`[bootstrap] app role "${APP_ROLE}" ensured (non-owner, RLS-scoped)`);

// 2) Migrations (owner/DIRECT_URL): tables + grants + RLS policies.
execSync('pnpm --filter @provable/persistence exec prisma migrate deploy', { stdio: 'inherit' });
console.log('[bootstrap] migrations applied');

// 3) Ensure the single workspace org + seed the first Owner (app role/DATABASE_URL). Idempotent.
await assignRole(env['WORKSPACE_ORG_ID'], env['BOOTSTRAP_OWNER_EMAIL'], 'OWNER');
await disconnect();
console.log(`[bootstrap] org "${env['WORKSPACE_ORG_ID']}" + Owner "${env['BOOTSTRAP_OWNER_EMAIL']}" ensured`);
console.log('[bootstrap] done');
