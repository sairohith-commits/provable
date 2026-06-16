import { afterAll, describe, expect, it } from 'vitest';
import { disconnect } from '../src/index.js';
import { adminClient, disconnectClients } from './helpers.js';

afterAll(async () => {
  await disconnectClients();
  await disconnect();
});

describe('Migrations apply clean on a fresh DB', () => {
  it('all 7 tables exist with RLS enabled AND forced', async () => {
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
      expect(r.relrowsecurity).toBe(true);
      expect(r.relforcerowsecurity).toBe(true);
    }
  });

  it('every table carries a tenant-isolation policy', async () => {
    const rows = await adminClient.$queryRawUnsafe<{ count: bigint }[]>(
      `select count(*)::int as count from pg_policies where schemaname = 'public'`,
    );
    expect(Number(rows[0]?.count)).toBe(7);
  });
});
