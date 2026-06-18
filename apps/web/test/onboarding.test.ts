import { GATEWAY_BASE_PATH, GATEWAY_HEADERS } from '@provable/contracts';
import { describe, expect, it } from 'vitest';
import { gatewayRecipe, quickstart } from '../src/lib/connect';
import { TIERS, tier } from '../src/lib/onboarding-tiers';

describe('three-tier onboarding presentation', () => {
  it('presents exactly the three tiers, in order, with honest fidelity', () => {
    expect(TIERS.map((t) => t.id)).toEqual(['gateway', 'adapter', 'sdk']);
    expect(tier('gateway').fidelity.toLowerCase()).toContain('observe-only');
    expect(tier('sdk').fidelity.toLowerCase()).toContain('fidelity');
  });

  it('gateway + sdk are actionable (recipe); adapter is presented-only, never faked', () => {
    expect(tier('gateway').actionable).toBe(true);
    expect(tier('gateway').mode).toBe('recipe');
    expect(tier('sdk').actionable).toBe(true);
    expect(tier('sdk').mode).toBe('recipe');
    expect(tier('adapter').actionable).toBe(false); // forward-pointered, not wired
    expect(tier('adapter').mode).toBe('pointer');
  });
});

describe('gateway recipe ↔ proxy header lockstep', () => {
  const recipe = gatewayRecipe('https://api.example.test', 'pvb_abc_secret', 'my-agent', 'classify');

  it('renders EVERY gateway header name the proxy reads (no drift)', () => {
    for (const header of Object.values(GATEWAY_HEADERS)) {
      expect(recipe).toContain(header);
    }
  });

  it('points at the gateway base path and carries key/agent/task + BYO upstream key', () => {
    expect(recipe).toContain(`https://api.example.test${GATEWAY_BASE_PATH}/chat/completions`);
    expect(recipe).toContain('pvb_abc_secret');
    expect(recipe).toContain('my-agent');
    expect(recipe).toContain('classify');
    expect(recipe).toContain('Authorization: Bearer $OPENAI_API_KEY'); // caller's OWN key
  });

  it('is honest about Observe-only / N/A (no promise of a score)', () => {
    expect(recipe.toLowerCase()).toContain('observe-only');
    expect(recipe).toContain('N/A');
  });
});

describe('SDK quickstart (Tier 3) stays gateway-free', () => {
  it('shows the real SDK path with no gateway leakage', () => {
    const qs = quickstart('http://localhost:3010', '<KEY>');
    expect(qs).toContain('client.track(');
    expect(qs.toLowerCase()).not.toContain('gateway');
  });
});
