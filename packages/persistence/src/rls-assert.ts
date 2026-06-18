import type { PrismaClient } from '@prisma/client';
import { prisma } from './client.js';

/**
 * Startup RLS guard (BYOC hardening). The runtime DB connection MUST be the non-owner,
 * RLS-scoped role — under ENABLE (not FORCE) RLS, a superuser, a BYPASSRLS role, OR the table
 * OWNER all bypass row-level security, which would silently break two-tenant isolation. This
 * verifies the live connection cannot bypass RLS; the API refuses to boot otherwise.
 *
 * Note: pg_roles + pg_tables are world-readable, so the scoped app role can run this itself.
 */
export interface RlsConnectionStatus {
  readonly role: string;
  readonly superuser: boolean;
  readonly bypassRls: boolean;
  readonly ownsTables: boolean;
  /** true iff the connection is genuinely RLS-scoped (none of the bypass conditions hold). */
  readonly scoped: boolean;
}

type RawRunner = Pick<PrismaClient, '$queryRawUnsafe'>;

export async function checkRlsScopedConnection(client: RawRunner = prisma): Promise<RlsConnectionStatus> {
  const rows = await client.$queryRawUnsafe<
    { rolsuper: boolean; rolbypassrls: boolean; org_owner: string | null; me: string }[]
  >(
    `SELECT r.rolsuper, r.rolbypassrls,
            (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'org') AS org_owner,
            current_user AS me
       FROM pg_roles r
      WHERE r.rolname = current_user`,
  );
  const row = rows[0];
  const role = row?.me ?? 'unknown';
  const superuser = row?.rolsuper ?? true; // fail-closed if we can't tell
  const bypassRls = row?.rolbypassrls ?? true;
  const ownsTables = row?.org_owner !== null && row?.org_owner === role;
  return { role, superuser, bypassRls, ownsTables, scoped: !superuser && !bypassRls && !ownsTables };
}

export class RlsScopeError extends Error {
  constructor(public readonly status: RlsConnectionStatus) {
    super(
      `runtime DB connection "${status.role}" can BYPASS row-level security ` +
        `(superuser=${status.superuser}, bypassRls=${status.bypassRls}, ownsTables=${status.ownsTables}). ` +
        'DATABASE_URL must be the non-owner, RLS-scoped app role — refusing to start.',
    );
    this.name = 'RlsScopeError';
  }
}

/** Throws RlsScopeError unless the connection is RLS-scoped. Call at API boot, before serving. */
export async function assertRlsScopedConnection(client?: RawRunner): Promise<void> {
  const status = await checkRlsScopedConnection(client);
  if (!status.scoped) throw new RlsScopeError(status);
}
