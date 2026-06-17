import 'server-only';

import type { ReactNode } from 'react';
import type { AuthProvider } from './types';

/**
 * Shared root-layout shell for the self-hosted providers (oidc + local). Mirrors the Clerk
 * chrome (brand + nav) but swaps Clerk's client widgets for plain sign-in / sign-out links,
 * gated on the server-resolved auth state. Logout is a POST to /api/auth/logout.
 */
export function makeSelfHostedShell(getAuthState: AuthProvider['getAuthState']) {
  return async function AppShell({ children }: { children: ReactNode }): Promise<ReactNode> {
    const state = await getAuthState();
    const signedIn = state.status === 'authenticated';
    return (
      <html lang="en">
        <body>
          <header className="chrome glass">
            <div className="brand">
              Provable <span className="brand-sub">governance</span>
            </div>
            <div className="chrome-right">
              {signedIn ? (
                <>
                  <a className="nav-link" href="/">
                    Overview
                  </a>
                  <a className="nav-link" href="/connect">
                    Connect
                  </a>
                  <form action="/api/auth/logout" method="post" className="logout-form">
                    <button type="submit" className="nav-link">
                      Sign out
                    </button>
                  </form>
                </>
              ) : (
                <a className="nav-link" href="/login">
                  Sign in
                </a>
              )}
            </div>
          </header>
          <main>{children}</main>
        </body>
      </html>
    );
  };
}
