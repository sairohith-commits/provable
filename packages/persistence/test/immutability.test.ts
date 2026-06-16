import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { AgentKey, ExternalRef, OrgId, TaskKey } from '@provable/contracts';
import { decisionRepo, disconnect, verdictEventRepo, withTenant } from '../src/index.js';
import { adminClient, disconnectClients, resetDb } from './helpers.js';

const A = 'org_A' as OrgId;
const ref = 'imm_ref' as ExternalRef;

beforeEach(resetDb);
afterAll(async () => {
  await disconnectClients();
  await disconnect();
});

describe('verdict_event immutability (append-only, DB-enforced)', () => {
  beforeEach(async () => {
    await withTenant(A, async (tx) => {
      await decisionRepo.create(tx, {
        orgId: A,
        agentKey: 'agent_1' as AgentKey,
        taskKey: 'classify' as TaskKey,
        at: '2026-06-15T00:00:00.000Z',
        action: { label: 'x' },
        verdict: { kind: 'PENDING' },
        source: 'sdk',
        externalRef: ref,
      });
      await verdictEventRepo.apply(tx, {
        orgId: A,
        source: 'sdk',
        externalRef: ref,
        verdict: { kind: 'ACCEPTED' },
        at: '2026-06-15T01:00:00.000Z',
      });
    });
  });

  it('rejects UPDATE even for the superuser (trigger fires regardless of role)', async () => {
    await expect(
      adminClient.$executeRawUnsafe(`UPDATE "verdict_event" SET "externalRef" = 'tampered'`),
    ).rejects.toThrow(/append-only|immutable/i);
  });

  it('rejects DELETE even for the superuser', async () => {
    await expect(
      adminClient.$executeRawUnsafe(`DELETE FROM "verdict_event"`),
    ).rejects.toThrow(/append-only|immutable/i);
  });

  it('rejects mutation from the app role too', async () => {
    await expect(
      withTenant(A, (tx) => tx.$executeRawUnsafe(`UPDATE "verdict_event" SET "externalRef" = 'y'`)),
    ).rejects.toThrow();
  });

  it('still allows appending a new event (INSERT is permitted)', async () => {
    const count = await withTenant(A, async (tx) => {
      await verdictEventRepo.apply(tx, {
        orgId: A,
        source: 'sdk',
        externalRef: ref,
        outcome: 'SUCCESS',
        at: '2026-06-15T02:00:00.000Z',
      });
      return verdictEventRepo.countForExternalRef(tx, A, ref);
    });
    expect(count).toBe(2);
  });
});
