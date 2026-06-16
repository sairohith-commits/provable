import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { at, makeApp, provision, register, resetDb, teardown, track } from './helpers.js';

let app: FastifyInstance;

beforeAll(() => {
  app = makeApp();
});
afterAll(() => teardown(app));
beforeEach(resetDb);

function decision(i: number, extra: Record<string, unknown> = {}) {
  return {
    type: 'decision',
    agentKey: 'a1',
    taskKey: 't1',
    at: at(i),
    action: { label: 'x' },
    verdict: { kind: 'ACCEPTED' },
    outcome: 'SUCCESS',
    confidence: 0.95,
    source: 'sdk',
    externalRef: `d${i}`,
    ...extra,
  };
}

describe('End-to-end HTTP loop', () => {
  it('OBSERVING→SHADOW, promotion stays PENDING (no auto-promote) until approval, guardrail auto-demotes', async () => {
    const key = await provision('org_e2e');
    expect((await register(app, key, { agentKey: 'a1', taskKey: 't1' })).statusCode).toBe(200);

    const modes: string[] = [];
    const statuses: string[] = [];
    for (let i = 1; i <= 14; i++) {
      const r = await track(app, key, decision(i));
      expect(r.statusCode).toBe(200);
      const b = r.json();
      modes.push(b.effectiveMode);
      for (const t of b.transitions) statuses.push(t.status);
    }

    // OBSERVING until 10 resolved+scored decisions accrue, then SHADOW (never SOLO).
    expect(modes[8]).toBe('OBSERVING'); // after the 9th
    expect(modes[9]).toBe('SHADOW'); // after the 10th

    // A 98.75 score implies SOLO, but autonomy does not move: a gated proposal forms.
    expect(modes[13]).toBe('SHADOW');
    expect(statuses).toContain('PROPOSED');
    expect(statuses).toContain('PENDING_APPROVAL');
    expect(statuses).not.toContain('APPLIED');

    // Approval path: a manual APPROVE applies the promotion (one band).
    const approve = (await track(app, key, decision(15, {
      signals: { manual: { kind: 'APPROVE', approver: 'alice' } },
    }))).json();
    expect(approve.effectiveMode).toBe('CO_PILOT');
    const applied = approve.transitions.find((t: { status: string }) => t.status === 'APPLIED');
    expect(applied.direction).toBe('PROMOTION');
    expect(applied.approver).toBe('alice');

    // Guardrail: instant auto-demotion, no approver.
    const guard = (await track(app, key, decision(16, {
      signals: { guardrail: { guardrailId: 'g1', reason: 'pii leak' } },
    }))).json();
    expect(guard.effectiveMode).toBe('SUSPENDED');
    expect(guard.transitions[0].status).toBe('AUTO_APPLIED');
    expect(guard.transitions[0].approver).toBeUndefined();

    // Read-back endpoint reflects materialized state + latest score.
    const read = (await app.inject({
      method: 'GET',
      url: '/agents/a1/tasks/t1',
      headers: { authorization: `Bearer ${key}` },
    })).json();
    expect(read.effectiveMode).toBe('SUSPENDED');
    expect(read.score.status).toBe('SCORED');
  });

  it('returns the full recompute result shape', async () => {
    const key = await provision('org_shape');
    const b = (await track(app, key, decision(1))).json();
    expect(b).toHaveProperty('score');
    expect(b).toHaveProperty('effectiveMode');
    expect(Array.isArray(b.transitions)).toBe(true);
    expect(b.score.status).toBe('SCORED');
    expect(typeof b.score.readinessScore).toBe('number');
    expect(b.score).toHaveProperty('eventCount');
    expect(b.score).toHaveProperty('resolvedCount');
  });
});
