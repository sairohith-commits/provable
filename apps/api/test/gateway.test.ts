import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, internalHeaders, makeApp, provision, resetDb, teardown } from './helpers.js';

// Phase C2 — gateway proxy round-trip + key hygiene (sentinel) + Observe-only fidelity.
const TOKEN = 'c2-internal-token';
const CANARY = 'sk-CANARY-LEAK-DO-NOT-PERSIST-7777'; // fake upstream key; must never be stored/echoed
const GW_URL = '/gateway/v1/chat/completions';

let app: FastifyInstance;
let upstream: Server;
let lastUpstreamAuth: string | undefined;

// In-process mock upstream: echoes nothing secret, returns OpenAI-shaped usage; ERROR model →
// 429; records the Authorization it received (to prove BYO-key passthrough).
function startUpstream(): Promise<string> {
  upstream = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      lastUpstreamAuth = req.headers['authorization'];
      const body = (() => {
        try {
          return JSON.parse(raw) as { model?: string; stream?: boolean };
        } catch {
          return {};
        }
      })();
      if (body.model === 'ERROR') {
        res.writeHead(429, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'rate limited' } }));
        return;
      }
      if (body.stream === true) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'cmpl-mock-1',
          model: 'gpt-4o-mini',
          usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
          choices: [{ message: { role: 'assistant', content: 'hi' } }],
        }),
      );
    });
  });
  return new Promise((resolve) => {
    upstream.listen(0, '127.0.0.1', () => {
      const { port } = upstream.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

beforeAll(async () => {
  process.env['PROVABLE_INTERNAL_TOKEN'] = TOKEN;
  process.env['PROVABLE_GATEWAY_UPSTREAM'] = await startUpstream();
  app = makeApp();
});
afterAll(async () => {
  await teardown(app);
  await new Promise<void>((r) => upstream.close(() => r()));
});
beforeEach(async () => {
  await resetDb();
  lastUpstreamAuth = undefined;
});

const gw = (key: string | undefined, agent: string | undefined, task: string | undefined, body: object) =>
  app.inject({
    method: 'POST',
    url: GW_URL,
    headers: {
      'content-type': 'application/json',
      ...(key !== undefined ? { 'x-provable-key': key } : {}),
      ...(agent !== undefined ? { 'x-provable-agent': agent } : {}),
      ...(task !== undefined ? { 'x-provable-task': task } : {}),
      authorization: `Bearer ${CANARY}`,
    },
    payload: body,
  });

const chat = { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] };

describe('gateway proxy — functional Observe-only round-trip', () => {
  it('forwards upstream (BYO key passthrough), returns the response, records an Observe-only decision', async () => {
    const key = await provision('org_gw');
    const res = await gw(key, 'gw-agent', 'infer', chat);

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-provable-gateway']).toBe('recorded');
    expect(res.json<{ id: string }>().id).toBe('cmpl-mock-1');
    // The caller's OWN upstream key reached the upstream (proves passthrough).
    expect(lastUpstreamAuth).toBe(`Bearer ${CANARY}`);

    // A gateway decision is recorded: cost (tokens + latency), NO verdict (Observe-only).
    const decisions = await admin.decision.findMany({ where: { orgId: 'org_gw' } });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.source).toBe('gateway');
    expect(decisions[0]!.costTokens).toBe(12);
    expect(decisions[0]!.costLatencyMs).not.toBeNull();
    expect(decisions[0]!.verdictKind).toBe('PENDING'); // no verdict channel
    expect(decisions[0]!.status).toBe('PENDING');

    // The agent self-registered and activated on first contact (C1 path).
    const agent = await admin.agent.findFirst({ where: { orgId: 'org_gw', agentKey: 'gw-agent' } });
    expect(agent?.identityState).toBe('ACTIVE');
  });

  it('surfaces Observe-only fidelity with HONEST N/A readiness (never a fabricated score)', async () => {
    const key = await provision('org_gw2');
    await gw(key, 'gw-agent', 'infer', chat);

    const vis = await app
      .inject({ method: 'GET', url: '/visibility', headers: internalHeaders(TOKEN, 'org_gw2') })
      .then((r) => r.json<{ tasks: { fidelity: string; scoreStatus: string | null; readinessScore: number | null }[]; observeOnlyUpgrade: string }>());

    const task = vis.tasks[0]!;
    expect(task.fidelity).toBe('observe-only');
    expect(task.readinessScore).toBeNull(); // N/A, not 0
    expect(task.scoreStatus).toBe('INSUFFICIENT');
    expect(vis.observeOnlyUpgrade.toLowerCase()).toContain('observe-only');
  });
});

describe('gateway key hygiene (S1 standard) — the BYO upstream key never leaks', () => {
  it('sentinel: the fake key appears in NO decision row and in NO response body', async () => {
    const key = await provision('org_hy');
    const res = await gw(key, 'gw-agent', 'infer', chat);

    // Not in the response returned to the caller.
    expect(res.payload).not.toContain(CANARY);

    // Not anywhere in the persisted decision rows (action/metadata/any column).
    const rows = await admin.decision.findMany({ where: { orgId: 'org_hy' } });
    expect(JSON.stringify(rows)).not.toContain(CANARY);

    // Not on the org/api_key rows either.
    const keys = await admin.apiKey.findMany({ where: { orgId: 'org_hy' } });
    expect(JSON.stringify(keys)).not.toContain(CANARY);
  });

  it('upstream error: passes status through, records NO decision, never leaks the key', async () => {
    const key = await provision('org_err');
    const res = await gw(key, 'gw-agent', 'infer', { ...chat, model: 'ERROR' });

    expect(res.statusCode).toBe(429);
    expect(res.headers['x-provable-gateway']).toBe('upstream-error-not-recorded');
    expect(res.payload).toContain('rate limited'); // upstream body passthrough
    expect(res.payload).not.toContain(CANARY);
    expect(await admin.decision.count({ where: { orgId: 'org_err' } })).toBe(0); // no success-shaped record
  });
});

describe('gateway auth + streaming guards', () => {
  it('blocks a missing/invalid machine key (401) and requires agent/task headers (400)', async () => {
    const key = await provision('org_auth');
    expect((await gw(undefined, 'a', 't', chat)).statusCode).toBe(401);
    expect((await gw('pvb_bogus_nope', 'a', 't', chat)).statusCode).toBe(401);
    expect((await gw(key, undefined, undefined, chat)).statusCode).toBe(400);
    expect(await admin.decision.count({ where: { orgId: 'org_auth' } })).toBe(0);
  });

  it('streaming passes through transparently with NO cost capture (no silent half-work)', async () => {
    const key = await provision('org_stream');
    const res = await gw(key, 'gw-agent', 'infer', { ...chat, stream: true });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-provable-gateway']).toBe('passthrough-streaming-no-capture');
    expect(await admin.decision.count({ where: { orgId: 'org_stream' } })).toBe(0); // not recorded, documented
  });
});
