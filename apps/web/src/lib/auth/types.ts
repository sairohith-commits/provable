// Canonical auth types — the provider seam (Phase A: AUTHENTICATION + ORG RESOLUTION ONLY).
//
// This file is web-local on purpose: apps/web is a PURE HTTP client (dependency-cruiser
// `web-only-contracts`), so the auth edge lives entirely inside apps/web and imports no
// internal package but @provable/contracts. Types only — NO runtime import (so the pure
// auth modules below stay importable from plain-Node vitest, which `server-only` would break).
import type { Role } from '@provable/contracts';
import type { ReactNode } from 'react';

export type AuthProviderType = 'clerk' | 'oidc' | 'local';

/**
 * The canonical context every provider resolves to. The API edge never sees this object —
 * it sees only the projection the web forwards over the internal-token channel (orgId +
 * subject + approver). `role` (Phase B) is a real Role and is non-null here: an authenticated
 * caller with NO assigned role surfaces as the `no-access` AuthState, never as a context.
 * The web's role is for UX only (hide/disable); the API re-derives it authoritatively.
 */
export interface AuthContext {
  readonly userId: string;
  readonly orgId: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly providerType: AuthProviderType;
  readonly role: Role;
}

/**
 * Edge state. `no-org` is the Clerk multi-tenant case (signed in, no Provable org linked);
 * `no-access` is authenticated + org resolved but NO role assigned (Phase B deny-by-default).
 * Single-org providers (oidc/local) never produce `no-org`.
 */
export type AuthState =
  | { readonly status: 'signed-out' }
  | { readonly status: 'no-org' }
  | { readonly status: 'no-access' }
  | { readonly status: 'authenticated'; readonly context: AuthContext };

/** What the selected provider supplies to the web edge. Middleware is dispatched separately
 *  (see middleware.ts) to keep node-only provider code out of the Edge runtime bundle. */
export interface AuthProvider {
  readonly type: AuthProviderType;
  /** Verify the incoming request server-side and resolve the edge state. */
  getAuthState(): Promise<AuthState>;
  /** Root layout shell + auth chrome (sign-in/out). Clerk's is byte-identical to the old layout. */
  AppShell(props: { children: ReactNode }): ReactNode | Promise<ReactNode>;
}
