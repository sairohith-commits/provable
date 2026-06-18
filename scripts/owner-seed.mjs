// LIVE-deploy owner seed (Phase B gate 2) — runs between `prisma migrate deploy` and serve.
// Idempotently ensures the org's first Owner so deny-by-default RBAC never locks the dashboard
// out. Reuses the same assignRole logic as the BYOC bootstrap, but for the multi-tenant deploy.
//
// SAFE BY DESIGN:
//   • NO-OP (exit 0) if BOOTSTRAP_OWNER_EMAIL is unset → never breaks a deploy.
//   • Re-runnable every deploy (assignRole upserts the membership; orgRepo.ensure upserts the org).
//   • Runs as the app role (DATABASE_URL) via withTenant — RLS-scoped, no owner bypass needed.
//
// orgId = BOOTSTRAP_OWNER_ORG ?? WORKSPACE_ORG_ID, email = BOOTSTRAP_OWNER_EMAIL, role = OWNER.
import { assignRole, disconnect } from '../packages/persistence/dist/index.js';

const email = process.env['BOOTSTRAP_OWNER_EMAIL'];
if (!email) {
  console.log('[owner-seed] BOOTSTRAP_OWNER_EMAIL unset — skipping (no-op)');
  process.exit(0);
}
const orgId = process.env['BOOTSTRAP_OWNER_ORG'] ?? process.env['WORKSPACE_ORG_ID'];
if (!orgId) {
  console.log('[owner-seed] neither BOOTSTRAP_OWNER_ORG nor WORKSPACE_ORG_ID set — skipping (no-op)');
  process.exit(0);
}

try {
  // No subject passed: the email invite binds to the provider subject on first VERIFIED login.
  await assignRole(orgId, email, 'OWNER');
  console.log(`[owner-seed] ensured OWNER "${email}" in org "${orgId}"`);
} finally {
  await disconnect();
}
