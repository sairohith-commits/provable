import { Role as PrismaRole } from '@prisma/client';
import { ROLES } from '@provable/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  climbToPending,
  internalHeaders,
  makeApp,
  ownerSubject,
  provision,
  resetDb,
  seedMember,
  teardown,
} from './helpers.js';

// Phase B — RBAC enforcement, proven by DIRECT API calls (not the UI). Deny-by-default and
// API-authoritative: the role is re-derived server-side from membership(orgId, subject); a
// web-supplied role is never trusted.
const TOKEN = 'rbac-internal-token';
let app: FastifyInstance;

beforeAll(() => {
  process.env['PROVABLE_INTERNAL_TOKEN'] = TOKEN;
  app = makeApp();
});
afterAll(() => teardown(app));
beforeEach(resetDb);

const read = (orgId: string, subject?: string) =>
  app.inject({ method: 'GET', url: '/agents', headers: internalHeaders(TOKEN, orgId, undefined, subject) });
const rotate = (orgId: string, subject?: string) =>
  app.inject({ method: 'POST', url: '/org/api-key/rotate', headers: internalHeaders(TOKEN, orgId, undefined, subject) });
const members = (orgId: string, subject?: string) =>
  app.inject({ method: 'GET', url: '/org/members', headers: internalHeaders(TOKEN, orgId, undefined, subject) });
const approveReq = (orgId: string, a: string, t: string, subject?: string) =>
  app.inject({
    method: 'POST',
    url: `/agents/${a}/tasks/${t}/approve`,
    headers: internalHeaders(TOKEN, orgId, 'human@x.test', subject),
  });

// Seed the three non-Owner roles with distinct pre-bound subjects.
async function seedRoles(orgId: string): Promise<void> {
  await seedMember(orgId, 'subj-approver', 'approver@x.test', 'APPROVER');
  await seedMember(orgId, 'subj-operator', 'operator@x.test', 'OPERATOR');
  await seedMember(orgId, 'subj-viewer', 'viewer@x.test', 'VIEWER');
}

