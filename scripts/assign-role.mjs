// RBAC role assignment / backfill (Phase B). Out-of-band admin helper.
//
// CRITICAL (run BEFORE RBAC enforcement reaches any deployed env): backfill the existing prod
// org's Owner, or the live dashboard locks itself out (deny-by-default = unassigned has no
// access). Example for the existing org:
//   DATABASE_URL=... DIRECT_URL=... \
//     node scripts/assign-role.mjs org_support rohith@example.com OWNER [clerk-user-id]
//
// Email is the invite identifier; it binds to the provider subject on first VERIFIED login.
// Passing the optional <subject> pre-binds it (e.g. a known Clerk userId) so access is
// immediate without waiting for a login round-trip.
import { assignRole, disconnect } from '../packages/persistence/dist/index.js';

const [orgId, email, role, subject] = process.argv.slice(2);
const VALID = ['OWNER', 'APPROVER', 'OPERATOR', 'VIEWER'];

if (!orgId || !email || !role || !VALID.includes(role)) {
  console.error('usage: node scripts/assign-role.mjs <orgId> <email> <OWNER|APPROVER|OPERATOR|VIEWER> [subject]');
  process.exit(2);
}

await assignRole(orgId, email, role, subject);
await disconnect();
console.log(`assigned ${role} to "${email}" in org "${orgId}"${subject ? ` (pre-bound subject ${subject})` : ''}`);
