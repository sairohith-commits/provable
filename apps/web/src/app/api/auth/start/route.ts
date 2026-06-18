import { NextResponse } from 'next/server';
import { activeProviderType } from '@/lib/auth/config';
import { transientCookieOptions } from '@/lib/auth/cookie-options';
import { beginLogin } from '@/lib/auth/oidc/discovery';

// OIDC login initiation (Node runtime: openid-client). Generate PKCE/state/nonce, stash them
// in short-lived httpOnly cookies, and redirect to the issuer's authorization endpoint.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  if (activeProviderType() !== 'oidc') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const { authorizationUrl, state, nonce, codeVerifier } = await beginLogin();
  const res = NextResponse.redirect(authorizationUrl);
  const opts = transientCookieOptions();
  res.cookies.set('oidc_state', state, opts);
  res.cookies.set('oidc_nonce', nonce, opts);
  res.cookies.set('oidc_verifier', codeVerifier, opts);
  return res;
}
