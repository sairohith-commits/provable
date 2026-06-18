import 'server-only';

import { getAuthState } from './auth';

/**
 * Resolve the active Provable org for the current request, provider-agnostically. The orgId
 * comes from the selected AuthProvider's verified context (Clerk session → mapped Provable org;
 * oidc/local → the instance's single workspace org). Returns null when signed out or no org.
 *
 * The downstream HTTP contract to the read API is UNCHANGED — callers still forward this orgId
 * over the internal-token channel exactly as before.
 */
export async function activeProvableOrg(): Promise<string | null> {
  const state = await getAuthState();
  return state.status === 'authenticated' ? state.context.orgId : null;
}

/** The authenticated human who will be recorded as the approver (email, falling back to id). */
export async function currentApprover(): Promise<string | null> {
  const state = await getAuthState();
  if (state.status !== 'authenticated') return null;
  return state.context.email ?? state.context.userId;
}
