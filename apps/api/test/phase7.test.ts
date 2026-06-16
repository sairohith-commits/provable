import type { OrgId } from '@provable/contracts';
import { linkClerkOrg } from '@provable/persistence';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  climbToPending,
  internalHeaders,
  makeApp,
  provision,
  resetDb,
  teardown,
  track,
} from './helpers.js';

const TOKEN = 'test-internal-token-0123456789';

let app: FastifyInstance;

beforeAll(() => {
  process.env['PROVABLE_INTERNAL_TOKEN'] = TOKEN;
  app = makeApp();
});
afterAll(() => teardown(app));
beforeEach(resetDb);

describe('Internal (web) read auth', () => {
  it('reads agents/transitions with a valid internal token + web-resolved org id', async () => {
    const key = await provision('orgA');
    await climbToPending(app, key, 'support-triage', 'classify');

    const agents = await app.inject({
      method: 'GET',
      url: '/agents',
      headers: internalHeaders(TOKEN, 'orgA'),
    });
    expect(agents.statusCode).toBe(200);
    const list = agents.json<{ agents: { agentKey: string; score: { status: string } | null }[] }>();
    expect(list.agents.some((a) => a.agentKey === 'support-triage')).toBe(true);

    const feed = await app.inject({
      method: 'GET',
      url: '/transitions',
      headers: internalHeaders(TOKEN, 'orgA'),
    });
    expect(feed.statusCode).toBe(200);
  });

  it('rejects a bad internal token (no 500), and any token length', async () => {
    await provision('orgA');
    for (const bad of ['wrong', `${TOKEN}x`, 'x'.repeat(TOKEN.length)]) {
      const res = await app.inject({
        method: 'GET',
        url: '/agents',
        headers: { 'x-provable-internal-token': bad, 'x-provable-org-id': 'orgA' },
      });
      expect(res.statusCode).toBe(401);
    }
  });

  it('tenant isolation through the internal path: org id scopes the read', async () => {
    const keyA = await provision('orgA');
    const keyB = await provision('orgB');
    await climbToPending(app, keyA, 'a-agent', 'classify');
    await climbToPending(app, keyB, 'b-agent', 'classify');

    const aView = await app.inject({ method: 'GET', url: '/agents', headers: internalHeaders(TOKEN, 'orgA') });
    const aKeys = aView.json<{ agents: { agentKey: string }[] }>().agents.map((x) => x.agentKey);
    expect(aKeys).toContain('a-agent');
    expect(aKeys).not.toContain('b-agent'); // RLS denies cross-tenant rows
  });
});

describe('MOAT INTEGRITY — only the Clerk-authed human path can approve', () => {
  it('machine key CANNOT approve (endpoint rejects it); internal/human path applies it', async () => {
    const key = await provision('orgA');
    const climbed = await climbToPending(app, key, 'support-triage', 'classify');
    expect(climbed.json<{ effectiveMode: string }>().effectiveMode).toBe('SHADOW');

    // (a) machine key on the approve endpoint → 401, no promotion.
    const machineApprove = await app.inject({
      method: 'POST',
      url: '/agents/support-triage/tasks/classify/approve',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    });
    expect(machineApprove.statusCode).toBe(401);

    // (b) machine key on /track with a manual APPROVE signal → stripped, no promotion.
    const sneaky = await track(app, key, {
      type: 'decision',
      agentKey: 'support-triage',
      taskKey: 'classify',
      at: at99(),
      action: { x: 1 },
      verdict: { kind: 'PENDING' },
      source: 'sdk',
      externalRef: 'sneaky-approve',
      signals: { manual: { kind: 'APPROVE', approver: 'attacker' } },
    });
    expect(sneaky.json<{ effectiveMode: string }>().effectiveMode).toBe('SHADOW'); // not promoted

    // (c) internal/Clerk-human path → APPLIED, ladder advances, approver recorded.
    const human = await app.inject({
      method: 'POST',
      url: '/agents/support-triage/tasks/classify/approve',
      headers: internalHeaders(TOKEN, 'orgA', 'alice@acme.com'),
    });
    expect(human.statusCode).toBe(200);
    const body = human.json<{ effectiveMode: string; transitions: { status: string; approver?: string }[] }>();
    expect(body.effectiveMode).toBe('CO_PILOT');
    const applied = body.transitions.find((t) => t.status === 'APPLIED');
    expect(applied?.approver).toBe('alice@acme.com'); // the authenticated human, not the machine

    // and it shows in the immutable governance feed.
    const feed = await app.inject({
      method: 'GET',
      url: '/transitions',
      headers: internalHeaders(TOKEN, 'orgA'),
    });
    const appliedInFeed = feed
      .json<{ transitions: { status: string; approver?: string }[] }>()
      .transitions.find((t) => t.status === 'APPLIED');
    expect(appliedInFeed?.approver).toBe('alice@acme.com');
  });

  it('approve with no pending promotion → 409', async () => {
    await provision('orgA');
    const res = await app.inject({
      method: 'POST',
      url: '/agents/ghost/tasks/none/approve',
      headers: internalHeaders(TOKEN, 'orgA', 'alice@acme.com'),
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('Clerk org → Provable org resolve', () => {
  it('resolves a linked Clerk org with the internal token; 401 without it', async () => {
    await provision('orgA');
    await linkClerkOrg('orgA' as OrgId, 'clerk_org_demo');

    const ok = await app.inject({
      method: 'GET',
      url: '/resolve-org?clerkOrgId=clerk_org_demo',
      headers: { 'x-provable-internal-token': TOKEN },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ orgId: string }>().orgId).toBe('orgA');

    const noAuth = await app.inject({ method: 'GET', url: '/resolve-org?clerkOrgId=clerk_org_demo' });
    expect(noAuth.statusCode).toBe(401);
  });
});

function at99(): string {
  return new Date(Date.parse('2026-06-15T00:00:00.000Z') + 99 * 60_000).toISOString();
}
