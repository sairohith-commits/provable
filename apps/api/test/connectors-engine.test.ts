import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type DeclarativeMapping, applyMapping } from '@provable/adapters';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, at, internalHeaders, makeApp, provision, resetDb, teardown } from './helpers.js';

const O3A_TOKEN = 'o3a-internal-token';

// Phase O3a — Tier-2 connector engine: stored mapping, push + pull ingestion, SSRF guard, idempotency.
const FEED_TOKEN = 'SECRET-FEED-TOKEN-do-not-return'; // pull credential; must never appear in a response

const MAPPING = {
  agentKey: 'agent',
  taskKey: 'task',
  externalRef: 'id',
  confidence: 'conf',
  at: 'ts',
  verdict: { path: 'result', values: { approved: 'ACCEPTED' } },
  outcome: { path: 'res', values: { ok: 'SUCCESS' } },
};

let app: FastifyInstance;
let feed: Server;
let feedBase: string;
let lastFeedAuth: string | undefined;

// Mock pull source on loopback. Returns a STABLE batch (same ids) so re-pull is idempotent.
function startFeed(): Promise<string> {
  feed = createServer((req, res) => {
    lastFeedAuth = req.headers['x-feed-token'] as string | undefined;
    const records = Array.from({ length: 3 }, (_v, i) => ({
      agent: 'pulled-bot',
      task: 'classify',
      id: `pull-${i}`,
      conf: 0.95,
      ts: at(i),
      result: 'approved',
      res: 'ok',
    }));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ records }));
  });
  return new Promise((resolve) => {
    feed.listen(0, '127.0.0.1', () => {
      const { port } = feed.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

const bearer = (key: string) => ({ authorization: `Bearer ${key}`, 'content-type': 'application/json' });

function createConnector(key: string, body: object): Promise<{ statusCode: number; json: <T>() => T; payload: string }> {
  return app.inject({ method: 'POST', url: '/connectors', headers: bearer(key), payload: body });
}
function ingest(key: string, id: string, records: unknown): Promise<{ statusCode: number; json: <T>() => T }> {
  return app.inject({ method: 'POST', url: `/connectors/${id}/ingest`, headers: bearer(key), payload: records as object });
}
function pull(key: string, id: string): Promise<{ statusCode: number; json: <T>() => T }> {
  return app.inject({ method: 'POST', url: `/connectors/${id}/pull`, headers: bearer(key), payload: {} });
}
const fleet = (key: string) =>
  app
    .inject({ method: 'GET', url: '/overview/fleet', headers: bearer(key) })
    .then((r) => r.json<{ tasks: { agentKey: string; status: string; score: number | null }[] }>());

interface Summary { received: number; mapped: number; governed: number; observeOnly: number; errors: unknown[] }

beforeAll(async () => {
  process.env['PROVABLE_INTERNAL_TOKEN'] = 'o3a-internal-token';
  process.env['CONNECTOR_SECRET'] = 'test-connector-secret-key';
  process.env['CONNECTOR_PULL_ALLOW_HOSTS'] = '127.0.0.1'; // let the loopback mock through; all other internal stays blocked
  feedBase = await startFeed();
  app = makeApp();
});
afterAll(async () => {
  await teardown(app);
  await new Promise<void>((r) => feed.close(() => r()));
});
beforeEach(async () => {
  await resetDb();
  lastFeedAuth = undefined;
});

async function newConnector(key: string, source?: object): Promise<string> {
  const res = await createConnector(key, { name: 'c', mapping: MAPPING, ...(source ? { source } : {}) });
  expect(res.statusCode).toBe(200);
  return res.json<{ connector: { id: string } }>().connector.id;
}

describe('PUSH — governed vs observe-only, fleet reflects mapped records', () => {
  it('records WITH verdict+outcome → governed (scored, reaches PROMOTABLE)', async () => {
    const key = await provision('org_push_g');
    const id = await newConnector(key);
    const records = Array.from({ length: 16 }, (_v, i) => ({
      agent: 'climber',
      task: 'triage',
      id: `g-${i}`,
      conf: 0.95,
      ts: at(i),
      result: 'approved',
      res: 'ok',
    }));
    const s = (await ingest(key, id, records)).json<{ } & Summary>();
    expect(s.governed).toBe(16);
    expect(s.observeOnly).toBe(0);
    expect(s.errors).toHaveLength(0);

    const row = (await fleet(key)).tasks.find((t) => t.agentKey === 'climber')!;
    expect(row.score).not.toBeNull(); // governed → scored
    expect(row.status).toBe('PROMOTABLE'); // a clean climb proposes a promotion
  });

  it('records WITHOUT a verdict → observe-only (OBSERVING, score null)', async () => {
    const key = await provision('org_push_o');
    const id = await newConnector(key);
    const records = [
      { agent: 'watcher', task: 'peek', id: 'o-1', conf: 0.8 },
      { agent: 'watcher', task: 'peek', id: 'o-2', conf: 0.8 },
    ];
    const s = (await ingest(key, id, records)).json<Summary>();
    expect(s.observeOnly).toBe(2);
    expect(s.governed).toBe(0);

    const row = (await fleet(key)).tasks.find((t) => t.agentKey === 'watcher')!;
    expect(row.score).toBeNull();
    expect(row.status).toBe('OBSERVING');
  });

  it('arbitrary-shaped records map via field-paths; a bad record is reported, not fatal', async () => {
    const key = await provision('org_push_mix');
    const id = await newConnector(key);
    const s = (
      await ingest(key, id, [
        { agent: 'a', task: 't', id: 'ok-1', result: 'approved', res: 'ok' },
        { agent: 'a', task: 't' }, // missing required externalRef → error, not a crash
      ])
    ).json<Summary>();
    expect(s.received).toBe(2);
    expect(s.mapped).toBe(1);
    expect(s.errors).toHaveLength(1);
  });
});

describe('PULL — fetch + map + ingest, SSRF guard, idempotency, credential hygiene', () => {
  it('pulls from the source URL (decrypted auth header passed through), maps + ingests', async () => {
    const key = await provision('org_pull');
    const id = await newConnector(key, {
      url: `${feedBase}/feed`,
      authHeaderName: 'x-feed-token',
      authHeaderValue: FEED_TOKEN,
    });
    const s = (await pull(key, id)).json<Summary>();
    expect(s.governed).toBe(3);
    expect(lastFeedAuth).toBe(FEED_TOKEN); // credential decrypted + forwarded to the source

    expect((await fleet(key)).tasks.some((t) => t.agentKey === 'pulled-bot')).toBe(true);
  });

  it('SSRF guard rejects loopback/private/link-local/metadata + non-http(s) URLs', async () => {
    const key = await provision('org_ssrf');
    const blocked = [
      'http://169.254.169.254/latest/meta-data/', // cloud metadata
      'http://10.0.0.5/internal',                  // private
      'http://[::1]:9000/x',                       // ipv6 loopback
      'file:///etc/passwd',                        // non-http(s)
    ];
    for (const url of blocked) {
      const id = await newConnector(key, { url });
      const res = await pull(key, id);
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: string }>().error).toBe('blocked pull url');
    }
    expect(await admin.decision.count({ where: { orgId: 'org_ssrf' } })).toBe(0); // nothing ingested
  });

  it('re-pull is idempotent — the same records never double-ingest', async () => {
    const key = await provision('org_idem');
    const id = await newConnector(key, { url: `${feedBase}/feed`, authHeaderName: 'x-feed-token', authHeaderValue: FEED_TOKEN });

    await pull(key, id);
    const afterFirst = await admin.decision.count({ where: { orgId: 'org_idem' } });
    expect(afterFirst).toBe(3);

    await pull(key, id); // identical stable batch
    const afterSecond = await admin.decision.count({ where: { orgId: 'org_idem' } });
    expect(afterSecond).toBe(3); // dedup on externalRef — no doubles
  });

  it('the source credential is NEVER returned (create response, list, or anywhere)', async () => {
    const key = await provision('org_cred');
    const createRes = await createConnector(key, {
      name: 'with-secret',
      mapping: MAPPING,
      source: { url: `${feedBase}/feed`, authHeaderName: 'x-feed-token', authHeaderValue: FEED_TOKEN },
    });
    expect(createRes.statusCode).toBe(200);
    expect(createRes.payload).not.toContain(FEED_TOKEN);
    const created = createRes.json<{ connector: { hasCredential: boolean } }>().connector;
    expect(created.hasCredential).toBe(true);
    expect((created as Record<string, unknown>)['sourceAuthHeaderValueEnc']).toBeUndefined();

    const listRes = await app.inject({ method: 'GET', url: '/connectors', headers: bearer(key) });
    expect(listRes.payload).not.toContain(FEED_TOKEN);

    // And the ciphertext is genuinely not the plaintext (sanity: stored encrypted).
    const row = await admin.connectorConfig.findFirst({ where: { orgId: 'org_cred' } });
    expect(row?.sourceAuthHeaderValueEnc).not.toBeNull();
    expect(row?.sourceAuthHeaderValueEnc).not.toContain(FEED_TOKEN);
  });
});

describe('tenant safety — org comes from the key, never the payload', () => {
  it('unknown connector id → 404; ingestion records only under the key’s org', async () => {
    const key = await provision('org_t1');
    await provision('org_t2');
    expect((await ingest(key, 'no-such-id', [])).statusCode).toBe(404);

    const id = await newConnector(key);
    await ingest(key, id, [{ agent: 'x', task: 'y', id: 't-1', result: 'approved', res: 'ok' }]);
    expect(await admin.decision.count({ where: { orgId: 'org_t1' } })).toBe(1);
    expect(await admin.decision.count({ where: { orgId: 'org_t2' } })).toBe(0);
  });
});

describe('DRY-RUN (Phase O3b) — same engine, no ingestion, governed-vs-observe-only', () => {
  const dryRun = (headers: Record<string, string>, mapping: unknown, sample: unknown) =>
    app.inject({ method: 'POST', url: '/connectors/dry-run', headers, payload: { mapping, sample } });

  it('a record WITH verdict+outcome → governed; the returned event EQUALS applyMapping (no divergent logic)', async () => {
    const key = await provision('org_dry_g');
    const sample = { agent: 'a', task: 't', id: 'd-1', conf: 0.9, ts: at(0), result: 'approved', res: 'ok' };
    const res = await dryRun(bearer(key), MAPPING, sample);
    const body = res.json<{ ok: boolean; governed: boolean; event: unknown }>();
    expect(body.ok).toBe(true);
    expect(body.governed).toBe(true);
    // The dry-run MUST run the real engine — assert byte-for-byte equality with applyMapping.
    expect(body.event).toEqual(applyMapping(MAPPING as DeclarativeMapping, sample));
    // …and it must NOT ingest anything.
    expect(await admin.decision.count({ where: { orgId: 'org_dry_g' } })).toBe(0);
  });

  it('a record WITHOUT a verdict → observe-only (governed false), still no ingestion', async () => {
    const key = await provision('org_dry_o');
    const res = await dryRun(bearer(key), MAPPING, { agent: 'a', task: 't', id: 'd-2' });
    const body = res.json<{ ok: boolean; governed: boolean }>();
    expect(body.ok).toBe(true);
    expect(body.governed).toBe(false);
    expect(await admin.decision.count({ where: { orgId: 'org_dry_o' } })).toBe(0);
  });

  it('an invalid sample (missing externalRef) → ok:false with an error, never a crash', async () => {
    const key = await provision('org_dry_e');
    const res = await dryRun(bearer(key), MAPPING, { agent: 'a', task: 't' });
    expect(res.json<{ ok: boolean; error: string }>().ok).toBe(false);
  });

  it('works over the INTERNAL (dashboard) auth path too — dual auth', async () => {
    const orgId = 'org_dry_internal';
    await provision(orgId); // seeds the Owner subject internalHeaders() forwards by default
    const res = await dryRun(
      internalHeaders(O3A_TOKEN, orgId),
      MAPPING,
      { agent: 'a', task: 't', id: 'd-3', result: 'approved', res: 'ok' },
    );
    expect(res.statusCode).toBe(200);
    expect(res.json<{ governed: boolean }>().governed).toBe(true);
  });
});
