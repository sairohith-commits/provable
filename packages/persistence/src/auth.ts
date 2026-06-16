import type { OrgId } from '@provable/contracts';
import { prisma } from './client.js';

/**
 * Resolve an org from a machine key's (prefix, hash). This is the ONE query that
 * runs without a tenant context — it must, since auth happens before we know the
 * org. It calls a SECURITY DEFINER function (owned by the superuser) that performs
 * exactly this lookup, so the app role still has no general un-scoped read path and
 * no BYPASSRLS. Returns null when no org matches.
 */
export async function resolveOrgByApiKey(prefix: string, hash: string): Promise<OrgId | null> {
  const rows = await prisma.$queryRaw<{ id: string | null }[]>`
    select auth_resolve_org(${prefix}, ${hash}) as id
  `;
  const id = rows[0]?.id ?? null;
  return id === null ? null : (id as OrgId);
}

/**
 * Resolve a Provable org from a linked Clerk Organization id. Like resolveOrgByApiKey,
 * this runs before any tenant context exists (the web maps the verified Clerk session →
 * Provable org), so it uses a SECURITY DEFINER function — no general un-scoped read path,
 * no BYPASSRLS. Returns null when no org is linked to that Clerk org.
 */
export async function resolveOrgByClerkOrgId(clerkOrgId: string): Promise<OrgId | null> {
  const rows = await prisma.$queryRaw<{ id: string | null }[]>`
    select auth_resolve_org_by_clerk(${clerkOrgId}) as id
  `;
  const id = rows[0]?.id ?? null;
  return id === null ? null : (id as OrgId);
}
