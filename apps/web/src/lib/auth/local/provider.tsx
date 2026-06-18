import 'server-only';

import { cookies } from 'next/headers';
import { fetchRole } from '../../api';
import { workspaceOrgId } from '../config';
import { buildAuthContext } from '../context';
import { SESSION_COOKIE, readSession } from '../session';
import { makeSelfHostedShell } from '../self-hosted-shell';
import type { AuthProvider, AuthState } from '../types';

/**
 * LocalAuthProvider — a single bootstrapped admin (env-seeded bcrypt hash) with a signed session
 * cookie, for air-gapped / trial instances. SINGLE-ORG: orgId is WORKSPACE_ORG_ID. Credential
 * verification happens in /api/auth/login; here we only read the verified session cookie.
 */
async function getAuthState(): Promise<AuthState> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await readSession(token, 'local');
  if (session === null) return { status: 'signed-out' };
  const orgId = workspaceOrgId('local');
  const role = await fetchRole(orgId, session.sub, session.email, session.emailVerified);
  if (role === null) return { status: 'no-access' };
  return {
    status: 'authenticated',
    context: buildAuthContext(
      'local',
      {
        userId: session.sub,
        email: session.email,
        displayName: session.name,
        emailVerified: session.emailVerified,
      },
      orgId,
      role,
    ),
  };
}

export const LocalAuthProvider: AuthProvider = {
  type: 'local',
  getAuthState,
  AppShell: makeSelfHostedShell(getAuthState),
};
