import type { Role } from '@provable/contracts';
import { getSummary, publicApiUrl } from '@/lib/api';
import { getAuthState } from '@/lib/auth';
import { AuthGate } from '@/components/auth-gate';
import { ConnectClient } from '@/components/connect-client';
import { PillarShell } from '@/components/pillar-shell';

export const dynamic = 'force-dynamic';

async function ConnectInner({ orgId, subject, role }: { orgId: string; subject: string; role: Role }) {
  const summary = await getSummary(orgId, subject);
  return (
    <ConnectClient
      apiUrl={publicApiUrl()}
      keyPrefix={summary.apiKeyPrefix}
      initialAgentCount={summary.agentsTotal}
      role={role}
    />
  );
}

export default async function ConnectPage() {
  const state = await getAuthState();
  if (state.status !== 'authenticated') return <AuthGate state={state} />;
  return (
    <PillarShell role={state.context.role}>
      <ConnectInner orgId={state.context.orgId} subject={state.context.userId} role={state.context.role} />
    </PillarShell>
  );
}
