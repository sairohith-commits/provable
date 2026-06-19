import { ANTHROPIC_GW_PREFIX, GATEWAY_BASE_PATH, GATEWAY_HEADERS } from '@provable/contracts';
import { describe, expect, it } from 'vitest';
import { anthropicGatewayRecipe, connectorRecipe, gatewayRecipe, quickstart } from '../src/lib/connect';
import { TIERS, tier } from '../src/lib/onboarding-tiers';

describe('three-tier onboarding presentation', () => {
  it('presents exactly the three tiers, in order, with honest fidelity', () => {
    expect(TIERS.map((t) => t.id)).toEqual(['gateway', 'adapter', 'sdk']);
    expect(tier('gateway').fidelity.toLowerCase()).toContain('observe-only');
    expect(tier('sdk').fidelity.toLowerCase()).toContain('fidelity');
  });

  it('all three tiers are actionable with a concrete recipe (Tier 2 flipped in C3)', () => {
    for (const id of ['gateway', 'adapter', 'sdk'] as const) {
      expect(tier(id).actionable).toBe(true);
      expect(tier(id).mode).toBe('recipe');
    }
  });
});

describe('connector recipe (Tier 2, Phase C3)', () => {
  const recipe = connectorRecipe('https://api.example.test', 'pvb_abc_secret');

  it('targets the connector path with machine-key auth', () => {
    expect(recipe).toContain('https://api.example.test/connector/events');
    expect(recipe).toContain('Authorization: Bearer pvb_abc_secret');
  });

  it('documents the required stable id (externalRef) and honest fidelity split', () => {
    expect(recipe).toContain('externalRef');
    expect(recipe.toLowerCase()).toContain('stable');
    expect(recipe).toContain('Observe-only');
    expect(recipe).toContain('N/A');
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

describe('Anthropic gateway recipe ↔ proxy path lockstep (Phase O2)', () => {
  const recipe = anthropicGatewayRecipe('https://api.example.test', 'pvb_gw_secret');

  it('points base_url at the per-agent gateway path (key IN the URL, not a header)', () => {
    expect(recipe).toContain(`https://api.example.test${ANTHROPIC_GW_PREFIX}/pvb_gw_secret/v1/messages`);
    expect(recipe).toContain('https://api.example.test/gw/pvb_gw_secret');
  });

  it('keeps the caller using their OWN Anthropic key (x-api-key, never stored)', () => {
    expect(recipe).toContain('x-api-key: $ANTHROPIC_API_KEY');
    expect(recipe.toLowerCase()).toContain('never stores it');
  });

  it('is honest about Observe-only / N/A and not-promotable', () => {
    expect(recipe.toLowerCase()).toContain('observe-only');
    expect(recipe).toContain('N/A');
    expect(recipe.toLowerCase()).toContain('never promotable');
  });
});

describe('SDK quickstart (Tier 3) stays gateway-free', () => {
  it('shows the real SDK path with no gateway leakage', () => {
    const qs = quickstart('http://localhost:3010', '<KEY>');
    expect(qs).toContain('client.track(');
    expect(qs.toLowerCase()).not.toContain('gateway');
  });
});
