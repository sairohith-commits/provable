import { getAuthState } from '@/lib/auth';
import { loadOverview } from '@/lib/overview';
import { AuthGate } from '@/components/auth-gate';
import { PillarShell } from '@/components/pillar-shell';
import { GuardrailsSection } from '@/components/overview-client';

// Safety pillar (U3) — Guardrails & Safety (SUSPENDED banner, guardrail trips, signal-loss).
export const dynamic = 'force-dynamic';

export default async function SafetyPage() {
  const state = await getAuthState();
  if (state.status !== 'authenticated') return <AuthGate state={state} />;
  const data = await loadOverview(state.context.orgId, state.context.userId);
  return (
    <PillarShell role={state.context.role}>
      <div className="overview">
        <GuardrailsSection safety={data.guardrails} />
      </div>
    </PillarShell>
  );
}
