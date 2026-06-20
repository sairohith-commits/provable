import type { Role } from '@provable/contracts';
import { getSummary, publicApiUrl } from '@/lib/api';
import { getAuthState } from '@/lib/auth';
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
  if (state.status === 'signed-out') {
    return <div className="empty card glass">Sign in to connect an agent.</div>;
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
  return (
    <PillarShell role={state.context.role}>
      <ConnectInner orgId={state.context.orgId} subject={state.context.userId} role={state.context.role} />
    </PillarShell>
  );
}
