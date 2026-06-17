// OIDC Authorization Code + PKCE against a configured issuer, via openid-client v6. CSRF
// protection (state + nonce + PKCE) uses openid-client's BUILT-IN handling — we generate the
// values, stash them in short-lived httpOnly cookies (see the route handlers), and hand them
// back as `expectedState`/`expectedNonce`/`pkceCodeVerifier`; we never re-implement the checks.
//
// Pure module (no `server-only`/next): the full flow is exercised against an in-process mock
// issuer in the integration test.
import {
  ClientSecretPost,
  type Configuration,
  allowInsecureRequests,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  buildEndSessionUrl,
  calculatePKCECodeChallenge,
  discovery,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  refreshTokenGrant,
} from 'openid-client';
import type { Identity } from '../context';

const SCOPE = 'openid profile email';

function insecureAllowed(): boolean {
  // Opt-in escape hatch for http issuers (mock issuer in tests, http dev IdP). Off by default.
  return process.env['OIDC_ALLOW_INSECURE'] === 'true';
}

/** Discover + build the client Configuration. Memoized per process (discovery is a network hop). */
let cached: Promise<Configuration> | undefined;
export function oidcConfig(): Promise<Configuration> {
  if (cached === undefined) cached = discover();
  return cached;
}
/** Test seam: reset the memoized config (so a test can point at a fresh mock issuer). */
export function resetOidcConfig(): void {
  cached = undefined;
}

async function discover(): Promise<Configuration> {
  const issuer = process.env['OIDC_ISSUER'];
  const clientId = process.env['OIDC_CLIENT_ID'];
  const clientSecret = process.env['OIDC_CLIENT_SECRET'];
  if (!issuer || !clientId || !clientSecret) {
    throw new Error('[auth] OIDC requires OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET.');
  }
  return discovery(
    new URL(issuer),
    clientId,
    undefined,
    ClientSecretPost(clientSecret),
    insecureAllowed() ? { execute: [allowInsecureRequests] } : undefined,
  );
}

/** The per-login CSRF/PKCE material to persist (httpOnly, short-lived) before redirecting. */
export interface LoginChallenge {
  readonly authorizationUrl: string;
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
}

/** Start a login: generate PKCE/state/nonce and the authorization URL to redirect the user to. */
export async function beginLogin(): Promise<LoginChallenge> {
  const config = await oidcConfig();
  const redirectUri = requireRedirectUri();
  const codeVerifier = randomPKCECodeVerifier();
  const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
  const state = randomState();
  const nonce = randomNonce();
  const url = buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: SCOPE,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  });
  return { authorizationUrl: url.href, state, nonce, codeVerifier };
}

/**
 * Complete a login from the IdP redirect. openid-client validates state, nonce, PKCE, the ID
 * token signature (against the issuer JWKS) and issuer/audience — we just supply the expected
 * values. Returns the verified Identity plus the refresh token (if the IdP issued one).
 *
 * Group/role claims are intentionally NOT mapped here (Phase B).
 */
export async function completeLogin(
  currentUrl: URL,
  expected: { state: string; nonce: string; codeVerifier: string },
): Promise<{ identity: Identity; refreshToken: string | undefined }> {
  const config = await oidcConfig();
  const tokens = await authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: expected.codeVerifier,
    expectedState: expected.state,
    expectedNonce: expected.nonce,
  });
  const claims = tokens.claims();
  if (claims === undefined) throw new Error('[auth] OIDC response carried no ID token claims.');
  return { identity: identityFromClaims(claims), refreshToken: tokens.refresh_token };
}

/** Exchange a refresh token for a fresh ID token (IdP-side session refresh). */
export async function refresh(
  refreshToken: string,
): Promise<{ identity: Identity; refreshToken: string | undefined }> {
  const config = await oidcConfig();
  const tokens = await refreshTokenGrant(config, refreshToken);
  const claims = tokens.claims();
  if (claims === undefined) throw new Error('[auth] OIDC refresh carried no ID token claims.');
  return { identity: identityFromClaims(claims), refreshToken: tokens.refresh_token ?? refreshToken };
}

/** Build the IdP end-session (RP-initiated logout) URL, if the issuer advertises one. */
export async function endSessionUrl(postLogoutRedirectUri: string): Promise<string | null> {
  const config = await oidcConfig();
  try {
    const url = buildEndSessionUrl(config, { post_logout_redirect_uri: postLogoutRedirectUri });
    return url.href;
  } catch {
    // Issuer has no end_session_endpoint — local cookie clearing is the logout (still complete).
    return null;
  }
}

function identityFromClaims(claims: Record<string, unknown>): Identity {
  const sub = claims['sub'];
  if (typeof sub !== 'string') throw new Error('[auth] OIDC ID token has no `sub`.');
  const email = typeof claims['email'] === 'string' ? claims['email'] : null;
  const name =
    typeof claims['name'] === 'string'
      ? claims['name']
      : typeof claims['preferred_username'] === 'string'
        ? (claims['preferred_username'] as string)
        : null;
  return { userId: sub, email, displayName: name };
}

function requireRedirectUri(): string {
  const uri = process.env['OIDC_REDIRECT_URI'];
  if (!uri) throw new Error('[auth] OIDC_REDIRECT_URI is not set.');
  return uri;
}
