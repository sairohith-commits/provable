import 'server-only';

import { auth } from '@clerk/nextjs/server';
import { resolveOrg } from './api';

/**
 * Resolve the active Provable org from the VERIFIED Clerk session, server-side.
 * The Clerk org id comes from the session (never client input); we map it to the
 * Provable org via the read API. Returns null when signed out or no org is linked.
 */
export async function activeProvableOrg(): Promise<string | null> {
  const { orgId: clerkOrgId } = await auth();
  if (!clerkOrgId) return null;
  return resolveOrg(clerkOrgId);
}

/** The authenticated human who will be recorded as the approver. */
export async function currentApprover(): Promise<string | null> {
  const { userId, sessionClaims } = await auth();
  if (!userId) return null;
  const email = (sessionClaims as { email?: string } | null)?.email;
  return email ?? userId;
}
