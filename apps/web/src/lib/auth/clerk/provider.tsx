import 'server-only';

import {
  ClerkProvider,
  OrganizationSwitcher,
  Show,
  SignInButton,
  UserButton,
} from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import type { ReactNode } from 'react';
import { fetchRole, resolveOrg } from '../../api';
import { buildAuthContext } from '../context';
import type { AuthProvider, AuthState } from '../types';

/**
 * ClerkAuthProvider — the EXISTING Clerk logic, unchanged, behind the port. MULTI-TENANT:
 * orgId comes from the verified session's Clerk org (never client input), mapped to the
 * Provable org via the read API exactly as before. This stays the default provider.
 */
async function getAuthState(): Promise<AuthState> {
  const { userId, orgId: clerkOrgId, sessionClaims } = await auth();
  if (!userId) return { status: 'signed-out' };
  if (!clerkOrgId) return { status: 'no-org' };
  const orgId = await resolveOrg(clerkOrgId);
  if (orgId === null) return { status: 'no-org' };
  const email = (sessionClaims as { email?: string } | null)?.email ?? null;
  // Trust assumption: Clerk verifies emails at sign-up, so the session's primary email is
  // treated as verified for invite binding.
  const identity = { userId, email, displayName: null, emailVerified: true };
  const role = await fetchRole(orgId, userId, email, true);
  if (role === null) return { status: 'no-access' };
  return { status: 'authenticated', context: buildAuthContext('clerk', identity, orgId, role) };
}

export const ClerkAuthProvider: AuthProvider = {
  type: 'clerk',
  getAuthState,

  // Clerk's client-reactive chrome is preserved (Show/OrganizationSwitcher/UserButton). U5: the
  // top-nav links moved to the sidebar (sole navigation) — only the brand, org switcher, and user
  // menu remain in the header. The auth-gating logic (getAuthState/<Show>) is unchanged.
  async AppShell({ children }: { children: ReactNode }): Promise<ReactNode> {
    return (
      <ClerkProvider>
        <html lang="en">
          <body>
            <header className="chrome glass">
              <div className="brand">
                Provable <span className="brand-sub">governance</span>
              </div>
              <div className="chrome-right">
                <Show when="signed-in">
                  <OrganizationSwitcher hidePersonal />
                  <UserButton />
                </Show>
                <Show when="signed-out">
                  <SignInButton />
                </Show>
              </div>
            </header>
            <main>{children}</main>
          </body>
        </html>
      </ClerkProvider>
    );
  },
};
