import { Show } from '@clerk/nextjs';
import { loadOverview } from '@/lib/overview';
import { activeProvableOrg } from '@/lib/org';
import { OverviewClient } from '@/components/overview-client';

export const dynamic = 'force-dynamic';

async function Overview({ orgId }: { orgId: string }) {
  const initial = await loadOverview(orgId);
  return <OverviewClient initial={initial} />;
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
