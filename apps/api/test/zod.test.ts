import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, at, makeApp, provision, resetDb, teardown, track } from './helpers.js';

let app: FastifyInstance;

beforeAll(() => {
  app = makeApp();
});
afterAll(() => teardown(app));
beforeEach(resetDb);

describe('zod boundary validation', () => {
  it('rejects a malformed payload with 4xx and never persists anything', async () => {
    const key = await provision('org_zod');

    // Missing required `source`, and an invalid verdict kind.
    const bad = await track(app, key, {
      type: 'decision',
      agentKey: 'a1',
      taskKey: 't1',
      at: at(1),
      action: { label: 'x' },
      verdict: { kind: 'NOT_A_REAL_KIND' },
      externalRef: 'bad1',
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toHaveProperty('issues');

    // The boundary stopped it before core/persistence: nothing was written.
    const decisions = await admin.decision.count();
    expect(decisions).toBe(0);
  });

  it('rejects magnitude on a non-OVERRIDDEN verdict', async () => {
    const key = await provision('org_zod2');
    const bad = await track(app, key, {
      type: 'decision',
      agentKey: 'a1',
      taskKey: 't1',
      at: at(1),
      action: {},
      verdict: { kind: 'ACCEPTED', magnitude: 0.5 },
      source: 'sdk',
      externalRef: 'bad2',
    });
    expect(bad.statusCode).toBe(400);
  });
});
