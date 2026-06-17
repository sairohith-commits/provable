import { getSummary, publicApiUrl } from '@/lib/api';
import { getAuthState } from '@/lib/auth';
import { ConnectClient } from '@/components/connect-client';

export const dynamic = 'force-dynamic';

async function ConnectInner({ orgId }: { orgId: string }) {
  const summary = await getSummary(orgId);
  return (
    <ConnectClient
      apiUrl={publicApiUrl()}
      keyPrefix={summary.apiKeyPrefix}
      initialAgentCount={summary.agentsTotal}
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
  return <ConnectInner orgId={state.context.orgId} />;
}
