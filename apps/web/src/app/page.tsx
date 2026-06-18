import { loadOverview } from '@/lib/overview';
import { getAuthState } from '@/lib/auth';
import { OverviewClient } from '@/components/overview-client';

export const dynamic = 'force-dynamic';

// Provider-agnostic gate (same states the Clerk UI showed before, plus Phase B no-access):
// signed-out → sign-in prompt; no-org (Clerk multi-tenant) → not-linked; no-access (assigned
// no role) → ask-an-owner; otherwise the live overview.
export default async function Page() {
  const state = await getAuthState();
  if (state.status === 'signed-out') {
    return <div className="empty card glass">Sign in to view your organization’s agents.</div>;
  }
  if (state.status === 'no-org') {
    return (
      <div className="empty card glass">
        No Provable org is linked to this Clerk organization yet.
      </div>
    );
  }
  if (state.status === 'no-access') {
    return (
      <div className="empty card glass">
        Your account isn’t assigned to this workspace yet. Ask an Owner to grant you access.
      </div>
    );
  }
  const initial = await loadOverview(state.context.orgId, state.context.userId);
  return <OverviewClient initial={initial} role={state.context.role} />;
}
