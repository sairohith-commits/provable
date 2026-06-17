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

const TOKEN = 'test-internal-token-connect-0123456789';
let app: FastifyInstance;

beforeAll(() => {
  process.env['PROVABLE_INTERNAL_TOKEN'] = TOKEN;
  app = makeApp();
});
afterAll(() => teardown(app));
beforeEach(resetDb);

function rotate(headers: Record<string, string>) {
  return app.inject({ method: 'POST', url: '/org/api-key/rotate', headers });
}
function trackOne(key: string, i: number) {
  return track(app, key, {
    type: 'decision',
    agentKey: 'k-agent',
    taskKey: 'classify',
    at: at(i),
    action: { i },
    verdict: { kind: 'ACCEPTED' },
    outcome: 'SUCCESS',
    confidence: 0.9,
    source: 'sdk',
    externalRef: `k-agent:classify:${i}`,
  });
}

describe('Clerk-authed key ROTATE — moat', () => {
  it('a machine key CANNOT rotate (401)', async () => {
    const key = await provision('org_rot1');
    const res = await rotate({ authorization: `Bearer ${key}`, 'content-type': 'application/json' });
    expect(res.statusCode).toBe(401);
    // the machine key still works → it was not rotated by the failed attempt
    expect((await trackOne(key, 0)).statusCode).toBe(200);
  });

  it('the Clerk-authed human path mints a show-once key; the OLD key dies immediately', async () => {
    const oldKey = await provision('org_rot2');
    expect((await trackOne(oldKey, 0)).statusCode).toBe(200); // old key works pre-rotate

    const res = await rotate(internalHeaders(TOKEN, 'org_rot2', 'ada@acme.com'));
    expect(res.statusCode).toBe(200);
    const body = res.json<{ key: string; prefix: string }>();
    expect(body.key).toMatch(/^pvb_[0-9a-f]+_[0-9a-f]+$/); // plaintext returned ONCE
    const newKey = body.key;

    // OLD key is dead on /track …
    expect((await trackOne(oldKey, 1)).statusCode).toBe(401);
    // … and the NEW key works.
    expect((await trackOne(newKey, 2)).statusCode).toBe(200);
  });

  it('rotate requires the org id too — token alone (no org) is not internal context', async () => {
    await provision('org_rot3');
    const res = await rotate({
      'content-type': 'application/json',
      'x-provable-internal-token': TOKEN, // no x-provable-org-id
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /summary — REAL KPI counts', () => {
  function get(key: string) {
    return app.inject({ method: 'GET', url: '/summary', headers: { authorization: `Bearer ${key}` } });
  }

  it('a fresh org shows HONEST empty cards (no fabricated figures)', async () => {
    const key = await provision('org_sum_empty');
    const s = (await get(key)).json<{
      activeAgents: number;
      pendingApprovals: number;
      suspendedCount: number;
      tokenSpend: number;
      usdSpend: number;
      hasCostSignal: boolean;
      roi: { projectedSavingsIfPromotedUsd: number; assumptions: unknown };
      apiKeyPrefix: string | null;
    }>();
    expect(s.activeAgents).toBe(0);
    expect(s.pendingApprovals).toBe(0);
    expect(s.suspendedCount).toBe(0);
    expect(s.tokenSpend).toBe(0);
    expect(s.usdSpend).toBe(0);
    expect(s.hasCostSignal).toBe(false);
    // empty ≠ fabricated: savings is 0 but the assumptions still travel with it.
    expect(s.roi.projectedSavingsIfPromotedUsd).toBe(0);
    expect(s.roi.assumptions).toBeDefined();
    expect(s.apiKeyPrefix).not.toBeNull(); // the lookup handle for the Connect view
  });

  it('reflects real activity: active agents, pending approval, suspension, spend', async () => {
    const key = await provision('org_sum');
    // an active agent with a pending promotion (climb → PENDING_APPROVAL)
    await climbToPending(app, key, 'live-agent', 'classify');
    // a guardrail suspension on another task
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
      signals: { guardrail: { guardrailId: 'cap', reason: 'over cap' } },
      cost: { tokens: 500, usd: 0.05 },
    });

    const s = (await get(key)).json<{
      activeAgents: number;
      pendingApprovals: number;
      suspendedCount: number;
      guardrailEventCount: number;
      tokenSpend: number;
      hasCostSignal: boolean;
      roi: { assumptions: { assumedHumanHourlyUsd: number } };
    }>();
    expect(s.activeAgents).toBeGreaterThanOrEqual(1);
    expect(s.pendingApprovals).toBeGreaterThanOrEqual(1);
    expect(s.suspendedCount).toBe(1);
    expect(s.guardrailEventCount).toBeGreaterThanOrEqual(1);
    expect(s.tokenSpend).toBe(500);
    expect(s.hasCostSignal).toBe(true);
    expect(s.roi.assumptions.assumedHumanHourlyUsd).toBeGreaterThan(0); // projection labeled w/ inputs
  });

  it('rejects an unauthenticated summary read', async () => {
    expect((await app.inject({ method: 'GET', url: '/summary' })).statusCode).toBe(401);
  });
});
