import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, at, internalHeaders, makeApp, provision, resetDb, teardown } from './helpers.js';

// Phase C3 — reference connector end-to-end: external events → canonical Decisions via the
// adapter, ingested through recompute. Machine-key auth; idempotent; honest fidelity; tenant-safe.
const TOKEN = 'c3-internal-token';
let app: FastifyInstance;

beforeAll(() => {
  process.env['PROVABLE_INTERNAL_TOKEN'] = TOKEN;
  app = makeApp();
});
afterAll(() => teardown(app));
beforeEach(resetDb);

const connect = (key: string | undefined, connectorId: string, body: unknown) =>
  app.inject({
    method: 'POST',
    url: `/connector/${connectorId}`,
    headers: { 'content-type': 'application/json', ...(key !== undefined ? { authorization: `Bearer ${key}` } : {}) },
    payload: body as object,
  });

const visibility = (orgId: string) =>
  app
    .inject({ method: 'GET', url: '/visibility', headers: internalHeaders(TOKEN, orgId) })
    .then((r) => r.json<{ tasks: { taskKey: string; fidelity: string; scoreStatus: string | null; readinessScore: number | null }[] }>());

describe('reference connector — ingest + fidelity', () => {
  it('verdict-present events ingest as GOVERNED (scored); the agent self-registers ACTIVE', async () => {
    const key = await provision('org_c');
    const events = Array.from({ length: 12 }, (_, i) => ({
      agent: 'support-bot',
      task: 'classify',
      id: `gov-${i}`,
      input: { i },
      confidence: 0.95,
      verdict: 'approved',
      outcome: 'success',
      timestamp: at(i),
    }));
    const res = await connect(key, 'events', events);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ ingested: number }>().ingested).toBe(12);

    const rows = await admin.decision.findMany({ where: { orgId: 'org_c' } });
    expect(rows).toHaveLength(12);
    expect(rows.every((d) => d.source === 'connector')).toBe(true);
    expect(rows.every((d) => d.status === 'RESOLVED')).toBe(true); // verdict + outcome → resolved

    const task = (await visibility('org_c')).tasks.find((t) => t.taskKey === 'classify')!;
    expect(task.fidelity).toBe('governed');
    expect(task.scoreStatus).toBe('SCORED'); // a real readiness score, not N/A

    const agent = await admin.agent.findFirst({ where: { orgId: 'org_c', agentKey: 'support-bot' } });
    expect(agent?.identityState).toBe('ACTIVE');
  });

  it('verdict-ABSENT events ingest as Observe-only — honest N/A readiness, never 0', async () => {
    const key = await provision('org_o');
    const res = await connect(key, 'events', { agent: 'a', task: 'watch', id: 'obs-1', input: 'x' });
    expect(res.statusCode).toBe(200);

    const task = (await visibility('org_o')).tasks.find((t) => t.taskKey === 'watch')!;
    expect(task.fidelity).toBe('observe-only');
    expect(task.readinessScore).toBeNull(); // N/A, not 0
    expect(task.scoreStatus).toBe('INSUFFICIENT');
  });
});

describe('reference connector — idempotency, auth, validation', () => {
  it('redelivering the same externalRef does NOT double-count', async () => {
    const key = await provision('org_idem');
    const event = { agent: 'a', task: 't', id: 'dup-1', input: 'x', verdict: 'approved', outcome: 'success' };
    await connect(key, 'events', event);
    await connect(key, 'events', event); // redelivery
    expect(await admin.decision.count({ where: { orgId: 'org_idem' } })).toBe(1);
  });

  it('REJECTS an event missing the mapped externalRef (400, nothing ingested)', async () => {
    const key = await provision('org_rej');
    const res = await connect(key, 'events', { agent: 'a', task: 't', input: 'x' }); // no id
    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toMatch(/externalRef/i);
    expect(await admin.decision.count({ where: { orgId: 'org_rej' } })).toBe(0);
  });

  it('requires a machine key (401) and a known connector id (404)', async () => {
    const key = await provision('org_auth');
    expect((await connect(undefined, 'events', { agent: 'a', task: 't', id: '1' })).statusCode).toBe(401);
    expect((await connect(key, 'nope', { agent: 'a', task: 't', id: '1' })).statusCode).toBe(404);
  });
});

describe('reference connector — tenant safety', () => {
  it('records ONLY under the machine-key org, even if the payload names another org/agent', async () => {
    const keyA = await provision('org_A');
    await provision('org_B');

    // Malicious payload: an extra orgId field + a foreign-looking agent. orgId is never read from
    // the payload (the mapping output carries no tenant) — auth decides the tenant.
    await connect(keyA, 'events', {
      orgId: 'org_B',
      agent: 'agent-x',
      task: 't',
      id: 'cross-1',
      input: 'x',
      verdict: 'approved',
      outcome: 'success',
    });

    expect(await admin.decision.count({ where: { orgId: 'org_A' } })).toBe(1);
    expect(await admin.decision.count({ where: { orgId: 'org_B' } })).toBe(0);
  });
});
