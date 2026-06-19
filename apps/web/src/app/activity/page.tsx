import { getAuthState } from '@/lib/auth';
import { loadOverview } from '@/lib/overview';
import { AuthGate } from '@/components/auth-gate';
import { PillarShell } from '@/components/pillar-shell';
import { VisibilitySection } from '@/components/overview-client';

// Activity pillar (U3) — the Visibility & Intelligence section, relocated to its own route.
export const dynamic = 'force-dynamic';

export default async function ActivityPage() {
  const state = await getAuthState();
  if (state.status !== 'authenticated') return <AuthGate state={state} />;
  const data = await loadOverview(state.context.orgId, state.context.userId);
  return (
    <PillarShell role={state.context.role}>
      <div className="overview">
        <VisibilitySection rows={data.visibility} />
      </div>
    </PillarShell>
  );
}
