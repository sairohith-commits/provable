import { getAuthState } from '@/lib/auth';
import { loadOverview } from '@/lib/overview';
import { AuthGate } from '@/components/auth-gate';
import { PillarShell } from '@/components/pillar-shell';
import { CostSection } from '@/components/overview-client';

// Cost & ROI pillar (U3) — cost metrics + the shadow-counterfactual projection card.
export const dynamic = 'force-dynamic';

export default async function CostPage() {
  const state = await getAuthState();
  if (state.status !== 'authenticated') return <AuthGate state={state} />;
  const data = await loadOverview(state.context.orgId, state.context.userId);
  return (
    <PillarShell role={state.context.role}>
      <div className="overview">
        <CostSection cost={data.cost} />
      </div>
    </PillarShell>
  );
}
