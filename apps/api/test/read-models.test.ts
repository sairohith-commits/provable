import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  at,
  climbToPending,
  internalHeaders,
  makeApp,
  provision,
  register,
  resetDb,
  teardown,
  track,
} from './helpers.js';

const TOKEN = 'test-internal-token-rm-0123456789';
let app: FastifyInstance;

beforeAll(() => {
  process.env['PROVABLE_INTERNAL_TOKEN'] = TOKEN;
  app = makeApp();
});
afterAll(() => teardown(app));
beforeEach(resetDb);

function get(key: string, url: string) {
  return app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${key}` } });
}

/** Track an ACCEPTED+SUCCESS decision with confidence (+ optional cost). */
function tracked(
  key: string,
  agentKey: string,
  taskKey: string,
  i: number,
  cost?: { usd: number; tokens: number },
) {
  return track(app, key, {
    type: 'decision',
    agentKey,
    taskKey,
    at: at(i),
    action: { i },
    verdict: { kind: 'ACCEPTED' },
    outcome: 'SUCCESS',
    confidence: 0.9,
    source: 'sdk',
    externalRef: `${agentKey}:${taskKey}:${i}`,
    ...(cost !== undefined ? { cost } : {}),
  });
}

describe('Identity & Registry read-model', () => {
  it('derives ACTIVE from real activity; reports first/last-seen, sources, counts', async () => {
    const key = await provision('org_reg');
    await register(app, key, { agentKey: 'reg-agent', taskKey: 'classify' });
    for (let i = 0; i < 3; i += 1) await tracked(key, 'reg-agent', 'classify', i);

    const body = get(key, '/registry');
    const json = (await body).json<{
      agents: {
        agentKey: string;
        identityState: string;
        firstSeen: string | null;
        lastSeen: string | null;
        sources: string[];
        taskCount: number;
        decisionCount: number;
      }[];
      policy: { activityWindowDays: number };
    }>();
    const a = json.agents.find((x) => x.agentKey === 'reg-agent');
    expect(a).toBeDefined();
    expect(a?.identityState).toBe('ACTIVE'); // derived from real recent activity
    expect(a?.decisionCount).toBe(3);
    expect(a?.taskCount).toBe(1);
    expect(a?.sources).toContain('sdk');
    expect(a?.firstSeen).not.toBeNull();
    expect(json.policy.activityWindowDays).toBeGreaterThan(0); // window policy disclosed
  });
});

describe('Visibility & Intelligence read-model', () => {
  it('reports REAL verdict mix, window volume, components, and an honest drift disclosure', async () => {
    const key = await provision('org_vis');
    await register(app, key, { agentKey: 'vis-agent', taskKey: 'classify' });
    // 4 ACCEPTED+SUCCESS, 1 OVERRIDDEN — counted off persisted decisions.
    for (let i = 0; i < 4; i += 1) await tracked(key, 'vis-agent', 'classify', i);
    await track(app, key, {
      type: 'decision',
      agentKey: 'vis-agent',
      taskKey: 'classify',
      at: at(4),
      action: { i: 4 },
      verdict: { kind: 'OVERRIDDEN', magnitude: 0.5 },
      confidence: 0.6,
      source: 'sdk',
      externalRef: 'vis-agent:classify:4',
    });

    const json = (await get(key, '/visibility')).json<{
      driftTracked: boolean;
      tasks: {
        agentKey: string;
        verdictMix: { ACCEPTED: number; OVERRIDDEN: number };
        windowVolume: number;
        components: { overrideRate: number | null } | null;
        scoreTrend: unknown[];
      }[];
    }>();
    expect(json.driftTracked).toBe(false); // honest: dedicated drift not computed
    const t = json.tasks.find((x) => x.agentKey === 'vis-agent');
    expect(t?.verdictMix.ACCEPTED).toBe(4);
    expect(t?.verdictMix.OVERRIDDEN).toBe(1);
    expect(t?.windowVolume).toBe(5);
    expect(t?.scoreTrend.length).toBeGreaterThan(0);
    expect(t?.components?.overrideRate).not.toBeNull();
  });
});

describe('Cost & ROI read-model — ROI INTEGRITY', () => {
  it('reports REAL cost and a counterfactual that is fully recomputable from on-screen assumptions', async () => {
    const key = await provision('org_cost');
    await register(app, key, { agentKey: 'cost-agent', taskKey: 'classify' });
    // 12 decisions with real cost → task lands SHADOW (>=10 resolved+scored), so its volume
    // is the shadow-counterfactual base.
    for (let i = 0; i < 12; i += 1) await tracked(key, 'cost-agent', 'classify', i, { usd: 0.01, tokens: 100 });

    const json = (await get(key, '/cost')).json<{
      org: { usd: number; tokens: number; hasCostSignal: boolean; decisionCount: number };
      roi: {
        isProjection: boolean;
        assumptions: { assumedHumanMinutesPerDecision: number; assumedHumanHourlyUsd: number };
        humanCostPerDecisionUsd: number;
        agentCostPerDecisionUsd: number;
        costDeltaPerDecisionUsd: number;
        shadowDecisionVolume: number;
        projectedSavingsIfPromotedUsd: number;
      };
    }>();

    // REAL cost is the actual sum, not an estimate.
    expect(json.org.hasCostSignal).toBe(true);
    expect(json.org.usd).toBeCloseTo(0.12, 6);
    expect(json.org.tokens).toBe(1200);

    const r = json.roi;
    // INTEGRITY: a savings figure is present ONLY alongside its assumption inputs.
    expect(r.isProjection).toBe(true);
    expect(r.assumptions.assumedHumanMinutesPerDecision).toBeGreaterThan(0);
    expect(r.assumptions.assumedHumanHourlyUsd).toBeGreaterThan(0);
    // Every derived number must reproduce from the assumptions (no fabricated savings).
    const expectedHuman = (r.assumptions.assumedHumanMinutesPerDecision / 60) * r.assumptions.assumedHumanHourlyUsd;
    expect(r.humanCostPerDecisionUsd).toBeCloseTo(expectedHuman, 6);
    expect(r.agentCostPerDecisionUsd).toBeCloseTo(0.12 / 12, 6);
    expect(r.costDeltaPerDecisionUsd).toBeCloseTo(expectedHuman - 0.12 / 12, 6);
    expect(r.shadowDecisionVolume).toBe(12);
    expect(r.projectedSavingsIfPromotedUsd).toBeCloseTo(
      r.shadowDecisionVolume * r.costDeltaPerDecisionUsd,
      6,
    );
  });

  it('shows an HONEST empty cost state when no adapter reported cost', async () => {
    const key = await provision('org_nocost');
    await register(app, key, { agentKey: 'free-agent', taskKey: 'classify' });
    for (let i = 0; i < 3; i += 1) await tracked(key, 'free-agent', 'classify', i); // no cost
    const json = (await get(key, '/cost')).json<{ org: { hasCostSignal: boolean; usd: number } }>();
    expect(json.org.hasCostSignal).toBe(false); // not estimated, honestly empty
    expect(json.org.usd).toBe(0);
  });
});

describe('Guardrails & Safety read-model', () => {
  it('is empty (honest) until something trips', async () => {
    const key = await provision('org_safe0');
    await register(app, key, { agentKey: 'calm', taskKey: 'classify' });
    for (let i = 0; i < 3; i += 1) await tracked(key, 'calm', 'classify', i);
    const json = (await get(key, '/guardrails')).json<{ events: unknown[]; suspended: unknown[] }>();
    expect(json.events).toHaveLength(0);
    expect(json.suspended).toHaveLength(0);
  });

  it('surfaces a GUARDRAIL trip (→ SUSPENDED) and a SIGNAL_LOSS demotion, distinctly', async () => {
    const key = await provision('org_safe');

    // (a) Guardrail trip → AUTO_APPLIED SUSPENDED.
    await register(app, key, { agentKey: 'risky', taskKey: 'pay' });
    await track(app, key, {
      type: 'decision',
      agentKey: 'risky',
      taskKey: 'pay',
      at: at(0),
      action: { x: 1 },
      verdict: { kind: 'ACCEPTED' },
      outcome: 'SUCCESS',
      confidence: 0.9,
      source: 'sdk',
      externalRef: 'risky:pay:0',
      signals: { guardrail: { guardrailId: 'refund_cap', reason: 'over cap' } },
    });

    // (b) Signal-loss: climb to CO_PILOT, approve, then sustained INSUFFICIENT → SIGNAL_LOSS.
    await climbToPending(app, key, 'fader', 'classify');
    await app.inject({
      method: 'POST',
      url: '/agents/fader/tasks/classify/approve',
      headers: internalHeaders(TOKEN, 'org_safe', 'ada@acme.com'),
    });
    const FAR = 35 * 24 * 60;
    for (let i = 0; i < 2; i += 1) {
      await track(app, key, {
        type: 'decision',
        agentKey: 'fader',
        taskKey: 'classify',
        at: at(FAR + i),
        action: { i },
        verdict: { kind: 'ACCEPTED' },
        outcome: 'SUCCESS',
        source: 'sdk', // NO confidence → INSUFFICIENT
        externalRef: `fader-sl-${i}`,
      });
    }

    const json = (await get(key, '/guardrails')).json<{
      events: { trigger: string; toMode: string; status: string; agentKey: string }[];
      suspended: { agentKey: string; taskKey: string }[];
    }>();
    const triggers = json.events.map((e) => e.trigger);
    expect(triggers).toContain('GUARDRAIL');
    expect(triggers).toContain('SIGNAL_LOSS'); // ratified, distinct from DRIFT
    expect(json.suspended).toContainEqual({ agentKey: 'risky', taskKey: 'pay' });
  });
});

describe('read-model auth', () => {
  it('rejects an unauthenticated read', async () => {
    const res = await app.inject({ method: 'GET', url: '/registry' });
    expect(res.statusCode).toBe(401);
  });

  it('tenant isolation: an internal call only sees its own org', async () => {
    const keyA = await provision('org_iso_a');
    await register(app, keyA, { agentKey: 'a-only', taskKey: 'classify' });
    for (let i = 0; i < 3; i += 1) await tracked(keyA, 'a-only', 'classify', i);
    await provision('org_iso_b');

    const res = await app.inject({
      method: 'GET',
      url: '/registry',
      headers: internalHeaders(TOKEN, 'org_iso_b'),
    });
    const json = res.json<{ agents: { agentKey: string }[] }>();
    expect(json.agents.find((x) => x.agentKey === 'a-only')).toBeUndefined();
  });
});
