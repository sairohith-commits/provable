// Signed session cookie for the self-hosted providers (oidc + local). HS256 via jose
// (Edge-runtime compatible — used by middleware too). Pure module: no `server-only`, no
// next/headers, so the lifecycle (issue / verify / expiry / sliding refresh) is unit-testable.
import { SignJWT, jwtVerify } from 'jose';
import type { AuthProviderType } from './types';
import { assertSessionSecret } from './config';

export const SESSION_COOKIE = 'provable_session';

const ALG = 'HS256';
/** 8h absolute session lifetime; re-issued (slid) while the user stays active. */
export const SESSION_TTL_SECONDS = 60 * 60 * 8;
/** Re-issue when fewer than this many seconds remain (sliding refresh window). */
export const SESSION_REFRESH_THRESHOLD_SECONDS = 60 * 60;

/** The verified identity carried by a session. `oidcRefreshToken` enables IdP token refresh.
 *  `emailVerified` gates invite binding (Phase B): only a provider-verified email may claim
 *  a pending invite. Local + Clerk are verified by construction; OIDC carries email_verified. */
export interface SessionPayload {
  readonly sub: string;
  readonly email: string | null;
  readonly name: string | null;
  readonly provider: AuthProviderType;
  readonly emailVerified: boolean;
  readonly oidcRefreshToken?: string;
}

function key(provider: AuthProviderType): Uint8Array {
  return new TextEncoder().encode(assertSessionSecret(provider));
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Issue a fresh signed session cookie value. */
export async function createSession(
  payload: SessionPayload,
  ttlSeconds: number = SESSION_TTL_SECONDS,
): Promise<string> {
  const iat = nowSeconds();
  const jwt = new SignJWT({
    email: payload.email,
    name: payload.name,
    provider: payload.provider,
    ev: payload.emailVerified,
    ...(payload.oidcRefreshToken !== undefined ? { rt: payload.oidcRefreshToken } : {}),
  })
    .setProtectedHeader({ alg: ALG })
    .setSubject(payload.sub)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ttlSeconds);
  return jwt.sign(key(payload.provider));
}

/**
 * Verify a session cookie. Returns null when absent, tampered, or EXPIRED (jose enforces
 * `exp`) — i.e. expiry collapses straight to signed-out. The provider is needed to pick the
 * signing key; a cookie minted under one provider will not verify under another.
 */
export async function readSession(
  token: string | undefined,
  provider: AuthProviderType,
): Promise<SessionPayload | null> {
  if (token === undefined || token.length === 0) return null;
  try {
    const { payload } = await jwtVerify(token, key(provider), { algorithms: [ALG] });
    if (typeof payload.sub !== 'string') return null;
    if (payload['provider'] !== provider) return null;
    return {
      sub: payload.sub,
      email: typeof payload['email'] === 'string' ? payload['email'] : null,
      name: typeof payload['name'] === 'string' ? payload['name'] : null,
      provider,
      emailVerified: payload['ev'] === true,
      ...(typeof payload['rt'] === 'string' ? { oidcRefreshToken: payload['rt'] } : {}),
    };
  } catch {
    return null;
  }
}

/** True when the session is within the sliding-refresh window and should be re-issued. */
export function shouldRefresh(token: string, now: number = nowSeconds()): boolean {
  const exp = decodeExp(token);
  if (exp === null) return false;
  return exp - now <= SESSION_REFRESH_THRESHOLD_SECONDS;
}

/** Read `exp` without verifying (verification already happened in readSession). Edge-safe:
 *  decodes base64url via atob (no Node Buffer, so it works in the Edge middleware runtime). */
function decodeExp(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const raw = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const b64 = raw.padEnd(raw.length + ((4 - (raw.length % 4)) % 4), '=');
    const json = JSON.parse(atob(b64)) as { exp?: number };
    return typeof json.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
}
