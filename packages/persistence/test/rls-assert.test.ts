import type { OrgId } from '@provable/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  RlsScopeError,
  assertRlsScopedConnection,
  assignRole,
  checkRlsScopedConnection,
  disconnect,
} from '../src/index.js';
import { adminClient, appClient, disconnectClients, resetDb } from './helpers.js';

// BYOC layer-1 gate: the startup RLS assertion + idempotent bootstrap Owner seed.
afterAll(async () => {
  await disconnectClients();
  await disconnect();
});

describe('assertRlsScopedConnection — refuses an RLS-bypassing runtime connection', () => {
  it('the non-owner app role (provable_app) is RLS-scoped → passes', async () => {
    const status = await checkRlsScopedConnection(appClient);
    expect(status.scoped).toBe(true);
    expect(status.superuser).toBe(false);
    expect(status.bypassRls).toBe(false);
    expect(status.ownsTables).toBe(false);
    await expect(assertRlsScopedConnection(appClient)).resolves.toBeUndefined();
  });

  it('the owner/superuser connection (DIRECT_URL) can bypass RLS → fails loudly', async () => {
    const status = await checkRlsScopedConnection(adminClient);
    expect(status.scoped).toBe(false); // superuser OR table-owner
    await expect(assertRlsScopedConnection(adminClient)).rejects.toBeInstanceOf(RlsScopeError);
  });
});

describe('bootstrap Owner seed is idempotent (resolves the deploy-ordering gate, no lockout)', () => {
  const ORG = 'org_byoc' as OrgId;
  beforeEach(resetDb);

  it('assignRole ensures the org + seeds the Owner; re-running is safe', async () => {
    await assignRole(ORG, 'owner@byoc.test', 'OWNER');
    await assignRole(ORG, 'owner@byoc.test', 'OWNER'); // re-run (bootstrap is re-entrant)

    const org = await adminClient.org.findUnique({ where: { id: ORG } });
    expect(org).not.toBeNull();

    const members = await adminClient.membership.findMany({ where: { orgId: ORG } });
    expect(members).toHaveLength(1); // upsert — no duplicate
    expect(members[0]!.role).toBe('OWNER');
    expect(members[0]!.email).toBe('owner@byoc.test');
  });
});
