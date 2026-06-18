import { PrismaClient } from '@prisma/client';

/**
 * Two raw clients FOR TESTS ONLY (app code uses withTenant):
 *  - appClient   connects as provable_app (DATABASE_URL) — RLS applies. Used to
 *    prove that a query with NO tenant context returns nothing.
 *  - adminClient connects as the superuser (DIRECT_URL) — bypasses RLS. Used for
 *    cross-tenant assertions (data really exists) and table truncation.
 */
export const appClient = new PrismaClient();
export const adminClient = new PrismaClient({
  datasources: { db: { url: process.env['DIRECT_URL'] ?? '' } },
});

const TABLES = ['api_key', 'membership', 'score', 'transition', 'verdict_event', 'decision', 'task', 'agent', 'org'];

/** Wipe all data (superuser bypasses RLS; TRUNCATE does not fire row triggers). */
export async function resetDb(): Promise<void> {
  await adminClient.$executeRawUnsafe(
    `TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

export async function disconnectClients(): Promise<void> {
  await appClient.$disconnect();
  await adminClient.$disconnect();
}
