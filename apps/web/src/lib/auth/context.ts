// Pure AuthContext assembly — shared by all three providers, free of `server-only` and any
// Next/vendor runtime import so it is unit-testable in plain Node (this is what the
// provider-swap test exercises: same identity claims, correct AuthContext per provider type).
import type { AuthContext, AuthProviderType } from './types';

/** The provider-agnostic identity a provider extracts from its verified session/token. */
export interface Identity {
  readonly userId: string;
  readonly email: string | null;
  readonly displayName: string | null;
}

/**
 * Assemble the canonical context. `role` is pinned to null here — Phase A never derives or
 * enforces a role (that is Phase B). Group/role claims captured by OIDC are deliberately
 * dropped at this boundary.
 */
export function buildAuthContext(
  providerType: AuthProviderType,
  identity: Identity,
  orgId: string,
): AuthContext {
  return {
    userId: identity.userId,
    orgId,
    email: identity.email,
    displayName: identity.displayName,
    providerType,
    role: null,
  };
}
