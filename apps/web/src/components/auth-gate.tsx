import type { AuthState } from '@/lib/auth';

// The exact gate the pillar pages render for a non-authenticated state — mirrors page.tsx's
// inline gate verbatim so EVERY route hits the same gate (page.tsx itself is left untouched per
// the U3 hard constraint). Returns null when authenticated (the page renders its content).
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

export function AuthGate({ state }: { state: AuthState }) {
  const msg = gateMessage(state);
  return msg === null ? null : <div className="empty card glass">{msg}</div>;
}
