import { NextResponse } from 'next/server';
import { activeProviderType } from '@/lib/auth/config';
import { sessionCookieOptions, transientCookieOptions } from '@/lib/auth/cookie-options';
import { completeLogin } from '@/lib/auth/oidc/discovery';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, createSession } from '@/lib/auth/session';

// OIDC redirect handler (Node runtime). openid-client validates state + nonce + PKCE + the ID
// token signature; we then mint our own signed session cookie and clear the transient ones.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TRANSIENT = ['oidc_state', 'oidc_nonce', 'oidc_verifier'] as const;

function clearTransient(res: NextResponse): void {
  for (const name of TRANSIENT) res.cookies.set(name, '', { ...transientCookieOptions(), maxAge: 0 });
}

export async function GET(req: Request): Promise<NextResponse> {
  if (activeProviderType() !== 'oidc') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const reqUrl = new URL(req.url);
  const cookieHeader = req.headers.get('cookie') ?? '';
  const jar = parseCookies(cookieHeader);
  const state = jar['oidc_state'];
  const nonce = jar['oidc_nonce'];
  const codeVerifier = jar['oidc_verifier'];
  if (state === undefined || nonce === undefined || codeVerifier === undefined) {
    const res = NextResponse.redirect(new URL('/login?error=session', reqUrl), 303);
    clearTransient(res);
    return res;
  }
  try {
    const { identity, refreshToken } = await completeLogin(reqUrl, { state, nonce, codeVerifier });
    const token = await createSession({
      sub: identity.userId,
      email: identity.email,
      name: identity.displayName,
      provider: 'oidc',
      ...(refreshToken !== undefined ? { oidcRefreshToken: refreshToken } : {}),
    });
    const res = NextResponse.redirect(new URL('/', reqUrl), 303);
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_TTL_SECONDS));
    clearTransient(res);
    return res;
  } catch {
    const res = NextResponse.redirect(new URL('/login?error=oidc', reqUrl), 303);
    clearTransient(res);
    return res;
  }
}

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}
