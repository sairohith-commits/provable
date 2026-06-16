import type { OrgId } from '@provable/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { recompute } from '../src/index.js';
import type { TrackBody } from '../src/schemas.js';
import { admin, at, provision, resetDb, teardown } from './helpers.js';
import { makeApp } from './helpers.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
beforeAll(() => {
  app = makeApp();
});
afterAll(() => teardown(app));
beforeEach(resetDb);

describe('Atomic recompute', () => {
  it('a failure mid-recompute rolls back EVERYTHING (no orphan decision without a score)', async () => {
    await provision('org_atom');
    const body = {
      type: 'decision',
      agentKey: 'a1',
      taskKey: 't1',
      at: at(1),
      action: { label: 'x' },
      verdict: { kind: 'ACCEPTED' },
      outcome: 'SUCCESS',
      confidence: 0.9,
      source: 'sdk',
      externalRef: 'atom1',
    } as TrackBody;

    await expect(
      recompute('org_atom' as OrgId, body, { failAfterPersist: true }),
    ).rejects.toThrow(/atomicity/i);

    // The whole transaction rolled back: no decision, no score, no agent/task.
    expect(await admin.decision.count()).toBe(0);
    expect(await admin.score.count()).toBe(0);
    expect(await admin.agent.count()).toBe(0);

    // And a normal recompute afterwards still works (DB not left in a bad state).
    const ok = await recompute('org_atom' as OrgId, body);
    expect('score' in ok).toBe(true);
    expect(await admin.decision.count()).toBe(1);
    expect(await admin.score.count()).toBe(1);
  });
});
