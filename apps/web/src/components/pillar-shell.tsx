import type { Role } from '@provable/contracts';
import type { ReactNode } from 'react';
import { Sidebar } from './sidebar';

// The authed pillar layout (Phase U3): left sidebar + content area. ADDITIVE — it wraps pillar
// page CONTENT only; the root AppShell header (Clerk OrganizationSwitcher/UserButton + the
// auth-gating <Show>) and the getAuthState gate are untouched.
//
// Phase 3: `role` is optional so gate states (signed-out / no-org / no-access — which have no
// resolved role) still render the shell. The sidebar then falls back to the least-privileged
// role (VIEWER) so the chrome persists; the API stays the authoritative boundary regardless.
export function PillarShell({ role, children }: { role?: Role; children: ReactNode }) {
  return (
    <div className="pillar-shell">
      <Sidebar role={role ?? 'VIEWER'} />
      <main className="pillar-content">{children}</main>
    </div>
  );
}
