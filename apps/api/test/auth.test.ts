import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { at, makeApp, provision, register, resetDb, teardown, track } from './helpers.js';

let app: FastifyInstance;

beforeAll(() => {
  app = makeApp();
});
afterAll(() => teardown(app));
beforeEach(resetDb);

const decision = {
  type: 'decision',
  agentKey: 'a1',
  taskKey: 't1',
  at: at(1),
  action: { label: 'x' },
  verdict: { kind: 'ACCEPTED' },
  outcome: 'SUCCESS',
  confidence: 0.9,
  source: 'sdk',
  externalRef: 'd1',
};

describe('Auth + RLS', () => {
  it('rejects missing and invalid keys with 401', async () => {
    const noKey = await app.inject({ method: 'GET', url: '/agents/a1/tasks/t1' });
    expect(noKey.statusCode).toBe(401);

    const badKey = await app.inject({
      method: 'GET',
      url: '/agents/a1/tasks/t1',
      headers: { authorization: 'Bearer pvb_deadbeef_notarealsecret' },
    });
    expect(badKey.statusCode).toBe(401);
  });

  it('a valid key scopes to exactly its org; cross-org read returns nothing', async () => {
    const keyA = await provision('orgA');
    const keyB = await provision('orgB');

    await register(app, keyA, { agentKey: 'a1', taskKey: 't1' });
    expect((await track(app, keyA, decision)).statusCode).toBe(200);

    // org A sees its own task.
    const ownView = await app.inject({
      method: 'GET',
      url: '/agents/a1/tasks/t1',
      headers: { authorization: `Bearer ${keyA}` },
    });
    expect(ownView.statusCode).toBe(200);

    // org B (valid key, different tenant) cannot see A's task — RLS + auth together.
    const crossView = await app.inject({
      method: 'GET',
      url: '/agents/a1/tasks/t1',
      headers: { authorization: `Bearer ${keyB}` },
    });
    expect(crossView.statusCode).toBe(404);
  });
});
