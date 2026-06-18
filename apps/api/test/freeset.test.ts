import { TransitionTrigger as PrismaTrigger } from '@prisma/client';
import { TRANSITION_TRIGGERS } from '@provable/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  admin,
  at,
  internalHeaders,
  makeApp,
  ownerSubject,
  provision,
  register,
  resetDb,
  seedMember,
  teardown,
  track,
} from './helpers.js';

// Free-set-mode (MANUAL_OVERRIDE) over HTTP: enforcement, audit, and the crux (standing gap
// holds; a new adverse event still auto-demotes a manually-set agent).
const TOKEN = 'freeset-internal-token';
let app: FastifyInstance;

beforeAll(() => {
  process.env['PROVABLE_INTERNAL_TOKEN'] = TOKEN;
  app = makeApp();
});
afterAll(() => teardown(app));
beforeEach(resetDb);

const setMode = (orgId: string, subject: string | undefined, agentKey: string, taskKey: string, body: object, approver?: string) =>
  app.inject({
    method: 'POST',
    url: `/agents/${agentKey}/tasks/${taskKey}/mode`,
    headers: internalHeaders(TOKEN, orgId, approver, subject),
    payload: body,
  });

const readTask = (orgId: string, agentKey: string, taskKey: string) =>
  app
    .inject({ method: 'GET', url: `/agents/${agentKey}/tasks/${taskKey}`, headers: internalHeaders(TOKEN, orgId) })
    .then((r) => r.json<{ effectiveMode: string }>());

async function seedTask(key: string, agentKey = 'a', taskKey = 't'): Promise<void> {
  await register(app, key, { agentKey, taskKey }); // creates the agent×task at OBSERVING
}

describe('free_set_mode enforcement (API-authoritative, deny-by-default)', () => {
  it('OWNER and APPROVER may free-set; OPERATOR/VIEWER/unassigned are denied (403); machine keys blocked', async () => {
    const key = await provision('org_fs');
    await seedTask(key);
    await seedMember('org_fs', 'subj-approver', 'ap@x.test', 'APPROVER');
    await seedMember('org_fs', 'subj-operator', 'op@x.test', 'OPERATOR');
    await seedMember('org_fs', 'subj-viewer', 'vw@x.test', 'VIEWER');

    const body = { mode: 'CO_PILOT', reason: 'manual' };
    expect((await setMode('org_fs', ownerSubject('org_fs'), 'a', 't', body)).statusCode).toBe(200);
    expect((await setMode('org_fs', 'subj-approver', 'a', 't', body)).statusCode).toBe(200);
    expect((await setMode('org_fs', 'subj-operator', 'a', 't', body)).statusCode).toBe(403);
    expect((await setMode('org_fs', 'subj-viewer', 'a', 't', body)).statusCode).toBe(403);
    expect((await setMode('org_fs', 'ghost', 'a', 't', body)).statusCode).toBe(403);

    // Machine key (no internal context) → 401.
    const mk = await app.inject({
      method: 'POST',
      url: '/agents/a/tasks/t/mode',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      payload: body,
    });
    expect(mk.statusCode).toBe(401);
  });

  it('requires a reason and a valid mode; 404 unknown task; 409 from SUSPENDED', async () => {
    const key = await provision('org_fs2');
    await seedTask(key);
    const owner = ownerSubject('org_fs2');
    expect((await setMode('org_fs2', owner, 'a', 't', { mode: 'SOLO' })).statusCode).toBe(400); // no reason
    expect((await setMode('org_fs2', owner, 'a', 't', { mode: 'OBSERVING', reason: 'x' })).statusCode).toBe(400);
    expect((await setMode('org_fs2', owner, 'a', 'nope', { mode: 'SOLO', reason: 'x' })).statusCode).toBe(404);
  });
});

describe('MANUAL_OVERRIDE is first-class + audited; earned score untouched', () => {
  it('sets the mode immediately and records actor (distinct from approver) + reason; no Score row written', async () => {
    const key = await provision('org_aud');
    await seedTask(key);
    const res = await setMode('org_aud', ownerSubject('org_aud'), 'a', 't', { mode: 'SOLO', reason: 'launch' }, 'alice@org');
    expect(res.statusCode).toBe(200);
    expect(res.json<{ effectiveMode: string }>().effectiveMode).toBe('SOLO');

    const trans = await admin.transition.findMany({ where: { orgId: 'org_aud' } });
    const ov = trans.find((t) => t.trigger === 'MANUAL_OVERRIDE')!;
    expect(ov.status).toBe('APPLIED');
    expect(ov.actor).toBe('alice@org'); // the human identity (approver header)
    expect(ov.approver).toBeNull(); // NOT an approver
    expect(ov.reason).toBe('launch');
    expect(ov.toMode).toBe('SOLO');

    // Earned score untouched: the override wrote NO score row (register created the task only).
    expect(await admin.score.count({ where: { orgId: 'org_aud' } })).toBe(0);
  });
});

describe('the crux over HTTP', () => {
  it('standing gap HOLDS: a manually-set SOLO agent is not auto-undone by a below-mode score', async () => {
    const key = await provision('org_hold');
    await seedTask(key);
    await setMode('org_hold', ownerSubject('org_hold'), 'a', 't', { mode: 'SOLO', reason: 'launch' });

    // A normal decision arrives (no adverse signal). Its score is below SOLO and there is no prior
    // baseline → standing gap, not a fresh decline → the override holds.
    await track(app, key, {
      type: 'decision',
      agentKey: 'a',
      taskKey: 't',
      at: at(1),
      action: {},
      verdict: { kind: 'ACCEPTED' },
      outcome: 'SUCCESS',
      confidence: 0.5,
      source: 'sdk',
      externalRef: 'h1',
    });
    expect((await readTask('org_hold', 'a', 't')).effectiveMode).toBe('SOLO');
  });

  it('STILL auto-demotes a manually-set agent on a new guardrail trip (override is not a safety switch)', async () => {
    const key = await provision('org_dem');
    await seedTask(key);
    await setMode('org_dem', ownerSubject('org_dem'), 'a', 't', { mode: 'SOLO', reason: 'launch' });

    // A guardrail trip arrives via the machine-key data path → instant AUTO_APPLIED suspension.
    await track(app, key, {
      type: 'decision',
      agentKey: 'a',
      taskKey: 't',
      at: at(2),
      action: {},
      verdict: { kind: 'ACCEPTED' },
      outcome: 'SUCCESS',
      confidence: 0.9,
      source: 'sdk',
      externalRef: 'd1',
      signals: { guardrail: { guardrailId: 'pii', trippedAt: at(2), reason: 'leak' } },
    });
    expect((await readTask('org_dem', 'a', 't')).effectiveMode).toBe('SUSPENDED');
    const ev = await admin.transition.findMany({ where: { orgId: 'org_dem', trigger: 'GUARDRAIL' } });
    expect(ev).toHaveLength(1);
    expect(ev[0]!.status).toBe('AUTO_APPLIED');
  });
});

describe('enum lockstep', () => {
  it('Prisma TransitionTrigger mirrors @provable/contracts TRANSITION_TRIGGERS (incl. MANUAL_OVERRIDE)', () => {
    expect(Object.values(PrismaTrigger).sort()).toEqual([...TRANSITION_TRIGGERS].sort());
    expect(Object.values(PrismaTrigger)).toContain('MANUAL_OVERRIDE');
    expect(Object.values(PrismaTrigger)).not.toContain('MANUAL');
  });
});
