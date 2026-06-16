import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { AgentKey, ExternalRef, OrgId, Outcome, Source, TaskKey, Verdict } from '@provable/contracts';
import { decisionRepo, disconnect, verdictEventRepo, withTenant } from '../src/index.js';
import { disconnectClients, resetDb } from './helpers.js';

const A = 'org_A' as OrgId;
const ref = 'mat_ref' as ExternalRef;

beforeEach(resetDb);
afterAll(async () => {
  await disconnectClients();
  await disconnect();
});

describe('Verdict event idempotency + decision materialization', () => {
  it('flips PENDING → resolved, and a replayed event is a single effect', async () => {
    // A PENDING decision.
    const created = await withTenant(A, (tx) =>
      decisionRepo.create(tx, {
        orgId: A,
        agentKey: 'agent_1' as AgentKey,
        taskKey: 'classify' as TaskKey,
        at: '2026-06-15T00:00:00.000Z',
        action: { label: 'x' },
        verdict: { kind: 'PENDING' },
        source: 'sdk',
        externalRef: ref,
      }),
    );
    expect(created.verdict.kind).toBe('PENDING');

    const event = {
      orgId: A,
      source: 'sdk' as Source,
      externalRef: ref,
      verdict: { kind: 'ACCEPTED' } as Verdict,
      outcome: 'SUCCESS' as Outcome,
      at: '2026-06-15T01:00:00.000Z',
    };

    // Apply the SAME event twice.
    await withTenant(A, (tx) => verdictEventRepo.apply(tx, event));
    const afterSecond = await withTenant(A, (tx) => verdictEventRepo.apply(tx, event));

    // Materialization: decision is now resolved as ACCEPTED / SUCCESS.
    expect(afterSecond?.verdict.kind).toBe('ACCEPTED');
    expect(afterSecond?.outcome).toBe('SUCCESS');

    // Idempotency: only ONE log row despite two applications.
    const count = await withTenant(A, (tx) => verdictEventRepo.countForExternalRef(tx, A, ref));
    expect(count).toBe(1);

    // Re-reading the decision confirms the persisted materialized state.
    const reread = await withTenant(A, (tx) => decisionRepo.findByExternalRef(tx, A, ref));
    expect(reread?.verdict.kind).toBe('ACCEPTED');
    expect(reread?.outcome).toBe('SUCCESS');
  });

  it('a later distinct event (different at) appends and re-materializes', async () => {
    await withTenant(A, (tx) =>
      decisionRepo.create(tx, {
        orgId: A,
        agentKey: 'agent_1' as AgentKey,
        taskKey: 'classify' as TaskKey,
        at: '2026-06-15T00:00:00.000Z',
        action: { label: 'x' },
        verdict: { kind: 'PENDING' },
        source: 'sdk',
        externalRef: ref,
      }),
    );
    await withTenant(A, (tx) =>
      verdictEventRepo.apply(tx, {
        orgId: A,
        source: 'sdk',
        externalRef: ref,
        verdict: { kind: 'ESCALATED' },
        at: '2026-06-15T01:00:00.000Z',
      }),
    );
    await withTenant(A, (tx) =>
      verdictEventRepo.apply(tx, {
        orgId: A,
        source: 'sdk',
        externalRef: ref,
        outcome: 'PARTIAL',
        at: '2026-06-15T02:00:00.000Z',
      }),
    );
    const count = await withTenant(A, (tx) => verdictEventRepo.countForExternalRef(tx, A, ref));
    expect(count).toBe(2);
    const reread = await withTenant(A, (tx) => decisionRepo.findByExternalRef(tx, A, ref));
    expect(reread?.verdict.kind).toBe('ESCALATED'); // from event 1
    expect(reread?.outcome).toBe('PARTIAL'); // from event 2
  });
});
