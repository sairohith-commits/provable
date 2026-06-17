import { Show } from '@clerk/nextjs';
import { getSummary, publicApiUrl } from '@/lib/api';
import { activeProvableOrg } from '@/lib/org';
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
  const orgId = await activeProvableOrg();
  return (
    <>
      <Show when="signed-out">
        <div className="empty card glass">Sign in to connect an agent.</div>
      </Show>
      <Show when="signed-in">
        {orgId === null ? (
          <div className="empty card glass">No Provable org is linked to this Clerk organization yet.</div>
        ) : (
          <ConnectInner orgId={orgId} />
        )}
      </Show>
    </>
  );
}
