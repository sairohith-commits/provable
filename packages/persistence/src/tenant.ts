import type { Prisma } from '@prisma/client';
import type { OrgId } from '@provable/contracts';
import { prisma } from './client.js';

/** The transaction-scoped client repositories operate on inside withTenant(). */
export type TenantClient = Prisma.TransactionClient;

/**
 * withTenant — the ONLY entry point for app reads/writes.
 *
 * Opens a Prisma interactive transaction and, as its FIRST statement, sets the
 * transaction-local GUC `app.current_org_id`. RLS policies scope every subsequent
 * statement to that org. `is_local = true` means the setting dies with the
 * transaction, so this is safe under connection pooling — no leakage between
 * requests sharing a pooled connection.
 *
 * There is deliberately NO un-scoped query path exported from this package.
 */
export function withTenant<T>(orgId: OrgId, fn: (tx: TenantClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`select set_config('app.current_org_id', ${orgId}, true)`;
    return fn(tx);
  });
}
