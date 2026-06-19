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

export interface GatewayKeyResolution {
  readonly orgId: OrgId;
  readonly agentKey: string;
  readonly taskKey: string;
}

/**
 * Resolve a per-agent GATEWAY key's (prefix, hash) → org + agentKey + taskKey (Phase O2). Like
 * resolveOrgByApiKey it runs before any tenant context (the proxy identifies the agent from the
 * URL key), so it uses a SECURITY DEFINER function scoped to ACTIVE GATEWAY keys only. Returns
 * null for an unknown / revoked / non-gateway key.
 */
export async function resolveGatewayByApiKey(
  prefix: string,
  hash: string,
): Promise<GatewayKeyResolution | null> {
  const rows = await prisma.$queryRaw<
    { org_id: string | null; agent_key: string | null; task_key: string | null }[]
  >`select org_id, agent_key, task_key from auth_resolve_gateway(${prefix}, ${hash})`;
  const r = rows[0];
  if (r === undefined || r.org_id === null) return null;
  return {
    orgId: r.org_id as OrgId,
    agentKey: r.agent_key ?? '',
    taskKey: r.task_key ?? '',
  };
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
