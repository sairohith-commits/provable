import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { OrgId } from '@provable/contracts';
import { apiKeyRepo, withTenant } from '@provable/persistence';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateApiKey } from '../src/index.js';
import { admin, makeApp, provision, resetDb, teardown } from './helpers.js';

// Phase O2 — transparent Anthropic /v1/messages proxy: byte-exact passthrough (non-stream + SSE),
// observe-only ingestion with real USD, identity from the URL key, and BYO-key hygiene (sentinel).
const CANARY = 'sk-ant-CANARY-LEAK-DO-NOT-PERSIST-7777'; // fake Anthropic key; must never be stored/echoed

// Deterministic upstream bytes (the proxy must return these UNCHANGED).
const NONSTREAM_BODY = JSON.stringify({
  id: 'msg_ns_1',
  type: 'message',
  model: 'claude-sonnet-4-6',
  content: [{ type: 'text', text: 'hi' }],
  usage: { input_tokens: 25, output_tokens: 40 },
});
const SSE_BODY =
  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_st_1","model":"claude-sonnet-4-6","usage":{"input_tokens":30,"output_tokens":1}}}\n\n' +
  'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}\n\n' +
  'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":55}}\n\n' +
  'event: message_stop\ndata: {"type":"message_stop"}\n\n';

let app: FastifyInstance;
let upstream: Server;
let lastApiKey: string | undefined;

function startUpstream(): Promise<string> {
  upstream = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      lastApiKey = req.headers['x-api-key'] as string | undefined;
      const body = (() => {
        try {
          return JSON.parse(raw) as { model?: string; stream?: boolean };
        } catch {
          return {};
        }
      })();
      if (body.model === 'ERROR') {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'bad model' } }));
        return;
      }
      if (body.stream === true) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(SSE_BODY);
        return;
      }
      // Non-streaming: echo the requested model (so we can drive known/unknown pricing).
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        body.model !== undefined && body.model !== 'claude-sonnet-4-6'
          ? JSON.stringify({ id: 'msg_unknown', type: 'message', model: body.model, usage: { input_tokens: 10, output_tokens: 20 } })
          : NONSTREAM_BODY,
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

/** Mint a per-agent GATEWAY key for an org (Phase O2), returning the raw plaintext. */
async function mintGw(orgId: string, agentKey: string, taskKey: string): Promise<string> {
  const k = generateApiKey();
  await withTenant(orgId as OrgId, (tx) =>
    apiKeyRepo.mintGateway(tx, orgId as OrgId, agentKey, taskKey, k.prefix, k.hash, 'gw'),
  );
  return k.key;
}

const messages = (model = 'claude-sonnet-4-6', stream = false) => ({
  model,
  max_tokens: 256,
  ...(stream ? { stream: true } : {}),
  messages: [{ role: 'user', content: 'hi' }],
});

function gw(key: string, body: object): Promise<{ statusCode: number; payload: string; headers: Record<string, unknown> }> {
  return app.inject({
    method: 'POST',
    url: `/gw/${key}/v1/messages`,
    headers: { 'content-type': 'application/json', 'x-api-key': CANARY, 'anthropic-version': '2023-06-01' },
    payload: body,
  });
}

