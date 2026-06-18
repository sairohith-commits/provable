import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { AgentKey, ExternalRef, OrgId, TaskKey } from '@provable/contracts';
import {
  apiKeyRepo,
  decisionRepo,
  disconnect,
  membershipRepo,
  orgRepo,
  resolveOrgByApiKey,
  withTenant,
} from '../src/index.js';
import { createHash } from 'node:crypto';
import { adminClient, appClient, disconnectClients, resetDb } from './helpers.js';

const A = 'org_A' as OrgId;
const B = 'org_B' as OrgId;
const agentKey = 'agent_1' as AgentKey;
const taskKey = 'classify' as TaskKey;

function seed(org: OrgId): Promise<unknown> {
  return withTenant(org, (tx) =>
    decisionRepo.create(tx, {
      orgId: org,
      agentKey,
      taskKey,
      at: '2026-06-15T00:00:00.000Z',
      action: { label: 'opaque' },
      verdict: { kind: 'PENDING' },
      source: 'sdk',
      externalRef: `${org}_ref` as ExternalRef,
    }),
  );
}

beforeEach(resetDb);
afterAll(async () => {
  await disconnectClients();
  await disconnect();
});

describe('Two-tenant RLS isolation (DB-enforced)', () => {
  it('each tenant sees only its own rows; no-context sees nothing; admin sees both', async () => {
    await seed(A);
    await seed(B);

    // Under A's context, only A's rows are visible.
    const aRows = await withTenant(A, (tx) => decisionRepo.list(tx));
    expect(aRows.map((d) => d.orgId)).toEqual([A]);

    // Under B's context, only B's rows are visible.
    const bRows = await withTenant(B, (tx) => decisionRepo.list(tx));
    expect(bRows.map((d) => d.orgId)).toEqual([B]);

    // The DATABASE denies cross-tenant reads: superuser (RLS bypass) sees BOTH rows,
    // proving the data exists and is hidden by RLS — not by the app layer.
    const all = await adminClient.decision.findMany();
    expect(all).toHaveLength(2);

    // A query with NO tenant context returns nothing (current_setting is unset → NULL).
    const noContext = await appClient.decision.findMany();
    expect(noContext).toEqual([]);
  });

  it('isolation holds for agent rows too', async () => {
    await seed(A);
    await seed(B);
    const aAgents = await withTenant(A, (tx) => tx.agent.findMany());
    expect(aAgents.every((r) => r.orgId === A)).toBe(true);
    expect(aAgents).toHaveLength(1);
  });

  it('membership (RBAC) is tenant-isolated like every other table', async () => {
    // Ensure the org rows exist first (membership.orgId FK).
    await withTenant(A, async (tx) => {
      await orgRepo.ensure(tx, A);
      await membershipRepo.invite(tx, A, 'owner@a.test', 'OWNER', 'seed');
    });
    await withTenant(B, async (tx) => {
      await orgRepo.ensure(tx, B);
      await membershipRepo.invite(tx, B, 'owner@b.test', 'OWNER', 'seed');
    });

    // Each tenant sees only its own members.
    const aMembers = await withTenant(A, (tx) => membershipRepo.list(tx, A));
    expect(aMembers.map((m) => m.email)).toEqual(['owner@a.test']);
    const bMembers = await withTenant(B, (tx) => membershipRepo.list(tx, B));
    expect(bMembers.map((m) => m.email)).toEqual(['owner@b.test']);

    // DB-enforced: superuser (RLS bypass) sees BOTH; no-context app query sees nothing.
    expect(await adminClient.membership.findMany()).toHaveLength(2);
    expect(await appClient.membership.findMany()).toEqual([]);
  });

  it('api_key (Phase C1) is tenant-isolated like every other table', async () => {
    await withTenant(A, async (tx) => {
      await orgRepo.ensure(tx, A);
      await apiKeyRepo.mint(tx, A, 'aaaaaa', 'hashA');
    });
    await withTenant(B, async (tx) => {
      await orgRepo.ensure(tx, B);
      await apiKeyRepo.mint(tx, B, 'bbbbbb', 'hashB');
    });

    const aKeys = await withTenant(A, (tx) => apiKeyRepo.listActive(tx, A));
    expect(aKeys.map((k) => k.prefix)).toEqual(['aaaaaa']);

    expect(await adminClient.apiKey.findMany()).toHaveLength(2);
    expect(await appClient.apiKey.findMany()).toEqual([]);
  });

  it('a migrated/minted key resolves to its org via the SECURITY DEFINER lookup; revoked dies', async () => {
    // Mimic the migration outcome: an api_key row carrying the org's prefix + sha256(full key).
    const fullKey = 'pvb_c0ffee_deadbeefdeadbeefdeadbeef';
    const prefix = 'c0ffee';
    const hash = createHash('sha256').update(fullKey).digest('hex');
    await withTenant(A, async (tx) => {
      await orgRepo.ensure(tx, A);
      await apiKeyRepo.mint(tx, A, prefix, hash, 'migrated');
    });

    // resolveOrgByApiKey runs WITHOUT tenant context (SECURITY DEFINER) and returns org A.
    expect(await resolveOrgByApiKey(prefix, hash)).toBe(A);

    // After revoke, the same key resolves to nothing (active-only lookup).
    await withTenant(A, (tx) => apiKeyRepo.revoke(tx, A, prefix));
    expect(await resolveOrgByApiKey(prefix, hash)).toBeNull();
  });
});
