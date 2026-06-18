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
import { adminNavLinks } from '../admin-nav';
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

  // Clerk's client-reactive chrome is preserved (Show/OrganizationSwitcher/UserButton). Phase C1
  // adds role-gated admin links: the role is resolved server-side (so absent for roles without
  // the permission) and rendered inside the signed-in area.
  async AppShell({ children }: { children: ReactNode }): Promise<ReactNode> {
    const state = await getAuthState();
    const adminLinks = state.status === 'authenticated' ? adminNavLinks(state.context.role) : [];
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
                  <a className="nav-link" href="/">
                    Overview
                  </a>
                  <a className="nav-link" href="/connect">
                    Connect
                  </a>
                  {adminLinks.map((l) => (
                    <a key={l.href} className="nav-link" href={l.href}>
                      {l.label}
                    </a>
                  ))}
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