describe('RBAC enforcement (server-side, direct API calls)', () => {
  it('reads require ANY assigned role; unassigned + machine-key behavior preserved', async () => {
    const key = await provision('org_read');
    await seedRoles('org_read');

    // Every assigned role can read.
    expect((await read('org_read', ownerSubject('org_read'))).statusCode).toBe(200);
    expect((await read('org_read', 'subj-approver')).statusCode).toBe(200);
    expect((await read('org_read', 'subj-operator')).statusCode).toBe(200);
    expect((await read('org_read', 'subj-viewer')).statusCode).toBe(200);

    // Unassigned internal caller is denied (deny-by-default).
    expect((await read('org_read', 'ghost')).statusCode).toBe(403);

    // Machine-key reads are UNCHANGED (agents-only, no RBAC) — still 200.
    const mk = await app.inject({ method: 'GET', url: '/agents', headers: { authorization: `Bearer ${key}` } });
    expect(mk.statusCode).toBe(200);
  });

  it('manage_keys (rotate) is OWNER-only', async () => {
    const key = await provision('org_keys');
    await seedRoles('org_keys');

    expect((await rotate('org_keys', ownerSubject('org_keys'))).statusCode).toBe(200);
    expect((await rotate('org_keys', 'subj-approver')).statusCode).toBe(403);
    expect((await rotate('org_keys', 'subj-operator')).statusCode).toBe(403);
    expect((await rotate('org_keys', 'subj-viewer')).statusCode).toBe(403);
    expect((await rotate('org_keys', 'ghost')).statusCode).toBe(403);

    // A MACHINE KEY cannot rotate — no internal context → 401 (governance stays blocked).
    const mk = await app.inject({
      method: 'POST',
      url: '/org/api-key/rotate',
      headers: { authorization: `Bearer ${key}` },
    });
    expect(mk.statusCode).toBe(401);
  });

  it('manage_people (members list) is OWNER-only', async () => {
    await provision('org_people');
    await seedRoles('org_people');
    expect((await members('org_people', ownerSubject('org_people'))).statusCode).toBe(200);
    expect((await members('org_people', 'subj-approver')).statusCode).toBe(403);
    expect((await members('org_people', 'subj-operator')).statusCode).toBe(403);
    expect((await members('org_people', 'subj-viewer')).statusCode).toBe(403);
  });

  it('approve_transition: OPERATOR/VIEWER denied (403) regardless of a pending', async () => {
    await provision('org_appdeny');
    await seedRoles('org_appdeny');
    // Permission is checked before anything else, so no pending is needed to prove denial.
    expect((await approveReq('org_appdeny', 'a1', 't1', 'subj-operator')).statusCode).toBe(403);
    expect((await approveReq('org_appdeny', 'a1', 't1', 'subj-viewer')).statusCode).toBe(403);
    // Unassigned + machine-key are denied too.
    expect((await approveReq('org_appdeny', 'a1', 't1', 'ghost')).statusCode).toBe(403);
  });

  it('approve_transition: OWNER and APPROVER may approve a real pending promotion', async () => {
    const key = await provision('org_appok');
    await seedRoles('org_appok');

    // APPROVER approves a freshly-climbed pending.
    await climbToPending(app, key, 'agentP', 'classify');
    const byApprover = await approveReq('org_appok', 'agentP', 'classify', 'subj-approver');
    expect(byApprover.statusCode).toBe(200);

    // OWNER approves a second freshly-climbed pending.
    await climbToPending(app, key, 'agentQ', 'classify');
    const byOwner = await approveReq('org_appok', 'agentQ', 'classify', ownerSubject('org_appok'));
    expect(byOwner.statusCode).toBe(200);

    // A MACHINE KEY cannot approve — no internal context → 401.
    const mk = await app.inject({
      method: 'POST',
      url: '/agents/agentP/tasks/classify/approve',
      headers: { authorization: `Bearer ${key}` },
    });
    expect(mk.statusCode).toBe(401);
  });

  it('first-Owner bootstrap: provisioned org has a working Owner via /me', async () => {
    await provision('org_boot');
    const me = await app.inject({
      method: 'GET',
      url: '/me',
      headers: internalHeaders(TOKEN, 'org_boot', undefined, ownerSubject('org_boot')),
    });
    expect(me.statusCode).toBe(200);
    expect(me.json<{ role: string | null }>().role).toBe('OWNER');
  });

  it('/me binds a pending invite ONLY on a provider-verified email', async () => {
    await provision('org_bind');
    // Owner invites a VIEWER by email (subject not yet bound).
    const invite = await app.inject({
      method: 'POST',
      url: '/org/members',
      headers: internalHeaders(TOKEN, 'org_bind', undefined, ownerSubject('org_bind')),
      payload: { email: 'newbie@x.test', role: 'VIEWER' },
    });
    expect(invite.statusCode).toBe(200);

    const meHeaders = (verified: boolean) => ({
      'x-provable-internal-token': TOKEN,
      'x-provable-org-id': 'org_bind',
      'x-provable-subject': 'subj-newbie',
      'x-provable-email': 'newbie@x.test',
      'x-provable-email-verified': verified ? 'true' : 'false',
    });

    // Unverified email must NOT bind the invite.
    const unverified = await app.inject({ method: 'GET', url: '/me', headers: meHeaders(false) });
    expect(unverified.json<{ role: string | null }>().role).toBeNull();

    // Verified email binds → VIEWER.
    const verified = await app.inject({ method: 'GET', url: '/me', headers: meHeaders(true) });
    expect(verified.json<{ role: string | null }>().role).toBe('VIEWER');
  });

  it('last-Owner guard: cannot demote or remove the final Owner', async () => {
    await provision('org_last');
    const ownerEmail = 'owner@org_last.test';
    // Demote the only owner → 409.
    const demote = await app.inject({
      method: 'PATCH',
      url: `/org/members/${encodeURIComponent(ownerEmail)}`,
      headers: internalHeaders(TOKEN, 'org_last', undefined, ownerSubject('org_last')),
      payload: { role: 'VIEWER' },
    });
    expect(demote.statusCode).toBe(409);
    // Remove the only owner → 409.
    const remove = await app.inject({
      method: 'DELETE',
      url: `/org/members/${encodeURIComponent(ownerEmail)}`,
      headers: internalHeaders(TOKEN, 'org_last', undefined, ownerSubject('org_last')),
    });
    expect(remove.statusCode).toBe(409);

    // With a SECOND owner present, demoting the first is allowed.
    await seedMember('org_last', 'subj-owner2', 'owner2@org_last.test', 'OWNER');
    const ok = await app.inject({
      method: 'PATCH',
      url: `/org/members/${encodeURIComponent(ownerEmail)}`,
      headers: internalHeaders(TOKEN, 'org_last', undefined, ownerSubject('org_last')),
      payload: { role: 'APPROVER' },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('Prisma Role enum mirrors @provable/contracts ROLES (lockstep)', () => {
    expect(Object.values(PrismaRole).sort()).toEqual([...ROLES].sort());
  });
});
