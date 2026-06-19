import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, at, climbToPending, internalHeaders, makeApp, provision, register, resetDb, teardown } from './helpers.js';

// Phase U1 — the fleet governance read-model over HTTP: one status per task, KPI reconciliation,
// the supersede integrity fix (vision-agent), and tenant isolation.
const TOKEN = 'u1-internal-token';
let app: FastifyInstance;

beforeAll(() => {
  process.env['PROVABLE_INTERNAL_TOKEN'] = TOKEN;
  app = makeApp();
});
afterAll(() => teardown(app));
beforeEach(resetDb);

interface FleetView {
  agentKey: string;
  taskKey: string;
  status: string;
  actionAvailable: boolean;
  headroomTo: string | null;
  score: number | null;
}
interface FleetResp {
  tasks: FleetView[];
  kpis: { promotableNow: number; needsAttention: number; tasksGoverned: number };
}

const fleet = (orgId: string) =>
  app.inject({ method: 'GET', url: '/overview/fleet', headers: internalHeaders(TOKEN, orgId) }).then((r) => r.json<FleetResp>());

const find = (f: FleetResp, agentKey: string, taskKey: string) => f.tasks.find((t) => t.agentKey === agentKey && t.taskKey === taskKey)!;

describe('GET /overview/fleet — derived status + actionAvailable', () => {
  it('live-promotable: a clean climb to PENDING_APPROVAL → PROMOTABLE, action=true, headroomTo set', async () => {
    const key = await provision('org_promo');
    await climbToPending(app, key, 'good-bot', 'classify');
    const row = find(await fleet('org_promo'), 'good-bot', 'classify');
    expect(row.status).toBe('PROMOTABLE');
    expect(row.actionAvailable).toBe(true);
    expect(row.headroomTo).not.toBeNull();
    expect(row.score).not.toBeNull();
  });

  it('unscored (registered, no resolved signal) → DEGRADED, action=false', async () => {
    const key = await provision('org_unscored');
    await register(app, key, { agentKey: 'fresh', taskKey: 'classify' });
    const row = find(await fleet('org_unscored'), 'fresh', 'classify');
    expect(row.status).toBe('DEGRADED');
    expect(row.actionAvailable).toBe(false);
    expect(row.score).toBeNull();
  });

  it('THE vision-agent case: a PENDING_APPROVAL then a SIGNAL_LOSS demotion → DEGRADED, action=false, pending SUPPRESSED', async () => {
    const orgId = 'org_vision';
    await provision(orgId);
    // Seed the exact transition log: a live-looking pending, OVERTAKEN by a later signal-loss demotion.
    await admin.agent.create({ data: { orgId, agentKey: 'vision' } });
    await admin.task.create({ data: { orgId, agentKey: 'vision', taskKey: 'caption', effectiveMode: 'SHADOW' } });
    await admin.transition.create({
      data: { orgId, agentKey: 'vision', taskKey: 'caption', fromMode: 'CO_PILOT', toMode: 'SOLO', direction: 'PROMOTION', trigger: 'SCORE_CROSS', status: 'PENDING_APPROVAL', reason: 'awaiting approval', at: new Date(at(1)), createdAt: new Date(at(1)) },
    });
    await admin.transition.create({
      data: { orgId, agentKey: 'vision', taskKey: 'caption', fromMode: 'CO_PILOT', toMode: 'SHADOW', direction: 'DEMOTION', trigger: 'SIGNAL_LOSS', status: 'AUTO_APPLIED', reason: 'signal lost: readiness INSUFFICIENT', at: new Date(at(2)), createdAt: new Date(at(2)) },
    });
    // A SCORED row so DEGRADED comes specifically from the signal-loss latest transition (not unscored).
    await admin.score.create({
      data: { orgId, agentKey: 'vision', taskKey: 'caption', status: 'SCORED', readinessScore: 55, impliedBand: 'CO_PILOT', missing: [], eventCount: 50, resolvedCount: 50, calculatedAt: new Date(at(2)) },
    });

    const row = find(await fleet(orgId), 'vision', 'caption');
    expect(row.status).toBe('DEGRADED'); // NOT PROMOTABLE — the stale pending is suppressed
    expect(row.actionAvailable).toBe(false);
  });
});

describe('KPI reconciliation — counts derive from the same views (cannot diverge)', () => {
  it('promotableNow + needsAttention + tasksGoverned equal the row-derived counts', async () => {
    const key = await provision('org_kpi');
    await climbToPending(app, key, 'promo', 'classify'); // → PROMOTABLE
    await register(app, key, { agentKey: 'idle', taskKey: 'classify' }); // unscored → DEGRADED
    const f = await fleet('org_kpi');
    expect(f.kpis.tasksGoverned).toBe(f.tasks.length);
    expect(f.kpis.promotableNow).toBe(f.tasks.filter((t) => t.status === 'PROMOTABLE').length);
    expect(f.kpis.needsAttention).toBe(f.tasks.filter((t) => t.status === 'DEGRADED' || t.status === 'SUSPENDED').length);
    // sanity on this fixture
    expect(f.kpis.promotableNow).toBe(1);
    expect(f.kpis.needsAttention).toBe(1);
  });
});

describe('tenant isolation', () => {
  it('/overview/fleet for org A never returns org B tasks', async () => {
    const keyA = await provision('org_A');
    await provision('org_B');
    await climbToPending(app, keyA, 'a-agent', 'classify');

    const a = await fleet('org_A');
    expect(a.tasks.some((t) => t.agentKey === 'a-agent')).toBe(true);

    const b = await fleet('org_B');
    expect(b.tasks.some((t) => t.agentKey === 'a-agent')).toBe(false);
    expect(b.tasks).toHaveLength(0);
  });
});