async function waitForDecision(orgId: string, n = 1, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if ((await admin.decision.count({ where: { orgId } })) >= n) return;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${n} decision(s) in ${orgId}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeAll(async () => {
  process.env['PROVABLE_INTERNAL_TOKEN'] = 'o2-internal-token';
  process.env['PROVABLE_ANTHROPIC_BASE'] = await startUpstream();
  app = makeApp();
});
afterAll(async () => {
  await teardown(app);
  await new Promise<void>((r) => upstream.close(() => r()));
});
beforeEach(async () => {
  await resetDb();
  lastApiKey = undefined;
});

describe('non-streaming proxy — byte-exact passthrough + observe-only USD capture', () => {
  it('returns Anthropic bytes unchanged, forwards x-api-key, records cost with REAL usd', async () => {
    await provision('org_ns');
    const key = await mintGw('org_ns', 'gw-agent', 'chat');

    const res = await gw(key, messages());
    expect(res.statusCode).toBe(200);
    expect(res.payload).toBe(NONSTREAM_BODY); // bytes UNCHANGED
    expect(res.headers['x-provable-gateway']).toBe('recorded');
    expect(lastApiKey).toBe(CANARY); // BYO key reached upstream (passthrough)

    const d = (await admin.decision.findMany({ where: { orgId: 'org_ns' } }))[0]!;
    expect(d.source).toBe('gateway');
    expect(d.agentKey).toBe('gw-agent'); // identity from the URL key, not the request
    expect(d.taskKey).toBe('chat');
    expect(d.costTokens).toBe(65); // 25 + 40
    // usd = (25/1e6)*3 + (40/1e6)*15
    expect(d.costUsd).toBeCloseTo(0.000075 + 0.0006, 10);
    expect(d.costLatencyMs).not.toBeNull();
    expect(d.verdictKind).toBe('PENDING'); // observe-only: no verdict channel
  });

  it('unknown model → tokens captured but USD null (honest, never guessed)', async () => {
    await provision('org_unk');
    const key = await mintGw('org_unk', 'gw-agent', 'chat');
    const res = await gw(key, messages('some-unknown-model'));
    expect(res.statusCode).toBe(200);

    const d = (await admin.decision.findMany({ where: { orgId: 'org_unk' } }))[0]!;
    expect(d.costTokens).toBe(30); // 10 + 20
    expect(d.costUsd).toBeNull(); // unknown model price → null cost
  });
});

describe('streaming proxy — real-time SSE passthrough + teed usage capture', () => {
  it('streams Anthropic SSE bytes unchanged AND captures input+output tokens with usd', async () => {
    await provision('org_st');
    const key = await mintGw('org_st', 'gw-agent', 'chat');

    const res = await gw(key, messages('claude-sonnet-4-6', true));
    expect(res.statusCode).toBe(200);
    expect(res.payload).toBe(SSE_BODY); // SSE bytes UNCHANGED
    expect(res.headers['x-provable-gateway']).toBe('streaming');

    // Recording is async (after the stream ends) — poll for it.
    await waitForDecision('org_st');
    const d = (await admin.decision.findMany({ where: { orgId: 'org_st' } }))[0]!;
    expect(d.costTokens).toBe(85); // input 30 + cumulative output 55
    expect(d.costUsd).toBeCloseTo((30 / 1e6) * 3 + (55 / 1e6) * 15, 10);
    expect(d.verdictKind).toBe('PENDING'); // still observe-only
  });
});

describe('identity — the URL gateway key resolves org+agent; wrong kind/unknown rejected', () => {
  it('an unknown gateway key is 401 and records nothing', async () => {
    await provision('org_id');
    const res = await gw('pvb_bogus_deadbeef', messages());
    expect(res.statusCode).toBe(401);
    expect(await admin.decision.count({ where: { orgId: 'org_id' } })).toBe(0);
  });

  it('an SDK machine key cannot act as a gateway key (kind isolation) → 401', async () => {
    const sdkKey = await provision('org_kind');
    const res = await gw(sdkKey, messages());
    expect(res.statusCode).toBe(401);
  });
});

describe('observe-only cap — a gateway agent has null readiness and is NOT promotable', () => {
  it('readinessScore is null and status is never PROMOTABLE', async () => {
    const sdkKey = await provision('org_cap');
    const key = await mintGw('org_cap', 'gw-agent', 'chat');
    await gw(key, messages());

    const fleet = await app
      .inject({ method: 'GET', url: '/overview/fleet', headers: { authorization: `Bearer ${sdkKey}` } })
      .then((r) => r.json<{ tasks: { agentKey: string; status: string; score: number | null }[] }>());

    const task = fleet.tasks.find((t) => t.agentKey === 'gw-agent')!;
    expect(task.score).toBeNull(); // N/A, never fabricated
    expect(task.status).toBe('OBSERVING'); // observe-only → OBSERVING (Phase O2)
    expect(task.status).not.toBe('PROMOTABLE'); // locked cap: no verdicts ⇒ not promotable
    expect(task.status).not.toBe('DEGRADED'); // and NOT the alert-queue status
  });
});

describe('BYO-key hygiene (S1) — the Anthropic key never leaks', () => {
  it('upstream error passes through unchanged, records nothing, never echoes the key', async () => {
    await provision('org_e');
    const key = await mintGw('org_e', 'gw-agent', 'chat');
    const res = await gw(key, messages('ERROR'));

    expect(res.statusCode).toBe(400);
    expect(res.headers['x-provable-gateway']).toBe('upstream-error-not-recorded');
    expect(res.payload).toContain('bad model'); // upstream error body passthrough
    expect(res.payload).not.toContain(CANARY);
    expect(await admin.decision.count({ where: { orgId: 'org_e' } })).toBe(0);
  });

  it('sentinel: the fake key appears in NO decision row, NO api_key row, NO response', async () => {
    await provision('org_hy');
    const key = await mintGw('org_hy', 'gw-agent', 'chat');
    const res = await gw(key, messages());

    expect(res.payload).not.toContain(CANARY);
    const decisions = await admin.decision.findMany({ where: { orgId: 'org_hy' } });
    expect(JSON.stringify(decisions)).not.toContain(CANARY);
    const keys = await admin.apiKey.findMany({ where: { orgId: 'org_hy' } });
    expect(JSON.stringify(keys)).not.toContain(CANARY);
  });
});
