import type { Role } from '@provable/contracts';
import type { ReactNode } from 'react';
import { Sidebar } from './sidebar';

// The authed pillar layout (Phase U3): left sidebar + content area. ADDITIVE — it wraps pillar
// page CONTENT only; the root AppShell header (Clerk OrganizationSwitcher/UserButton + the
// auth-gating <Show>) and the getAuthState gate are untouched.
export function PillarShell({ role, children }: { role: Role; children: ReactNode }) {
  return (
    <div className="pillar-shell">
      <Sidebar role={role} />
      <main className="pillar-content">{children}</main>
    </div>
  );
}
