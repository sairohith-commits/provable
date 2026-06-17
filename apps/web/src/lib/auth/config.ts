// Provider selection + startup validation. EDGE-SAFE: reads only process.env and imports no
// jose/openid-client/clerk code, so middleware.ts and instrumentation.ts can call it in the
// Edge runtime. A missing/misconfigured active provider fails LOUDLY here — no silent fallback.
import type { AuthProviderType } from './types';

const PROVIDERS: readonly AuthProviderType[] = ['clerk', 'oidc', 'local'];

/** The active provider. Defaults to `clerk` so the existing deploy is unchanged. */
export function activeProviderType(): AuthProviderType {
  const raw = process.env['AUTH_PROVIDER'] ?? 'clerk';
  if (!PROVIDERS.includes(raw as AuthProviderType)) {
    throw new Error(
      `[auth] AUTH_PROVIDER="${raw}" is invalid — must be exactly one of ${PROVIDERS.join(' | ')}.`,
    );
  }
  return raw as AuthProviderType;
}

function requireEnv(name: string, type: AuthProviderType): string {
  const v = process.env[name];
  if (v === undefined || v.length === 0) {
    throw new Error(`[auth] AUTH_PROVIDER=${type} requires ${name} to be set (it is missing/empty).`);
  }
  return v;
}

/** Session-signing secret guard, shared by oidc + local. Rejects missing/short secrets. */
const MIN_SESSION_SECRET_LEN = 32;
export function assertSessionSecret(type: AuthProviderType): string {
  const secret = requireEnv('AUTH_SESSION_SECRET', type);
  if (secret.length < MIN_SESSION_SECRET_LEN) {
    throw new Error(
      `[auth] AUTH_SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LEN} characters (got ${secret.length}).`,
    );
  }
  return secret;
}

/** The single configured workspace org for self-hosted single-org providers (oidc/local). */
export function workspaceOrgId(type: AuthProviderType): string {
  return requireEnv('WORKSPACE_ORG_ID', type);
}

/**
 * Validate the ACTIVE provider's required configuration. Called at boot (instrumentation) and
 * memoized by selectAuthProvider(). Throws on the first missing key — fail fast, fail clear.
 * Returns the validated active provider type.
 */
export function assertActiveConfig(): AuthProviderType {
  const type = activeProviderType();
  switch (type) {
    case 'clerk':
      requireEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', type);
      requireEnv('CLERK_SECRET_KEY', type);
      break;
    case 'oidc':
      requireEnv('OIDC_ISSUER', type);
      requireEnv('OIDC_CLIENT_ID', type);
      requireEnv('OIDC_CLIENT_SECRET', type);
      requireEnv('OIDC_REDIRECT_URI', type);
      workspaceOrgId(type);
      assertSessionSecret(type);
      break;
    case 'local':
      requireEnv('LOCAL_ADMIN_EMAIL', type);
      requireEnv('LOCAL_ADMIN_PASSWORD_HASH', type);
      workspaceOrgId(type);
      assertSessionSecret(type);
      break;
  }
  return type;
}
