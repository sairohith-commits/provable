import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  admin,
  internalHeaders,
  makeApp,
  ownerSubject,
  provision,
  register,
  resetDb,
  seedMember,
  teardown,
} from './helpers.js';

// Phase 1 kill-switch (Trigger + Audit) over HTTP. ADVISORY — records SUSPENDED + emits an
// audited SUSPEND/RESUME transition; nothing is enforced yet (the gateway gate is Phase 2).
const TOKEN = 'killswitch-internal-token';
let app: FastifyInstance;

beforeAll(() => {
  process.env['PROVABLE_INTERNAL_TOKEN'] = TOKEN;
  app = makeApp();
});
afterAll(() => teardown(app));
beforeEach(resetDb);

// ── route helpers ──────────────────────────────────────────────────────────────
const suspendTask = (orgId: string, subject: string | undefined, a: string, t: string, reason = 'incident', approver?: string) =>
  app.inject({
    method: 'POST',
    url: `/agents/${a}/tasks/${t}/suspend`,
    headers: internalHeaders(TOKEN, orgId, approver, subject),
    payload: { reason },
  });

const resumeTask = (orgId: string, subject: string | undefined, a: string, t: string, reason = 'cleared', approver?: string) =>
  app.inject({
    method: 'POST',
    url: `/agents/${a}/tasks/${t}/resume`,
    headers: internalHeaders(TOKEN, orgId, approver, subject),
    payload: { reason },
  });

const suspendAgentWide = (orgId: string, subject: string | undefined, a: string, reason = 'incident', approver?: string) =>
  app.inject({
    method: 'POST',
    url: `/admin/agents/${a}/suspend`,
    headers: internalHeaders(TOKEN, orgId, approver, subject),
    payload: { reason },
  });

const resumeAgentWide = (orgId: string, subject: string | undefined, a: string, reason = 'cleared', approver?: string) =>
  app.inject({
    method: 'POST',
    url: `/admin/agents/${a}/resume`,
    headers: internalHeaders(TOKEN, orgId, approver, subject),
    payload: { reason },
  });

const readMode = (orgId: string, a: string, t: string) =>
  app
    .inject({ method: 'GET', url: `/agents/${a}/tasks/${t}`, headers: internalHeaders(TOKEN, orgId) })
    .then((r) => r.json<{ effectiveMode: string }>().effectiveMode);

