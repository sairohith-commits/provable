import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  at,
  internalHeaders,
  makeApp,
  ownerSubject,
  provision,
  resetDb,
  seedMember,
  teardown,
  track,
} from './helpers.js';

// Phase C1 — admin agent management, proven by DIRECT API calls. Identity machine + keys only;
// permission-gated exactly like Phase B; machine keys blocked from every management route.
const TOKEN = 'c1-internal-token';
let app: FastifyInstance;

beforeAll(() => {
  process.env['PROVABLE_INTERNAL_TOKEN'] = TOKEN;
  app = makeApp();
});
afterAll(() => teardown(app));
beforeEach(resetDb);

async function seedRoles(orgId: string): Promise<void> {
  await seedMember(orgId, 'subj-approver', 'approver@x.test', 'APPROVER');
  await seedMember(orgId, 'subj-operator', 'operator@x.test', 'OPERATOR');
  await seedMember(orgId, 'subj-viewer', 'viewer@x.test', 'VIEWER');
}

const H = (orgId: string, subject?: string) => internalHeaders(TOKEN, orgId, undefined, subject);
const post = (orgId: string, url: string, subject?: string, body?: object) =>
  app.inject({ method: 'POST', url, headers: H(orgId, subject), ...(body ? { payload: body } : {}) });

const listAgents = async (orgId: string, subject?: string) =>
  (await app.inject({ method: 'GET', url: '/admin/agents', headers: H(orgId, subject) })).json<{
    agents: { agentKey: string; identityState: string; displayStatus: string }[];
  }>();

const statusOf = async (orgId: string, agentKey: string): Promise<string | undefined> =>
  (await listAgents(orgId)).agents.find((a) => a.agentKey === agentKey)?.displayStatus;

const decision = (agentKey: string, ref: string) => ({
  type: 'decision',
  agentKey,
  taskKey: 'classify',
  at: at(1),
  action: {},
  verdict: { kind: 'ACCEPTED' },
  outcome: 'SUCCESS',
  confidence: 0.9,
  source: 'sdk',
  externalRef: ref,
});

describe('C1 permission enforcement (server-side, direct calls)', () => {
  it('provision/rename/retire = manage_agents (OWNER only)', async () => {
    await provision('org_ma');
    await seedRoles('org_ma');
    const owner = ownerSubject('org_ma');

    expect((await post('org_ma', '/admin/agents', owner, { agentKey: 'a1' })).statusCode).toBe(200);
    for (const subj of ['subj-approver', 'subj-operator', 'subj-viewer', 'ghost']) {
      expect((await post('org_ma', '/admin/agents', subj, { agentKey: `x-${subj}` })).statusCode).toBe(403);
    }
    // rename + retire also OWNER-only.
    expect(
      (await app.inject({ method: 'PATCH', url: '/admin/agents/a1', headers: H('org_ma', 'subj-viewer'), payload: { displayName: 'X' } })).statusCode,
    ).toBe(403);
    expect((await post('org_ma', '/admin/agents/a1/retire', 'subj-operator')).statusCode).toBe(403);
  });

  it('deactivate/reactivate = activate_deactivate (OWNER/APPROVER/OPERATOR; VIEWER denied)', async () => {
    const key = await provision('org_ad');
    await seedRoles('org_ad');
    await post('org_ad', '/admin/agents', ownerSubject('org_ad'), { agentKey: 'a1' });
    await track(app, key, decision('a1', 'd1')); // → ACTIVE

    expect((await post('org_ad', '/admin/agents/a1/deactivate', 'subj-operator')).statusCode).toBe(200);
    expect((await post('org_ad', '/admin/agents/a1/reactivate', 'subj-approver')).statusCode).toBe(200);
    expect((await post('org_ad', '/admin/agents/a1/deactivate', 'subj-viewer')).statusCode).toBe(403);
  });

  it('key mint/rotate/revoke = manage_keys (OWNER only)', async () => {
    await provision('org_mk');
    await seedRoles('org_mk');
    expect((await post('org_mk', '/admin/keys', ownerSubject('org_mk'))).statusCode).toBe(200);
    for (const subj of ['subj-approver', 'subj-operator', 'subj-viewer']) {
      expect((await post('org_mk', '/admin/keys', subj)).statusCode).toBe(403);
    }
  });

  it('machine keys are blocked from every management route (401)', async () => {
    const key = await provision('org_mach');
    const mk = (url: string, method: 'POST' | 'GET' = 'POST') =>
      app.inject({ method, url, headers: { authorization: `Bearer ${key}` } });
    expect((await mk('/admin/agents')).statusCode).toBe(401);
    expect((await mk('/admin/agents', 'GET')).statusCode).toBe(401);
    expect((await mk('/admin/agents/a1/deactivate')).statusCode).toBe(401);
    expect((await mk('/admin/keys')).statusCode).toBe(401);
  });
});

