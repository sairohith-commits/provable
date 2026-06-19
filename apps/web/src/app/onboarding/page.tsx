import { can } from '@provable/contracts';
import { publicApiUrl } from '@/lib/api';
import { getAuthState } from '@/lib/auth';
import { AuthGate } from '@/components/auth-gate';
import { OnboardingWizardClient } from '@/components/onboarding-wizard-client';
import { PillarShell } from '@/components/pillar-shell';

// Phase W1 — the in-dashboard "Add an agent" wizard. Same edge pattern as /connectors:
// getAuthState → AuthGate → PillarShell. Role-gated for UX (manage_agents/manage_keys); the mint
// routes it calls are API-authoritative. The wizard never fabricates an agent — it watches the
// real fleet read-model and flips to "Live" only when the agent actually reports.
export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const state = await getAuthState();
  if (state.status !== 'authenticated') return <AuthGate state={state} />;
  const role = state.context.role;
  return (
    <PillarShell role={role}>
      {can(role, 'manage_agents') || can(role, 'manage_keys') ? (
        <OnboardingWizardClient apiUrl={publicApiUrl()} />
      ) : (
        <div className="empty card glass">You don’t have access to onboarding.</div>
      )}
    </PillarShell>
  );
}
