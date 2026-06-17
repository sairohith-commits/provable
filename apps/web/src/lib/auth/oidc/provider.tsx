import 'server-only';

import { cookies } from 'next/headers';
import { workspaceOrgId } from '../config';
import { buildAuthContext } from '../context';
import { SESSION_COOKIE, readSession } from '../session';
import { makeSelfHostedShell } from '../self-hosted-shell';
import type { AuthProvider, AuthState } from '../types';

/**
 * OidcAuthProvider — standard Authorization Code + PKCE against a configured issuer. SINGLE-ORG:
 * orgId is the instance's WORKSPACE_ORG_ID (config), never per-session. The login/refresh/logout
 * handshake lives in apps/web/src/app/api/auth/* (Node runtime); here we only read the verified
 * session cookie. Group/role claims are captured at the token boundary but NOT mapped (Phase B).
 */
async function getAuthState(): Promise<AuthState> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await readSession(token, 'oidc');
  if (session === null) return { status: 'signed-out' };
  return {
    status: 'authenticated',
    context: buildAuthContext(
      'oidc',
      { userId: session.sub, email: session.email, displayName: session.name },
      workspaceOrgId('oidc'),
    ),
  };
}

export const OidcAuthProvider: AuthProvider = {
  type: 'oidc',
  getAuthState,
  AppShell: makeSelfHostedShell(getAuthState),
};
