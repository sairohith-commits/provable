import { can } from '@provable/contracts';
import { publicApiUrl } from '@/lib/api';
import { connectorRecipe, gatewayRecipe, quickstart } from '@/lib/connect';
import { getAuthContext } from '@/lib/auth';
import { tier } from '@/lib/onboarding-tiers';

// Phase C2 — three-tier onboarding. The first-touch surface: present every tier with its HONEST
// fidelity + a concrete recipe, so no one wires gateway-only and wonders why there's no score.
// Role-gated for UX (manage_agents/manage_keys); the underlying actions are API-authoritative.
export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const ctx = await getAuthContext();
  if (ctx === null) return <div className="empty card glass">Sign in to onboard agents.</div>;
  if (!can(ctx.role, 'manage_agents') && !can(ctx.role, 'manage_keys')) {
    return <div className="empty card glass">You don’t have access to onboarding.</div>;
  }

  const apiUrl = publicApiUrl();
  const gateway = gatewayRecipe(apiUrl, '<YOUR_PROVABLE_KEY>');
  const connector = connectorRecipe(apiUrl, '<YOUR_PROVABLE_KEY>');
  const sdk = quickstart(apiUrl, '<YOUR_API_KEY>');

  return (
    <div className="onboarding">
      <h1>Connect an agent</h1>
      <p className="onboarding-lede">
        Three ways in. Each unlocks a different <strong>fidelity</strong> — pick the one that
        matches how much you can instrument. Mint a key on the{' '}
        <a className="nav-link" href="/connect">
          Connect
        </a>{' '}
        page and paste it into a recipe below.
      </p>

      {/* Tier 1 — Gateway: zero code, Observe-only. FULLY ACTIONABLE. */}
      <section className="tier card glass" data-tier="gateway" data-fidelity="observe-only" data-actionable={String(tier('gateway').actionable)}>
        <header className="tier-head">
          <h2>{tier('gateway').title}</h2>
          <span className="fidelity-badge" data-fidelity-label>
            {tier('gateway').fidelity}
          </span>
        </header>
        <p>
          Zero code: repoint your LLM base URL and add a header. You get cost and activity
          immediately. <strong>Readiness stays N/A</strong> until you add verdicts — Observe-only
          is honest, never a fabricated score.
        </p>
        <pre className="recipe" data-recipe="gateway">
          {gateway}
        </pre>
      </section>

      {/* Tier 2 — Adapter: ACTIONABLE in C3 via the reference connector. */}
      <section className="tier card glass" data-tier="adapter" data-fidelity="governed" data-actionable={String(tier('adapter').actionable)}>
        <header className="tier-head">
          <h2>{tier('adapter').title}</h2>
          <span className="fidelity-badge" data-fidelity-label>
            {tier('adapter').fidelity}
          </span>
        </header>
        <p>
          If your existing system already records outcomes with verdicts (a review queue, a
          ticketing tool), the connector maps them to Provable with <strong>no changes to your
          agent</strong> — full governance, including readiness. Deliver the events you already
          emit; a declarative mapping does the rest.
        </p>
        <pre className="recipe" data-recipe="connector">
          {connector}
        </pre>
      </section>

      {/* Tier 3 — SDK: minimal code, highest fidelity. FULLY ACTIONABLE. */}
      <section className="tier card glass" data-tier="sdk" data-fidelity="governed" data-actionable={String(tier('sdk').actionable)}>
        <header className="tier-head">
          <h2>{tier('sdk').title}</h2>
          <span className="fidelity-badge" data-fidelity-label>
            {tier('sdk').fidelity}
          </span>
        </header>
        <p>
          A few lines: register the agent and track each decision with its verdict and outcome.
          Full readiness scoring. Direct REST is the same profile minus the dependency.
        </p>
        <pre className="recipe" data-recipe="sdk">
          {sdk}
        </pre>
      </section>
    </div>
  );
}