describe('per-task suspend / resume (suspend_agent)', () => {
  it('happy path: suspend → SUSPENDED then resume → OBSERVING, each audited with trigger + actor + reason', async () => {
    const key = await provision('org_pt');
    await register(app, key, { agentKey: 'a', taskKey: 't' });
    const owner = ownerSubject('org_pt');

    const s = await suspendTask('org_pt', owner, 'a', 't', 'pii leak', 'alice@org');
    expect(s.statusCode).toBe(200);
    const sBody = s.json<{ effectiveMode: string; transitions: { trigger: string }[] }>();
    expect(sBody.effectiveMode).toBe('SUSPENDED');
    expect(sBody.transitions.filter((t) => t.trigger === 'SUSPEND')).toHaveLength(1);
    expect(await readMode('org_pt', 'a', 't')).toBe('SUSPENDED');

    const sTrans = (await admin.transition.findMany({ where: { orgId: 'org_pt', trigger: 'SUSPEND' } }))[0]!;
    expect(sTrans.status).toBe('APPLIED');
    expect(sTrans.toMode).toBe('SUSPENDED');
    expect(sTrans.actor).toBe('alice@org'); // actor = approver header
    expect(sTrans.approver).toBeNull();
    expect(sTrans.reason).toBe('pii leak');

    const r = await resumeTask('org_pt', owner, 'a', 't', 'all clear', 'alice@org');
    expect(r.statusCode).toBe(200);
    const rBody = r.json<{ effectiveMode: string; transitions: { trigger: string }[] }>();
    expect(rBody.effectiveMode).toBe('OBSERVING');
    expect(rBody.transitions.filter((t) => t.trigger === 'RESUME')).toHaveLength(1);
    expect(await readMode('org_pt', 'a', 't')).toBe('OBSERVING');

    const rTrans = (await admin.transition.findMany({ where: { orgId: 'org_pt', trigger: 'RESUME' } }))[0]!;
    expect(rTrans.fromMode).toBe('SUSPENDED');
    expect(rTrans.toMode).toBe('OBSERVING');
    expect(rTrans.actor).toBe('alice@org');
    expect(rTrans.reason).toBe('all clear');
  });

  it('409: double-suspend (already SUSPENDED) and resume of a non-suspended task', async () => {
    const key = await provision('org_409');
    await register(app, key, { agentKey: 'a', taskKey: 't' });
    const owner = ownerSubject('org_409');

    expect((await suspendTask('org_409', owner, 'a', 't')).statusCode).toBe(200);
    expect((await suspendTask('org_409', owner, 'a', 't')).statusCode).toBe(409); // already SUSPENDED

    // A fresh OBSERVING task cannot be resumed.
    await register(app, key, { agentKey: 'a', taskKey: 't2' });
    expect((await resumeTask('org_409', owner, 'a', 't2')).statusCode).toBe(409);
  });

  it('404: unknown agent×task', async () => {
    await provision('org_404');
    const owner = ownerSubject('org_404');
    expect((await suspendTask('org_404', owner, 'ghost', 'nope')).statusCode).toBe(404);
    expect((await resumeTask('org_404', owner, 'ghost', 'nope')).statusCode).toBe(404);
  });

  it('400: reason required', async () => {
    const key = await provision('org_400');
    await register(app, key, { agentKey: 'a', taskKey: 't' });
    const res = await app.inject({
      method: 'POST',
      url: '/agents/a/tasks/t/suspend',
      headers: internalHeaders(TOKEN, 'org_400', undefined, ownerSubject('org_400')),
      payload: { reason: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('RBAC: OWNER and APPROVER succeed; OPERATOR and VIEWER get 403; machine keys 401', async () => {
    const key = await provision('org_rbac');
    await register(app, key, { agentKey: 'a', taskKey: 't' });
    await seedMember('org_rbac', 'subj-approver', 'ap@x.test', 'APPROVER');
    await seedMember('org_rbac', 'subj-operator', 'op@x.test', 'OPERATOR');
    await seedMember('org_rbac', 'subj-viewer', 'vw@x.test', 'VIEWER');

    // Permission is checked BEFORE any state logic → role outcome is independent of task state.
    expect((await suspendTask('org_rbac', 'subj-viewer', 'a', 't')).statusCode).toBe(403);
    expect((await suspendTask('org_rbac', 'subj-operator', 'a', 't')).statusCode).toBe(403);
    // APPROVER suspends (→ SUSPENDED); OWNER then resumes (→ OBSERVING): both privileged roles succeed.
    expect((await suspendTask('org_rbac', 'subj-approver', 'a', 't')).statusCode).toBe(200);
    expect((await resumeTask('org_rbac', ownerSubject('org_rbac'), 'a', 't')).statusCode).toBe(200);

    // Machine key (no internal context) → 401.
    const mk = await app.inject({
      method: 'POST',
      url: '/agents/a/tasks/t/suspend',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      payload: { reason: 'x' },
    });
    expect(mk.statusCode).toBe(401);
  });
});

describe('agent-wide suspend / resume (fan-out + durable marker)', () => {
  async function agentRow(orgId: string, agentKey: string) {
    return admin.agent.findFirst({ where: { orgId, agentKey } });
  }

  it('fans out one audited transition per task AND sets the marker; resume clears marker + each task → OBSERVING', async () => {
    const key = await provision('org_aw');
    await register(app, key, { agentKey: 'a', taskKey: 't1' });
    await register(app, key, { agentKey: 'a', taskKey: 't2' });
    const owner = ownerSubject('org_aw');

    const s = await suspendAgentWide('org_aw', owner, 'a', 'fleet incident', 'alice@org');
    expect(s.statusCode).toBe(200);
    expect(s.json()).toMatchObject({ marker: 'suspended', suspended: 2, skipped: 0 });
    // one SUSPEND transition per task.
    expect(await admin.transition.count({ where: { orgId: 'org_aw', trigger: 'SUSPEND' } })).toBe(2);
    expect(await readMode('org_aw', 'a', 't1')).toBe('SUSPENDED');
    expect(await readMode('org_aw', 'a', 't2')).toBe('SUSPENDED');
    // durable marker set with the actor.
    const after = await agentRow('org_aw', 'a');
    expect(after?.suspendedAt).not.toBeNull();
    expect(after?.suspendedBy).toBe('alice@org');

    const r = await resumeAgentWide('org_aw', owner, 'a', 'fleet recovered', 'alice@org');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ marker: 'cleared', resumed: 2, skipped: 0 });
    expect(await admin.transition.count({ where: { orgId: 'org_aw', trigger: 'RESUME' } })).toBe(2);
    expect(await readMode('org_aw', 'a', 't1')).toBe('OBSERVING');
    expect(await readMode('org_aw', 'a', 't2')).toBe('OBSERVING');
    const cleared = await agentRow('org_aw', 'a');
    expect(cleared?.suspendedAt).toBeNull();
    expect(cleared?.suspendedBy).toBeNull();
  });

  it('mixed state: a task already SUSPENDED is skipped, the rest proceed; counts reported; marker still set', async () => {
    const key = await provision('org_mix');
    await register(app, key, { agentKey: 'a', taskKey: 't1' });
    await register(app, key, { agentKey: 'a', taskKey: 't2' });
    const owner = ownerSubject('org_mix');

    // Pre-suspend t1 only (per-task) — leaves t2 OBSERVING.
    expect((await suspendTask('org_mix', owner, 'a', 't1')).statusCode).toBe(200);

    const s = await suspendAgentWide('org_mix', owner, 'a');
    expect(s.statusCode).toBe(200);
    expect(s.json()).toMatchObject({ marker: 'suspended', suspended: 1, skipped: 1 });
    expect(await readMode('org_mix', 'a', 't2')).toBe('SUSPENDED');
    expect((await agentRow('org_mix', 'a'))?.suspendedAt).not.toBeNull();
  });

  it('409: every task already in the target state (zero would change)', async () => {
    const key = await provision('org_all');
    await register(app, key, { agentKey: 'a', taskKey: 't1' });
    await register(app, key, { agentKey: 'a', taskKey: 't2' });
    const owner = ownerSubject('org_all');

    expect((await suspendAgentWide('org_all', owner, 'a')).statusCode).toBe(200); // both → SUSPENDED
    expect((await suspendAgentWide('org_all', owner, 'a')).statusCode).toBe(409); // all already SUSPENDED
  });

  it('zero-task agent: marker set/cleared, 200, no transitions (valid no-op fan-out)', async () => {
    await provision('org_zt');
    // A task-less agent (admin insert bypasses RLS; org already exists from provision).
    await admin.agent.create({ data: { orgId: 'org_zt', agentKey: 'lonely' } });
    const owner = ownerSubject('org_zt');

    const s = await suspendAgentWide('org_zt', owner, 'lonely');
    expect(s.statusCode).toBe(200);
    expect(s.json()).toMatchObject({ marker: 'suspended', suspended: 0, skipped: 0 });
    expect(await admin.transition.count({ where: { orgId: 'org_zt' } })).toBe(0);
    expect((await agentRow('org_zt', 'lonely'))?.suspendedAt).not.toBeNull();

    const r = await resumeAgentWide('org_zt', owner, 'lonely');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ marker: 'cleared', resumed: 0, skipped: 0 });
    expect((await agentRow('org_zt', 'lonely'))?.suspendedAt).toBeNull();
  });

  it('404: unknown agent (agent-wide)', async () => {
    await provision('org_awnf');
    expect((await suspendAgentWide('org_awnf', ownerSubject('org_awnf'), 'ghost')).statusCode).toBe(404);
  });
});

describe('org isolation — a cross-tenant caller cannot touch another org’s agent/tasks', () => {
  it('per-task and agent-wide suspend from org_y cannot reach org_x; org_x is untouched (404)', async () => {
    const keyX = await provision('org_x');
    await register(app, keyX, { agentKey: 'ax', taskKey: 't' });
    await provision('org_y'); // org_y has its OWN owner but no agent 'ax'

    const ownerY = ownerSubject('org_y');
    // org_y owner is authorized in org_y, but 'ax' doesn't exist in org_y's tenant → 404.
    expect((await suspendTask('org_y', ownerY, 'ax', 't')).statusCode).toBe(404);
    expect((await suspendAgentWide('org_y', ownerY, 'ax')).statusCode).toBe(404);

    // org_x's task and agent are completely untouched.
    expect(await readMode('org_x', 'ax', 't')).toBe('OBSERVING');
    expect(await admin.transition.count({ where: { orgId: 'org_x' } })).toBe(0);
    expect((await admin.agent.findFirst({ where: { orgId: 'org_x', agentKey: 'ax' } }))?.suspendedAt).toBeNull();
  });
});