describe('C1 identity-state machine (no autonomy touch)', () => {
  it('provision → DISCOVERED → (first track) ACTIVE → deactivate DORMANT → reactivate ACTIVE', async () => {
    const key = await provision('org_life');
    const owner = ownerSubject('org_life');

    const prov = await post('org_life', '/admin/agents', owner, { agentKey: 'a1' });
    expect(prov.json<{ identityState: string }>().identityState).toBe('DISCOVERED');
    expect(await statusOf('org_life', 'a1')).toBe('DISCOVERED');

    await track(app, key, decision('a1', 'd1'));
    expect(await statusOf('org_life', 'a1')).toBe('ACTIVE');

    expect((await post('org_life', '/admin/agents/a1/deactivate', owner)).json<{ identityState: string }>().identityState).toBe('DORMANT');
    expect(await statusOf('org_life', 'a1')).toBe('DEACTIVATED');

    expect((await post('org_life', '/admin/agents/a1/reactivate', owner)).json<{ identityState: string }>().identityState).toBe('ACTIVE');
    expect(await statusOf('org_life', 'a1')).toBe('ACTIVE');
  });

  it('retire → RETIRED is terminal (further transitions are no-ops)', async () => {
    const key = await provision('org_ret');
    const owner = ownerSubject('org_ret');
    await post('org_ret', '/admin/agents', owner, { agentKey: 'a1' });
    await track(app, key, decision('a1', 'd1'));

    expect((await post('org_ret', '/admin/agents/a1/retire', owner)).json<{ identityState: string }>().identityState).toBe('RETIRED');
    expect(await statusOf('org_ret', 'a1')).toBe('RETIRED');
    // Terminal: deactivate/reactivate cannot move it.
    expect((await post('org_ret', '/admin/agents/a1/reactivate', owner)).json<{ identityState: string }>().identityState).toBe('RETIRED');
    expect(await statusOf('org_ret', 'a1')).toBe('RETIRED');
  });

  it('admin-DORMANT agent keeps recording decisions and does NOT auto-revive', async () => {
    const key = await provision('org_dorm');
    const owner = ownerSubject('org_dorm');
    await post('org_dorm', '/admin/agents', owner, { agentKey: 'a1' });
    await track(app, key, decision('a1', 'd1')); // ACTIVE
    await post('org_dorm', '/admin/agents/a1/deactivate', owner); // → DORMANT

    // More telemetry arrives — recorded (200), but state stays DEACTIVATED (no auto-revive).
    const more = await track(app, key, decision('a1', 'd2'));
    expect(more.statusCode).toBe(200);
    expect(await statusOf('org_dorm', 'a1')).toBe('DEACTIVATED');
  });
});

describe('C1 pre-provision + self-register coexist', () => {
  it('pre-provisioned agent activates on first call; un-provisioned self-registers', async () => {
    const key = await provision('org_co');
    const owner = ownerSubject('org_co');

    // Pre-provisioned: exists as DISCOVERED, first call activates the SAME row.
    await post('org_co', '/admin/agents', owner, { agentKey: 'pre' });
    await track(app, key, decision('pre', 'p1'));
    expect(await statusOf('org_co', 'pre')).toBe('ACTIVE');

    // Un-provisioned: first call self-registers + activates.
    await track(app, key, decision('self', 's1'));
    expect(await statusOf('org_co', 'self')).toBe('ACTIVE');

    // Double-provision is a conflict.
    expect((await post('org_co', '/admin/agents', owner, { agentKey: 'pre' })).statusCode).toBe(409);
  });
});

describe('C1 key lifecycle (mint / rotate / revoke) on the multi-key table', () => {
  it('mint adds a usable key; revoke kills it immediately; rotate swaps old→new', async () => {
    const original = await provision('org_keys2');
    const owner = ownerSubject('org_keys2');

    // The provisioned key works on /track.
    expect((await track(app, original, decision('a', 'k1'))).statusCode).toBe(200);

    // Mint a second key — also works (multi-key).
    const minted = (await post('org_keys2', '/admin/keys', owner)).json<{ key: string; prefix: string }>();
    expect((await track(app, minted.key, decision('a', 'k2'))).statusCode).toBe(200);

    // Revoke the minted key → immediate 401 on its next call; the original still works.
    expect((await app.inject({ method: 'DELETE', url: `/admin/keys/${minted.prefix}`, headers: H('org_keys2', owner) })).statusCode).toBe(200);
    expect((await track(app, minted.key, decision('a', 'k3'))).statusCode).toBe(401);
    expect((await track(app, original, decision('a', 'k4'))).statusCode).toBe(200);

    // Rotate the original → new key works, old key dies.
    const rotated = (await post('org_keys2', `/admin/keys/${original.match(/^pvb_([0-9a-f]+)_/)?.[1]}/rotate`, owner)).json<{ key: string }>();
    expect((await track(app, rotated.key, decision('a', 'k5'))).statusCode).toBe(200);
    expect((await track(app, original, decision('a', 'k6'))).statusCode).toBe(401);
  });
});
