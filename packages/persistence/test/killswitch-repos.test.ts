import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { AgentKey, OrgId, TaskKey } from '@provable/contracts';
import { agentRepo, disconnect, orgRepo, taskRepo, withTenant } from '../src/index.js';
import { disconnectClients, resetDb } from './helpers.js';

const A = 'org_A' as OrgId;
const B = 'org_B' as OrgId;
const AGENT_1 = 'agent_1' as AgentKey;
const AGENT_2 = 'agent_2' as AgentKey;

beforeEach(resetDb);
afterAll(async () => {
  await disconnectClients();
  await disconnect();
});

describe('Phase 1 kill-switch persistence (taskRepo.listForAgent + agent suspend marker)', () => {
  it('listForAgent returns ONLY the target agent’s tasks within the org (excludes other agents AND other orgs)', async () => {
    // org A: agent_1 has two tasks; agent_2 has one. org B: agent_1 has a task (must NOT leak into A).
    await withTenant(A, async (tx) => {
      await orgRepo.ensure(tx, A);
      await agentRepo.ensure(tx, A, AGENT_1);
      await agentRepo.ensure(tx, A, AGENT_2);
      await taskRepo.ensure(tx, A, AGENT_1, 'classify' as TaskKey);
      await taskRepo.ensure(tx, A, AGENT_1, 'summarize' as TaskKey);
      await taskRepo.ensure(tx, A, AGENT_2, 'route' as TaskKey);
    });
    await withTenant(B, async (tx) => {
      await orgRepo.ensure(tx, B);
      await agentRepo.ensure(tx, B, AGENT_1);
      await taskRepo.ensure(tx, B, AGENT_1, 'classify' as TaskKey);
    });

    const tasks = await withTenant(A, (tx) => taskRepo.listForAgent(tx, A, AGENT_1));
    expect(tasks.map((t) => t.taskKey).sort()).toEqual(['classify', 'summarize']);
    // every row is the target agent — no agent_2 ('route'), no cross-org bleed.
    expect(tasks.every((t) => t.agentKey === AGENT_1)).toBe(true);
    expect(tasks.some((t) => t.taskKey === 'route')).toBe(false);
  });

  it('set/clear suspend marker round-trips on (orgId, agentKey)', async () => {
    await withTenant(A, async (tx) => {
      await orgRepo.ensure(tx, A);
      await agentRepo.ensure(tx, A, AGENT_1);
    });

    const before = await withTenant(A, (tx) => agentRepo.find(tx, A, AGENT_1));
    expect(before?.suspendedAt).toBeNull();
    expect(before?.suspendedBy).toBeNull();

    const at = '2026-06-22T12:00:00.000Z';
    await withTenant(A, (tx) => agentRepo.setSuspended(tx, A, AGENT_1, { at, by: 'alice@corp.test' }));

    const suspended = await withTenant(A, (tx) => agentRepo.find(tx, A, AGENT_1));
    expect(suspended?.suspendedAt).toBe(at);
    expect(suspended?.suspendedBy).toBe('alice@corp.test');

    await withTenant(A, (tx) => agentRepo.clearSuspended(tx, A, AGENT_1));

    const cleared = await withTenant(A, (tx) => agentRepo.find(tx, A, AGENT_1));
    expect(cleared?.suspendedAt).toBeNull();
    expect(cleared?.suspendedBy).toBeNull();
  });
});
