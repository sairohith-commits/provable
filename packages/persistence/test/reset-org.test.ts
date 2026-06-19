import { createHash } from 'node:crypto';
import type { AgentKey, OrgId, TaskKey } from '@provable/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  apiKeyRepo,
  disconnect,
  inspectOrg,
  membershipRepo,
  orgRepo,
  resetOrgData,
  withTenant,
} from '../src/index.js';
import { adminClient, disconnectClients, resetDb } from './helpers.js';

const A = 'org_reset_A' as OrgId;
const B = 'org_reset_B' as OrgId;
const agentKey = 'support-agent' as AgentKey;
const taskKey = 'triage' as TaskKey;
const DIRECT_URL = process.env['DIRECT_URL'] ?? '';

// Seed ONE org with a full agent/governance footprint plus the kept rows (membership + api key).
async function seedOrg(org: OrgId): Promise<void> {
  await withTenant(org, async (tx) => {
    await orgRepo.ensure(tx, org, `${org} name`);
    await apiKeyRepo.mint(tx, org, `${org}_pfx`, createHash('sha256').update(org).digest('hex'), 'seed');
    await membershipRepo.invite(tx, org, `owner@${org}.test`, 'OWNER', 'seed');

    await tx.agent.create({ data: { orgId: org, agentKey, identityState: 'ACTIVE' } });
    await tx.task.create({ data: { orgId: org, agentKey, taskKey, effectiveMode: 'SHADOW' } });
    await tx.decision.create({
      data: {
        orgId: org,
        agentKey,
        taskKey,
        at: new Date('2026-06-15T00:00:00.000Z'),
        action: { label: 'opaque' },
        verdictKind: 'ACCEPTED',
        outcome: 'SUCCESS',
        source: 'sdk',
        externalRef: `${org}_ref_1`,
      },
    });
    await tx.verdictEvent.create({
      data: {
        orgId: org,
        source: 'sdk',
        externalRef: `${org}_ref_1`,
        verdictKind: 'ACCEPTED',
        outcome: 'SUCCESS',
        at: new Date('2026-06-15T00:00:01.000Z'),
      },
    });
    await tx.transition.create({
      data: {
        orgId: org,
        agentKey,
        taskKey,
        fromMode: 'OBSERVING',
        toMode: 'SHADOW',
        direction: 'PROMOTION',
        trigger: 'SCORE_CROSS',
        status: 'AUTO_APPLIED',
        reason: 'seed transition',
        at: new Date('2026-06-15T00:00:02.000Z'),
      },
    });
    await tx.score.create({
      data: {
        orgId: org,
        agentKey,
        taskKey,
        status: 'SCORED',
        readinessScore: 72,
        missing: [],
        eventCount: 10,
        resolvedCount: 10,
        calculatedAt: new Date('2026-06-15T00:00:03.000Z'),
      },
    });
  });
}

// Count one org's agent/governance footprint via the superuser (cross-tenant visibility).
async function footprint(org: OrgId) {
  const [agents, tasks, decisions, transitions, scores, verdictEvents, memberships, apiKeys, org_] =
    await Promise.all([
      adminClient.agent.count({ where: { orgId: org } }),
      adminClient.task.count({ where: { orgId: org } }),
      adminClient.decision.count({ where: { orgId: org } }),
      adminClient.transition.count({ where: { orgId: org } }),
      adminClient.score.count({ where: { orgId: org } }),
      adminClient.verdictEvent.count({ where: { orgId: org } }),
      adminClient.membership.count({ where: { orgId: org } }),
      adminClient.apiKey.count({ where: { orgId: org } }),
      adminClient.org.findUnique({ where: { id: org } }),
    ]);
  return { agents, tasks, decisions, transitions, scores, verdictEvents, memberships, apiKeys, exists: org_ !== null };
}

beforeEach(resetDb);
afterAll(async () => {
  await disconnectClients();
  await disconnect();
});

describe('resetOrgData — single-org hard reset (Phase O1)', () => {
  it('removes target org agent data, keeps its org/memberships/keys, leaves the other org untouched', async () => {
    await seedOrg(A);
    await seedOrg(B);

    const bBefore = await footprint(B);

    const report = await resetOrgData(DIRECT_URL, A);
    expect(report.deleted).toBe(true);
    expect(report.deletable).toEqual({ agents: 1, tasks: 1, decisions: 1, transitions: 1, scores: 1 });

    // Target org: every deletable governance table is empty.
    const aAfter = await footprint(A);
    expect(aAfter.agents).toBe(0);
    expect(aAfter.tasks).toBe(0);
    expect(aAfter.decisions).toBe(0);
    expect(aAfter.transitions).toBe(0);
    expect(aAfter.scores).toBe(0);

    // Target org: the org row, memberships, and api keys are KEPT (re-onboard works immediately).
    expect(aAfter.exists).toBe(true);
    expect(aAfter.memberships).toBe(1);
    expect(aAfter.apiKeys).toBe(1);

    // verdict_event is append-only/immutable → RETAINED and reported, never deleted.
    expect(aAfter.verdictEvents).toBe(1);
    expect(report.retained.verdictEvents).toBe(1);

    // The OTHER org is completely untouched — every count identical to before.
    expect(await footprint(B)).toEqual(bBefore);
  });

  it('is idempotent — a second reset deletes nothing and still succeeds', async () => {
    await seedOrg(A);
    await resetOrgData(DIRECT_URL, A);
    const second = await resetOrgData(DIRECT_URL, A);
    expect(second.deleted).toBe(true);
    expect(second.deletable).toEqual({ agents: 0, tasks: 0, decisions: 0, transitions: 0, scores: 0 });
  });

  it('refuses to run against an org id it cannot find', async () => {
    await expect(resetOrgData(DIRECT_URL, 'org_does_not_exist' as OrgId)).rejects.toThrow(/not found/);
  });

  it('refuses an empty org id', async () => {
    await expect(resetOrgData(DIRECT_URL, '' as OrgId)).rejects.toThrow(/empty/);
  });
});

describe('inspectOrg — dry run', () => {
  it('reports counts without deleting anything', async () => {
    await seedOrg(A);
    const report = await inspectOrg(DIRECT_URL, A);
    expect(report.exists).toBe(true);
    expect(report.deleted).toBe(false);
    expect(report.deletable).toEqual({ agents: 1, tasks: 1, decisions: 1, transitions: 1, scores: 1 });
    expect(report.retained.verdictEvents).toBe(1);
    expect(report.kept).toEqual({ memberships: 1, apiKeys: 1 });

    // Nothing was deleted — the footprint is intact.
    const after = await footprint(A);
    expect(after.agents).toBe(1);
    expect(after.decisions).toBe(1);
  });

  it('reports exists=false for an unknown org (never throws)', async () => {
    const report = await inspectOrg(DIRECT_URL, 'org_unknown' as OrgId);
    expect(report.exists).toBe(false);
    expect(report.deletable).toEqual({ agents: 0, tasks: 0, decisions: 0, transitions: 0, scores: 0 });
  });
});
