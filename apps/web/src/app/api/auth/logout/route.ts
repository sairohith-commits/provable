import { NextResponse } from 'next/server';
import { activeProviderType } from '@/lib/auth/config';
import { sessionCookieOptions } from '@/lib/auth/cookie-options';
import { SESSION_COOKIE } from '@/lib/auth/session';

// Logout for the self-hosted providers (Node runtime). Always clear the local session cookie;
// for OIDC additionally redirect to the issuer's RP-initiated end-session endpoint when it has
// one. (Clerk uses its own client UserButton sign-out, not this route.)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function cleared(res: NextResponse): NextResponse {
  res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
  return res;
}

export async function POST(req: Request): Promise<NextResponse> {
  const loginUrl = new URL('/login', req.url);
  if (activeProviderType() === 'oidc') {
    const { endSessionUrl } = await import('@/lib/auth/oidc/discovery');
    const idpUrl = await endSessionUrl(loginUrl.href);
    if (idpUrl !== null) return cleared(NextResponse.redirect(idpUrl, 303));
  }
  return cleared(NextResponse.redirect(loginUrl, 303));
}
