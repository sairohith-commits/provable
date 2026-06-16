// Minimal demo link path: map a Provable org to a signed-in Clerk Organization.
// Run by Rohith after signing in (Clerk org id from the session/OrganizationSwitcher):
//   DATABASE_URL=... DIRECT_URL=... node scripts/link-clerk-org.mjs org_support org_2abc...
import { disconnect, linkClerkOrg } from '../packages/persistence/dist/index.js';

const [orgId, clerkOrgId] = process.argv.slice(2);
if (!orgId || !clerkOrgId) {
  console.error('usage: node scripts/link-clerk-org.mjs <provableOrgId> <clerkOrgId>');
  process.exit(2);
}
await linkClerkOrg(orgId, clerkOrgId);
await disconnect();
console.log(`linked Provable org "${orgId}" → Clerk org "${clerkOrgId}"`);
