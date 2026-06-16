import { Show } from '@clerk/nextjs';
import { getAgents, getTransitions } from '@/lib/api';
import { activeProvableOrg } from '@/lib/org';
import { OverviewClient } from '@/components/overview-client';

export const dynamic = 'force-dynamic';

async function Overview({ orgId }: { orgId: string }) {
  const [agents, transitions] = await Promise.all([getAgents(orgId), getTransitions(orgId)]);
  return <OverviewClient initial={{ agents, transitions }} />;
}

export default async function Page() {
  const orgId = await activeProvableOrg();
  return (
    <>
      <Show when="signed-out">
        <div className="empty card glass">Sign in to view your organization’s agents.</div>
      </Show>
      <Show when="signed-in">
        {orgId === null ? (
          <div className="empty card glass">
            No Provable org is linked to this Clerk organization yet.
          </div>
        ) : (
          <Overview orgId={orgId} />
        )}
      </Show>
    </>
  );
}
