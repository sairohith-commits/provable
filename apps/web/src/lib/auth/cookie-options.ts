// Cookie attribute presets shared by middleware (Edge) + route handlers (Node). Edge-safe:
// no imports beyond process.env. httpOnly everywhere — no auth cookie is readable by JS.
export interface CookieOptions {
  readonly httpOnly: true;
  readonly secure: boolean;
  readonly sameSite: 'lax';
  readonly path: '/';
  readonly maxAge?: number;
}

function isProd(): boolean {
  return process.env['NODE_ENV'] === 'production';
}

/** The long-lived (8h) session cookie. */
export function sessionCookieOptions(maxAgeSeconds?: number): CookieOptions {
  return {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    path: '/',
    ...(maxAgeSeconds !== undefined ? { maxAge: maxAgeSeconds } : {}),
  };
}

/** Short-lived (10 min) cookies holding the OIDC PKCE verifier / state / nonce mid-handshake. */
export function transientCookieOptions(): CookieOptions {
  return { httpOnly: true, secure: isProd(), sameSite: 'lax', path: '/', maxAge: 600 };
}
