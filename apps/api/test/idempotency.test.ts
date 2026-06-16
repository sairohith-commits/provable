import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, at, makeApp, provision, resetDb, teardown, track } from './helpers.js';

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
  externalRef: 'dup',
};

describe('Idempotency by externalRef', () => {
  it('same externalRef twice → single effect, stable response', async () => {
    const key = await provision('org_idem');

    const first = (await track(app, key, decision)).json();
    const second = (await track(app, key, decision)).json();

    // Stable response: same materialized mode; the replay advances nothing.
    expect(second.effectiveMode).toBe(first.effectiveMode);
    expect(second.transitions).toHaveLength(0);

    // Single effect at the DB: exactly one decision row for that ref.
    const count = await admin.decision.count({ where: { externalRef: 'dup' } });
    expect(count).toBe(1);
  });
});
