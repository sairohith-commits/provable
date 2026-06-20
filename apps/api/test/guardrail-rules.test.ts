import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  at,
  internalHeaders,
  makeApp,
  ownerSubject,
  provision,
  resetDb,
  seedMember,
  teardown,
  track,
} from './helpers.js';

// Phase W4 — platform-enforced guardrails. Provable evaluates org rules at ingestion and trips the
// guardrail itself; the agent-reported path is untouched. Proven by DIRECT API calls.
const TOKEN = 'w4-internal-token';
let app: FastifyInstance;

beforeAll(() => {
  process.env['PROVABLE_INTERNAL_TOKEN'] = TOKEN;
  app = makeApp();
});
afterAll(() => teardown(app));
beforeEach(resetDb);

const H = (orgId: string, subject?: string) => internalHeaders(TOKEN, orgId, undefined, subject);

const createRule = (orgId: string, body: object, subject?: string) =>
  app.inject({ method: 'POST', url: '/admin/guardrail-rules', headers: H(orgId, subject), payload: body });
const listRules = (orgId: string, subject?: string) =>
  app.inject({ method: 'GET', url: '/admin/guardrail-rules', headers: H(orgId, subject) });

const decision = (agentKey: string, taskKey: string, ref: string, over: Record<string, unknown> = {}) => ({
  type: 'decision',
  agentKey,
  taskKey,
  at: at(1),
  action: {},
  verdict: { kind: 'ACCEPTED' },
  outcome: 'SUCCESS',
  confidence: 0.9,
  source: 'sdk',
  externalRef: ref,
  ...over,
});

describe('W4 — platform rule evaluation at ingestion', () => {
  it('a decision violating a rule → Provable trips → SUSPENDED, transition platform-detected (actor=policy)', async () => {
    const key = await provision('org_w4a');
    await createRule('org_w4a', {
      agentKey: 'bot',
      taskKey: 'auto_resolve_sensitive',
      verdict: 'ACCEPTED',
      guardrailId: 'complaint_auto_resolve',
      reasonTemplate: 'auto-resolved a complaint that must escalate',
    });

    const res = (
      await track(app, key, decision('bot', 'auto_resolve_sensitive', 'bot:ars:1'))
    ).json<{ effectiveMode: string; transitions: { trigger: string; status: string; toMode: string; actor?: string; reason: string }[] }>();

    expect(res.effectiveMode).toBe('SUSPENDED');
    const trip = res.transitions.find((t) => t.trigger === 'GUARDRAIL');
    expect(trip).toBeDefined();
    expect(trip?.status).toBe('AUTO_APPLIED');
    expect(trip?.toMode).toBe('SUSPENDED');
    expect(trip?.actor).toBe('policy'); // platform-detected, NOT agent-reported
    expect(trip?.reason).toContain('complaint_auto_resolve');
  });

  it('a non-violating decision → no trip (verdict does not match the rule)', async () => {
    const key = await provision('org_w4b');
    await createRule('org_w4b', {
      taskKey: 'auto_resolve_sensitive',
      verdict: 'ACCEPTED',
      guardrailId: 'g',
      reasonTemplate: 'r',
    });
    // ESCALATED ≠ the rule's ACCEPTED condition → no trip.
    const res = (
      await track(app, key, decision('bot', 'auto_resolve_sensitive', 'bot:ars:1', { verdict: { kind: 'ESCALATED' }, outcome: undefined }))
    ).json<{ effectiveMode: string; transitions: { trigger: string }[] }>();
    expect(res.effectiveMode).not.toBe('SUSPENDED');
    expect(res.transitions.some((t) => t.trigger === 'GUARDRAIL')).toBe(false);
  });

  it('the AGENT-REPORTED guardrail path still works (no rule; trip carries no actor)', async () => {
    const key = await provision('org_w4c');
    const res = (
      await track(
        app,
        key,
        decision('bot', 'classify', 'bot:c:1', {
          signals: { guardrail: { guardrailId: 'agent_side', reason: 'pii' } },
        }),
      )
    ).json<{ effectiveMode: string; transitions: { trigger: string; actor?: string }[] }>();
    expect(res.effectiveMode).toBe('SUSPENDED');
    const trip = res.transitions.find((t) => t.trigger === 'GUARDRAIL');
    expect(trip?.actor).toBeUndefined(); // agent-reported → no platform actor
  });

  it('rules are tenant-isolated — a rule in org A does NOT trip a decision in org B', async () => {
    const keyA = await provision('org_w4d');
    const keyB = await provision('org_w4e');
    await createRule('org_w4d', { verdict: 'ACCEPTED', guardrailId: 'gA', reasonTemplate: 'rA' });

    // Same shape decision in org B (which has no rule) must NOT suspend.
    const resB = (
      await track(app, keyB, decision('bot', 'classify', 'bot:c:1'))
    ).json<{ effectiveMode: string; transitions: { trigger: string }[] }>();
    expect(resB.transitions.some((t) => t.trigger === 'GUARDRAIL')).toBe(false);
    expect(resB.effectiveMode).not.toBe('SUSPENDED');

    // Org A with the rule DOES suspend — confirms the rule exists and is scoped to A.
    const resA = (
      await track(app, keyA, decision('bot', 'classify', 'bot:c:1'))
    ).json<{ effectiveMode: string }>();
    expect(resA.effectiveMode).toBe('SUSPENDED');
  });

  it('re-ingesting the same decision does NOT double-trip (idempotent)', async () => {
    const key = await provision('org_w4f');
    await createRule('org_w4f', { verdict: 'ACCEPTED', guardrailId: 'g', reasonTemplate: 'r' });
    const d = decision('bot', 'classify', 'bot:c:1');
    const first = (await track(app, key, d)).json<{ transitions: { trigger: string }[] }>();
    expect(first.transitions.some((t) => t.trigger === 'GUARDRAIL')).toBe(true);
    // Replay: same externalRef → not novel → no new transition.
    const replay = (await track(app, key, d)).json<{ transitions: unknown[] }>();
    expect(replay.transitions).toHaveLength(0);
  });
});

describe('W4 — rule admin is role-gated + tenant-safe', () => {
  it('configure_guardrails required: OWNER may create, VIEWER may not', async () => {
    await provision('org_w4g');
    await seedMember('org_w4g', 'subj-viewer', 'viewer@x.test', 'VIEWER');
    expect(
      (await createRule('org_w4g', { verdict: 'ACCEPTED', guardrailId: 'g', reasonTemplate: 'r' }, ownerSubject('org_w4g'))).statusCode,
    ).toBe(200);
    expect(
      (await createRule('org_w4g', { verdict: 'ACCEPTED', guardrailId: 'g2', reasonTemplate: 'r' }, 'subj-viewer')).statusCode,
    ).toBe(403);
  });

  it('rejects a rule with no verdict/outcome condition (never "match everything")', async () => {
    await provision('org_w4h');
    expect((await createRule('org_w4h', { guardrailId: 'g', reasonTemplate: 'r' })).statusCode).toBe(400);
  });

  it('list returns only the caller-org rules', async () => {
    await provision('org_w4i');
    await provision('org_w4j');
    await createRule('org_w4i', { verdict: 'ACCEPTED', guardrailId: 'only-i', reasonTemplate: 'r' });
    const i = (await listRules('org_w4i')).json<{ rules: { guardrailId: string }[] }>();
    const j = (await listRules('org_w4j')).json<{ rules: { guardrailId: string }[] }>();
    expect(i.rules.map((r) => r.guardrailId)).toEqual(['only-i']);
    expect(j.rules).toHaveLength(0);
  });
});
