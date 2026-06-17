import { afterAll, describe, expect, it } from 'vitest';
import { disconnect } from '../src/index.js';
import { adminClient, disconnectClients } from './helpers.js';

afterAll(async () => {
  await disconnectClients();
  await disconnect();
});

describe('Migrations apply clean on a fresh DB', () => {
  it('all 7 tables have RLS ENABLED (Neon-compat: not FORCEd — owner bypass needed for SECURITY DEFINER auth)', async () => {
    // FORCE was relaxed to ENABLE in 20260618000000_neon_compat_no_force_rls so the cross-tenant
    // SECURITY DEFINER auth lookups work on a host with no superuser (Neon): there the table owner
    // is a normal role, and under FORCE it would be RLS-scoped and break auth. The app role
    // `provable_app` is a NON-owner with no BYPASSRLS, so RLS still fully isolates it under ENABLE
    // (proven in rls-isolation.test). FORCE only mattered for an owner-connection the app never makes.
    const rows = await adminClient.$queryRawUnsafe<
      { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >(
      `select relname, relrowsecurity, relforcerowsecurity
         from pg_class
        where relname in ('org','agent','task','decision','verdict_event','transition','score')
          and relkind = 'r'
        order by relname`,
    );
    expect(rows).toHaveLength(7);
    for (const r of rows) {
      expect(r.relrowsecurity).toBe(true); // RLS enabled
      expect(r.relforcerowsecurity).toBe(false); // NOT forced (owner bypass; app role stays scoped)
    }
  });

  it('every table carries a tenant-isolation policy', async () => {
    const rows = await adminClient.$queryRawUnsafe<{ count: bigint }[]>(
      `select count(*)::int as count from pg_policies where schemaname = 'public'`,
    );
    expect(Number(rows[0]?.count)).toBe(7);
  });
});
