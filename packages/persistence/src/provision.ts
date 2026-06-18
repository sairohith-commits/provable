import { PrismaClient } from '@prisma/client';
import type { OrgId, Role } from '@provable/contracts';
import { membershipRepo } from './membership.js';
import { apiKeyRepo, orgRepo } from './repositories.js';
import { withTenant } from './tenant.js';

/**
 * BYOC bootstrap step 1 — create the scoped NON-OWNER app role (idempotent), via the
 * OWNER/DIRECT_URL connection. Lives here (not a root script) so @prisma/client resolves under
 * pnpm. The role is a plain LOGIN role: NOT superuser, NO BYPASSRLS — so RLS fully applies (the
 * startup assertion enforces the runtime uses it). Password is validated upstream (DDL-safe charset).
 */
export async function bootstrapAppRole(opts: {
  directUrl: string;
  role: string;
  password: string;
  database: string;
}): Promise<void> {
  const owner = new PrismaClient({ datasources: { db: { url: opts.directUrl } } });
  try {
    await owner.$executeRawUnsafe(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${opts.role}') THEN
           CREATE ROLE "${opts.role}" WITH LOGIN PASSWORD '${opts.password}';
         END IF;
       END $$;`,
    );
    await owner.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${opts.database}" TO "${opts.role}";`);
    await owner.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${opts.role}";`);
  } finally {
    await owner.$disconnect();
  }
}

/**
 * Provision an org with a machine key (prefix + sha256 hash). Out-of-band admin
 * helper (no HTTP endpoint creates orgs in Phase 4). Runs inside withTenant so the
 * RLS WITH CHECK (id = current org) is satisfied.
 *
 * First-Owner bootstrap (Phase B): when `ownerEmail` is given the org creator is seeded as
 * OWNER, so a freshly-provisioned org is never role-less. `ownerSubject` optionally pre-binds
 * the provider subject; otherwise the invite binds on the owner's first verified login.
 */
export function provisionOrg(
  orgId: OrgId,
  apiKeyPrefix: string,
  apiKeyHash: string,
  name?: string,
  ownerEmail?: string,
  ownerSubject?: string,
): Promise<void> {
  return withTenant(orgId, async (tx) => {
    await orgRepo.ensure(tx, orgId, name);
    await apiKeyRepo.mint(tx, orgId, apiKeyPrefix, apiKeyHash, 'provisioned');
    if (ownerEmail !== undefined) {
      await membershipRepo.invite(tx, orgId, ownerEmail, 'OWNER', ownerSubject ?? 'bootstrap');
      if (ownerSubject !== undefined) {
        await membershipRepo.resolveOrBind(tx, orgId, ownerSubject, ownerEmail, true);
      }
    }
  });
}

/**
 * Link an existing Provable org to a Clerk Organization (the minimal demo link path).
 * Runs inside withTenant so RLS WITH CHECK (id = current org) is satisfied.
 */
export function linkClerkOrg(orgId: OrgId, clerkOrgId: string): Promise<void> {
  return withTenant(orgId, async (tx) => {
    await orgRepo.ensure(tx, orgId);
    await orgRepo.linkClerkOrg(tx, orgId, clerkOrgId);
  });
}

/**
 * Assign (or re-assign) a role to a person by email — the backfill / out-of-band admin path
 * (e.g. seeding the existing prod org's Owner BEFORE enforcement goes live). Optionally
 * pre-binds the provider subject; otherwise the invite binds on first verified login.
 */
export function assignRole(
  orgId: OrgId,
  email: string,
  role: Role,
  subject?: string,
): Promise<void> {
  return withTenant(orgId, async (tx) => {
    await orgRepo.ensure(tx, orgId);
    await membershipRepo.invite(tx, orgId, email, role, subject ?? 'admin-script');
    if (subject !== undefined) {
      await membershipRepo.resolveOrBind(tx, orgId, subject, email, true);
    }
  });
}
