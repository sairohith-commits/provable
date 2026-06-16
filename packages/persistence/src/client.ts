import { PrismaClient } from '@prisma/client';

/**
 * The single application PrismaClient — connects as the RLS-subject role
 * `provable_app` (DATABASE_URL). It is INTERNAL: app code never queries it
 * directly, only through withTenant() so every statement is tenant-scoped.
 */
export const prisma = new PrismaClient();

/** Close the pool (for graceful shutdown / test teardown). Not a query path. */
export function disconnect(): Promise<void> {
  return prisma.$disconnect();
}
