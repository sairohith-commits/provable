// EDGE-SAFE session middleware for the self-hosted providers (oidc + local). Uses only jose
// (via session.ts) + Next primitives — NEVER openid-client/bcryptjs — so it stays in the Edge
// runtime bundle. Guards page navigations (redirect to /login when unauthenticated); leaves
// /api/* to self-gate (so client polling gets JSON 401/empty, not an HTML redirect). Performs
// the sliding-expiry refresh (re-issue the cookie when it nears expiry).
import { NextResponse, type NextRequest } from 'next/server';
import { sessionCookieOptions } from './cookie-options';
import { SESSION_COOKIE, createSession, readSession, shouldRefresh } from './session';
import type { AuthProviderType } from './types';

function isExempt(pathname: string): boolean {
  // The auth handshake + login page + ALL app API routes bypass the page guard.
  return pathname === '/login' || pathname.startsWith('/api/');
}

export function makeSessionMiddleware(provider: AuthProviderType) {
  return async function middleware(req: NextRequest): Promise<NextResponse> {
    const { pathname } = req.nextUrl;
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    const session = await readSession(token, provider);

    if (isExempt(pathname)) return NextResponse.next();

    if (session === null) {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('from', pathname);
      return NextResponse.redirect(url);
    }

    // Sliding refresh: keep an active human signed in past the original expiry.
    if (token !== undefined && shouldRefresh(token)) {
      const res = NextResponse.next();
      res.cookies.set(SESSION_COOKIE, await createSession(session), sessionCookieOptions());
      return res;
    }
    return NextResponse.next();
  };
}
