import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  at,
  climbToPending,
  internalHeaders,
  makeApp,
  provision,
  resetDb,
  teardown,
  track,
} from './helpers.js';

const TOKEN = 'test-internal-token-0123456789';
// >30 days after the climb decisions (at(0..13) ≈ 2026-06-15), so the confidence-bearing
// climb window ages out and the recent confidence-less decisions leave the window INSUFFICIENT.
const FAR = 35 * 24 * 60; // minutes

let app: FastifyInstance;

beforeAll(() => {
  process.env['PROVABLE_INTERNAL_TOKEN'] = TOKEN;
  app = makeApp();
});
afterAll(() => teardown(app));
beforeEach(resetDb);

function signalLoss(key: string, i: number) {
  // ACCEPTED+SUCCESS but NO confidence → readiness INSUFFICIENT (confidence absent).
  return track(app, key, {
    type: 'decision',
    agentKey: 'sl-agent',
    taskKey: 'classify',
    at: at(FAR + i),
    action: { i },
    verdict: { kind: 'ACCEPTED' },
    outcome: 'SUCCESS',
    source: 'sdk',
    externalRef: `sl-${i}`,
  });
}

describe('Signal-loss demotion — e2e over HTTP', () => {
  it('a governed CO_PILOT task auto-demotes one band after sustained INSUFFICIENT', async () => {
    const key = await provision('org_sl');
    await climbToPending(app, key, 'sl-agent', 'classify');

    // Promote to CO_PILOT via the Clerk-authed human path.
    const approve = await app.inject({
      method: 'POST',
      url: '/agents/sl-agent/tasks/classify/approve',
      headers: internalHeaders(TOKEN, 'org_sl', 'alice@acme.com'),
    });
    expect(approve.json<{ effectiveMode: string }>().effectiveMode).toBe('CO_PILOT');

    // 1st INSUFFICIENT recompute — within grace, no demotion.
    const first = (await signalLoss(key, 0)).json<{ effectiveMode: string; score: { status: string } }>();
    expect(first.score.status).toBe('INSUFFICIENT');
    expect(first.effectiveMode).toBe('CO_PILOT');

    // 2nd consecutive INSUFFICIENT — AUTO_APPLIED demotion, one band down, no approver.
    const second = (await signalLoss(key, 1)).json<{
      effectiveMode: string;
      transitions: { direction: string; status: string; trigger: string; toMode: string; approver?: string }[];
    }>();
    expect(second.effectiveMode).toBe('SHADOW');
    const demotion = second.transitions.find((t) => t.direction === 'DEMOTION');
    expect(demotion?.status).toBe('AUTO_APPLIED');
    expect(demotion?.trigger).toBe('DRIFT');
    expect(demotion?.toMode).toBe('SHADOW');
    expect(demotion?.approver).toBeUndefined();
  });
});
