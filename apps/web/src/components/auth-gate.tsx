import type { AuthState } from '@/lib/auth';
import { EmptyState, type EmptyIcon } from './empty-state';
import { PillarShell } from './pillar-shell';

// The exact gate the pillar pages render for a non-authenticated state. Phase 3: it now renders
// the shared EmptyState INSIDE PillarShell, so the sidebar+header shell persists in every gated
// state — no route drops to a bare, shell-less card. Returns null when authenticated (the page
// renders its content).
export function gateMessage(state: AuthState): string | null {
  switch (state.status) {
    case 'signed-out':
      return 'Sign in to view your organization’s agents.';
    case 'no-org':
      return 'No Provable org is linked to this Clerk organization yet.';
    case 'no-access':
      return 'Your account isn’t assigned to this workspace yet. Ask an Owner to grant you access.';
    case 'authenticated':
      return null;
  }
}

function gateIcon(state: AuthState): EmptyIcon {
  switch (state.status) {
    case 'no-org':
      return 'no-org';
    case 'no-access':
      return 'no-access';
    default:
      return 'signin';
  }
}

export function AuthGate({ state }: { state: AuthState }) {
  const msg = gateMessage(state);
  if (msg === null) return null;
  return (
    <PillarShell>
      <EmptyState variant="gated" icon={gateIcon(state)} title={msg} />
    </PillarShell>
  );
}
