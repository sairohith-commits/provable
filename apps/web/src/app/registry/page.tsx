import { getAuthState } from '@/lib/auth';
import { loadOverview } from '@/lib/overview';
import { AuthGate } from '@/components/auth-gate';
import { PillarShell } from '@/components/pillar-shell';
import { RegistrySection } from '@/components/overview-client';

// Registry pillar (U3) — the Identity & Registry table, relocated to its own route.
export const dynamic = 'force-dynamic';

export default async function RegistryPage() {
  const state = await getAuthState();
  if (state.status !== 'authenticated') return <AuthGate state={state} />;
  const data = await loadOverview(state.context.orgId, state.context.userId);
  return (
    <PillarShell role={state.context.role}>
      <div className="overview">
        <RegistrySection agents={data.registry} />
      </div>
    </PillarShell>
  );
}
