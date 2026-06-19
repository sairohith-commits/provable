import { can } from '@provable/contracts';
import { publicApiUrl } from '@/lib/api';
import { getAuthState } from '@/lib/auth';
import { AuthGate } from '@/components/auth-gate';
import { ConnectorsClient } from '@/components/connectors-client';
import { PillarShell } from '@/components/pillar-shell';

// Connectors editor (Phase O3b). Authed page only — reuses the untouched getAuthState gate +
// PillarShell sidebar. manage_agents (Owner) gates the editor; the API is authoritative regardless.
export const dynamic = 'force-dynamic';

export default async function ConnectorsPage() {
  const state = await getAuthState();
  if (state.status !== 'authenticated') return <AuthGate state={state} />;
  const role = state.context.role;
  return (
    <PillarShell role={role}>
      {can(role, 'manage_agents') ? (
        <ConnectorsClient apiUrl={publicApiUrl()} />
      ) : (
        <div className="empty card glass">Only an Owner can manage connectors.</div>
      )}
    </PillarShell>
  );
}
