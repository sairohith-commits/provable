// Pure AuthContext assembly — shared by all three providers, free of `server-only` and any
// Next/vendor runtime import so it is unit-testable in plain Node (this is what the
// provider-swap test exercises: same identity claims, correct AuthContext per provider type).
import type { Role } from '@provable/contracts';
import type { AuthContext, AuthProviderType } from './types';

/** The provider-agnostic identity a provider extracts from its verified session/token. */
export interface Identity {
  readonly userId: string;
  readonly email: string | null;
  readonly displayName: string | null;
  /** Provider-verified email? Required before a pending invite may bind (Phase B). */
  readonly emailVerified: boolean;
}

/**
 * Assemble the canonical context. `role` is the API-resolved role for this (org, subject) —
 * the caller is known to be assigned (an unassigned caller surfaces as `no-access`, not here).
 * OIDC group/role claims remain unmapped (IdP-group mapping is deferred past Phase B).
 */
export function buildAuthContext(
  providerType: AuthProviderType,
  identity: Identity,
  orgId: string,
  role: Role,
): AuthContext {
  return {
    userId: identity.userId,
    orgId,
    email: identity.email,
    displayName: identity.displayName,
    providerType,
    role,
  };
}
