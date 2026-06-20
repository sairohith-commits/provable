import { loadOverview } from '@/lib/overview';
import { getAuthState } from '@/lib/auth';
import { AuthGate } from '@/components/auth-gate';
import { OverviewClient } from '@/components/overview-client';

export const dynamic = 'force-dynamic';

// Provider-agnostic gate (same states the Clerk UI showed before, plus Phase B no-access):
// signed-out → sign-in prompt; no-org (Clerk multi-tenant) → not-linked; no-access (assigned
// no role) → ask-an-owner; otherwise the live overview. Phase 3: gate states render through the
// shared AuthGate (shelled EmptyState) so the sidebar persists — same copy, now inside the shell.
export default async function Page() {
  const state = await getAuthState();
  if (state.status !== 'authenticated') return <AuthGate state={state} />;
  const initial = await loadOverview(state.context.orgId, state.context.userId);
  return <OverviewClient initial={initial} role={state.context.role} />;
}
