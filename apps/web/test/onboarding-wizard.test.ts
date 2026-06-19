import { ANTHROPIC_GW_PREFIX } from '@provable/contracts';
import type { FleetOverview } from '@provable/contracts';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TASK_KEY,
  STEP_ORDER,
  TIER_CHOICES,
  canAdvance,
  connectorHref,
  effectiveTaskKey,
  fleetHasAgent,
  gatewayBaseUrl,
  gatewaySnippet,
  identifyValid,
  normalizeIdentify,
  sdkSnippet,
  tierChoice,
} from '../src/lib/onboarding-wizard';

const API = 'https://api.example.test';
const id = (over: Partial<{ agentKey: string; displayName: string; taskKey: string }> = {}) => ({
  agentKey: '',
  displayName: '',
  taskKey: '',
  ...over,
});

describe('Step 1 — Identify validity + normalization', () => {
  it('requires a non-empty agentKey to advance', () => {
    expect(identifyValid(id())).toBe(false);
    expect(identifyValid(id({ agentKey: '   ' }))).toBe(false);
    expect(identifyValid(id({ agentKey: 'support-bot' }))).toBe(true);
  });

  it('trims all fields', () => {
    expect(normalizeIdentify(id({ agentKey: '  a ', displayName: ' n ', taskKey: ' t ' }))).toEqual({
      agentKey: 'a',
      displayName: 'n',
      taskKey: 't',
    });
  });

  it('defaults a blank gateway taskKey to a sensible value, keeps an entered one', () => {
    expect(effectiveTaskKey(id({ agentKey: 'a' }))).toBe(DEFAULT_TASK_KEY);
    expect(effectiveTaskKey(id({ agentKey: 'a', taskKey: '  ' }))).toBe(DEFAULT_TASK_KEY);
    expect(effectiveTaskKey(id({ agentKey: 'a', taskKey: 'classify' }))).toBe('classify');
  });
});

describe('Step gating — canAdvance', () => {
  it('gates Step 1 on agentKey and Step 2 on a tier choice', () => {
    expect(canAdvance('identify', id(), null)).toBe(false);
    expect(canAdvance('identify', id({ agentKey: 'a' }), null)).toBe(true);
    expect(canAdvance('tier', id({ agentKey: 'a' }), null)).toBe(false);
    expect(canAdvance('tier', id({ agentKey: 'a' }), 'gateway')).toBe(true);
  });

  it('lets setup → signal proceed and treats signal as terminal', () => {
    expect(canAdvance('setup', id({ agentKey: 'a' }), 'sdk')).toBe(true);
    expect(canAdvance('signal', id({ agentKey: 'a' }), 'sdk')).toBe(false);
  });

  it('orders the four steps', () => {
    expect(STEP_ORDER).toEqual(['identify', 'tier', 'setup', 'signal']);
  });
});

describe('Tier choices — honest trade-offs', () => {
  it('offers exactly gateway/connector/sdk with honest readiness language', () => {
    expect(TIER_CHOICES.map((t) => t.id)).toEqual(['gateway', 'connector', 'sdk']);
    expect(tierChoice('gateway').readiness.toLowerCase()).toContain('observe-only');
    expect(tierChoice('gateway').readiness.toLowerCase()).toContain('no readiness');
    expect(tierChoice('connector').readiness.toLowerCase()).toContain('verdict');
    expect(tierChoice('sdk').readiness.toLowerCase()).toContain('fidelity');
  });
});

describe('Gateway base_url — EXACTLY <api>/gw/<key>/ with trailing slash', () => {
  it('renders the per-agent gateway path with a trailing slash', () => {
    expect(gatewayBaseUrl(API, 'pvb_gw_secret')).toBe(`${API}/gw/pvb_gw_secret/`);
    expect(gatewayBaseUrl(API, 'pvb_gw_secret')).toMatch(/\/gw\/pvb_gw_secret\/$/);
  });

  it('binds to ANTHROPIC_GW_PREFIX so the displayed URL cannot drift from the proxy', () => {
    expect(gatewayBaseUrl(API, 'k')).toBe(`${API}${ANTHROPIC_GW_PREFIX}/k/`);
  });

  it('the snippet sets the SDK base_url to that exact URL and keeps the BYO key', () => {
    const snip = gatewaySnippet(API, 'pvb_gw_secret');
    expect(snip).toContain(`base_url="${API}/gw/pvb_gw_secret/"`);
    expect(snip).toContain('api_key="$ANTHROPIC_API_KEY"');
    expect(snip.toLowerCase()).toContain('never stores it');
    expect(snip).toContain('N/A');
  });
});

describe('SDK snippet — real provable_sdk surface, references the agentKey', () => {
  const snip = sdkSnippet(API, 'support-bot', 'classify', 'pvb_abc_secret');

  it('uses the real SDK surface (no fabricated package)', () => {
    expect(snip).toContain('pip install provable_sdk');
    expect(snip).toContain('from provable_sdk import Client');
    expect(snip).toContain('client.register(');
    expect(snip).toContain('client.track(');
  });

  it('references the entered agentKey + the minted key', () => {
    expect(snip).toContain('"support-bot"');
    expect(snip).toContain('agent_key="support-bot"');
    expect(snip).toContain('api_key="pvb_abc_secret"');
  });
});

describe('Connector handoff — carries the agentKey, no editor duplication here', () => {
  it('links into the real /connectors editor with the agentKey as context', () => {
    expect(connectorHref('support-bot')).toBe('/connectors?agent=support-bot');
    expect(connectorHref('a b')).toBe('/connectors?agent=a%20b');
    expect(connectorHref('  ')).toBe('/connectors');
  });
});

describe('First-signal — reads ONLY the real fleet, never fabricates', () => {
  const fleet = (keys: string[]): Pick<FleetOverview, 'tasks'> => ({
    tasks: keys.map((agentKey) => ({
      agentKey,
      taskKey: 't',
      score: null,
      impliedBand: null,
      effectiveMode: 'SHADOW',
      status: 'OBSERVING',
      headroomTo: null,
      actionAvailable: false,
      reasonNote: '',
    })) as FleetOverview['tasks'],
  });

  it('is false until the exact agentKey appears in the fleet read-model', () => {
    expect(fleetHasAgent(fleet([]), 'support-bot')).toBe(false);
    expect(fleetHasAgent(fleet(['other']), 'support-bot')).toBe(false);
    expect(fleetHasAgent(fleet(['other', 'support-bot']), 'support-bot')).toBe(true);
  });

  it('never matches an empty/blank agentKey (no phantom flip)', () => {
    expect(fleetHasAgent(fleet(['']), '')).toBe(false);
    expect(fleetHasAgent(fleet(['x']), '   ')).toBe(false);
  });
});
