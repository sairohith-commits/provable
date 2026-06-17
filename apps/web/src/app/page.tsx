import { loadOverview } from '@/lib/overview';
import { getAuthState } from '@/lib/auth';
import { OverviewClient } from '@/components/overview-client';

export const dynamic = 'force-dynamic';

// Provider-agnostic three-way gate (same states the Clerk UI showed before): signed-out →
// sign-in prompt; authenticated-but-no-org (Clerk multi-tenant) → not-linked prompt; otherwise
// the live overview.
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
  const initial = await loadOverview(state.context.orgId);
  return <OverviewClient initial={initial} />;
}
