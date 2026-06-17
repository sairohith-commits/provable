// Canonical auth types — the provider seam (Phase A: AUTHENTICATION + ORG RESOLUTION ONLY).
//
// This file is web-local on purpose: apps/web is a PURE HTTP client (dependency-cruiser
// `web-only-contracts`), so the auth edge lives entirely inside apps/web and imports no
// internal package but @provable/contracts. Types only — NO runtime import (so the pure
// auth modules below stay importable from plain-Node vitest, which `server-only` would break).
import type { ReactNode } from 'react';

export type AuthProviderType = 'clerk' | 'oidc' | 'local';

/**
 * The canonical context every provider resolves to. The API edge never sees this object —
 * it sees only the projection the web forwards over the internal-token channel (orgId +
 * approver). `role` is shaped for Phase B RBAC but is ALWAYS null/unenforced in Phase A.
 */
export interface AuthContext {
  readonly userId: string;
  readonly orgId: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly providerType: AuthProviderType;
  readonly role: null;
}

/**
 * Three-way edge state. `no-org` is the Clerk multi-tenant case (signed in, no Provable org
 * linked yet); single-org providers (oidc/local) never produce it. Pages branch on this to
 * render the SAME three states the Clerk UI rendered before (no behavioral change for Clerk).
 */
export type AuthState =
  | { readonly status: 'signed-out' }
  | { readonly status: 'no-org' }
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
