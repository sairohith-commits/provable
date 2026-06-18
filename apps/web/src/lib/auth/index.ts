import 'server-only';

import { cache } from 'react';
import { ClerkAuthProvider } from './clerk/provider';
import { assertActiveConfig } from './config';
import { LocalAuthProvider } from './local/provider';
import { OidcAuthProvider } from './oidc/provider';
import type { AuthContext, AuthProvider, AuthState } from './types';

export type { AuthContext, AuthProvider, AuthProviderType, AuthState } from './types';

/**
 * The single active provider for this instance. Selection is env-driven (AUTH_PROVIDER) and
 * validated on first call (assertActiveConfig throws loudly on missing/bad config). The result
 * is memoized so validation runs once. Core/API code never imports this — only the web edge.
 */
let selected: AuthProvider | undefined;
export function selectAuthProvider(): AuthProvider {
  if (selected !== undefined) return selected;
  const type = assertActiveConfig();
  switch (type) {
    case 'clerk':
      selected = ClerkAuthProvider;
      break;
    case 'oidc':
      selected = OidcAuthProvider;
      break;
    case 'local':
      selected = LocalAuthProvider;
      break;
  }
  return selected;
}

/** Resolve the edge auth state for the current request. Memoized per request (React cache) so
 *  the layout shell and the page don't each pay the /me + org-resolve round-trip. */
export const getAuthState: () => Promise<AuthState> = cache(() => selectAuthProvider().getAuthState());

/** The canonical context, or null when not authenticated (signed-out OR no-org). */
export async function getAuthContext(): Promise<AuthContext | null> {
  const state = await getAuthState();
  return state.status === 'authenticated' ? state.context : null;
}
