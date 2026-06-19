// Single-org HARD RESET (Phase O1) — wipe ALL agent/governance data for ONE org while keeping
// the org, its memberships (owners), and its machine keys, so re-onboarding works immediately.
//
// GUARDED + DRY-RUN BY DEFAULT:
//   • requires an explicit <ORG_ID> arg AND the --confirm flag to delete anything.
//   • without --confirm it is a DRY RUN: prints the per-table counts it WOULD delete, exits 0.
//   • refuses to run against an org id it cannot find.
//   • idempotent — safe to re-run.
//
// Uses the OWNER/DIRECT_URL connection (the app role has no DELETE grant). Tenant safety is
// enforced inside resetOrgData: every delete is org-scoped and a transactional tripwire rolls
// back if any delete removes more than the target org's pre-counted rows. verdict_event is
// append-only/DB-immutable, so it is RETAINED (inert once decisions are gone) — reported, not deleted.
//
// Usage:
//   node scripts/reset-org.mjs <ORG_ID>            # dry run (default)
//   node scripts/reset-org.mjs <ORG_ID> --confirm  # actually delete
//
// Relative dist import (like bootstrap.mjs / owner-seed.mjs): @prisma/client + contracts resolve
// from persistence's own node_modules. A bare '@provable/persistence' would not resolve from /scripts.
import { inspectOrg, resetOrgData } from '../packages/persistence/dist/index.js';

const args = process.argv.slice(2);
const confirm = args.includes('--confirm');
const orgId = args.find((a) => !a.startsWith('--'));

if (!orgId) {
  console.error('usage: node scripts/reset-org.mjs <ORG_ID> [--confirm]');
  process.exit(2);
}

const directUrl = process.env['DIRECT_URL'];
if (!directUrl) {
  console.error('[reset-org] DIRECT_URL is required (owner connection — the app role cannot delete).');
  process.exit(2);
}

function printCounts(label, c) {
  console.log(`[reset-org] ${label}:`);
  console.log(`             agents       ${c.agents}`);
  console.log(`             tasks        ${c.tasks}`);
  console.log(`             decisions    ${c.decisions}`);
  console.log(`             transitions  ${c.transitions}`);
  console.log(`             scores       ${c.scores}`);
}

const preview = await inspectOrg(directUrl, orgId);
console.log(`[reset-org] org: ${orgId}`);

if (!preview.exists) {
  console.error(`[reset-org] org "${orgId}" not found — refusing to run.`);
  process.exit(2);
}

if (!confirm) {
  console.log('[reset-org] mode: DRY RUN (no --confirm) — nothing will be deleted');
  printCounts('would delete (agent/governance data)', preview.deletable);
  console.log(`[reset-org] retained (append-only/immutable): verdict_events ${preview.retained.verdictEvents}`);
  console.log(
    `[reset-org] kept (re-onboard works immediately): memberships ${preview.kept.memberships}, api_keys ${preview.kept.apiKeys}`,
  );
  console.log('[reset-org] re-run with --confirm to delete.');
  process.exit(0);
}

console.log('[reset-org] mode: CONFIRMED — deleting');
const result = await resetOrgData(directUrl, orgId);
printCounts('deleted', result.deletable);
console.log(
  `[reset-org] retained verdict_events: ${result.retained.verdictEvents} (append-only) · kept memberships ${result.kept.memberships}, api_keys ${result.kept.apiKeys}`,
);
console.log('[reset-org] done. org/memberships/keys intact — ready to re-onboard.');
process.exit(0);
