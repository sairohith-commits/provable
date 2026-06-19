import { type DeclarativeMapping, type MappedEvent, applyMapping, parseMapping } from '@provable/adapters';
import { connectorConfigRepo, withTenant } from '@provable/persistence';
import type { OrgId } from '@provable/contracts';
import type { FastifyInstance } from 'fastify';
import { authenticate, extractKey } from './auth.js';
import { decryptSecret, encryptSecret, encryptionAvailable } from './crypto.js';
import { recompute } from './recompute.js';
import type { TrackBody } from './schemas.js';
import { SsrfError, assertPullUrlAllowed } from './ssrf.js';

/**
 * Tier-2 connector ENGINE (Phase O3a) — stored per-org declarative mappings with PUSH and (manual)
 * PULL ingestion. The mapping/anti-corruption lives in @provable/adapters; this composition root
 * authenticates the org (machine key), stamps the tenant, runs the shared map→ingest→govern
 * pipeline, and guards the pull fetch against SSRF. The org always comes from the key, never the
 * payload — a record that names another org/agent cannot leak across tenants.
 */

interface IngestSummary {
  received: number;
  mapped: number;
  governed: number; // records WITH a verdict → scored/governable
  observeOnly: number; // records WITHOUT a verdict → OBSERVING
  errors: { index: number; message: string }[];
}

/** MappedEvent → the existing recompute wire shape (orgId passed separately, never from payload). */
function toTrackBody(e: MappedEvent): TrackBody {
  if (e.type === 'verdict') {
    return {
      type: 'verdict',
      source: e.source,
      externalRef: e.externalRef,
      ...(e.verdict !== undefined ? { verdict: e.verdict } : {}),
      ...(e.outcome !== undefined ? { outcome: e.outcome } : {}),
      ...(e.at !== undefined ? { at: e.at } : {}),
    };
  }
  return {
    type: 'decision',
    agentKey: e.agentKey,
    taskKey: e.taskKey,
    action: e.action,
    source: e.source,
    externalRef: e.externalRef,
    ...(e.at !== undefined ? { at: e.at } : {}),
    ...(e.confidence !== undefined ? { confidence: e.confidence } : {}),
    ...(e.cost !== undefined ? { cost: e.cost } : {}),
    ...(e.verdict !== undefined ? { verdict: e.verdict } : {}),
    ...(e.outcome !== undefined ? { outcome: e.outcome } : {}),
    ...(e.metadata !== undefined ? { metadata: e.metadata } : {}),
  };
}

/** The shared pipeline: map each raw record, ingest via the canonical recompute path, tally. */
async function ingestRecords(
  orgId: OrgId,
  mapping: DeclarativeMapping,
  records: unknown[],
): Promise<IngestSummary> {
  const summary: IngestSummary = { received: records.length, mapped: 0, governed: 0, observeOnly: 0, errors: [] };
  for (let i = 0; i < records.length; i += 1) {
    let ev: MappedEvent;
    try {
      ev = applyMapping(mapping, records[i]); // anti-corruption: validate + map (no orgId)
    } catch (err) {
      summary.errors.push({ index: i, message: (err as Error).message });
      continue;
    }
    const governed = ev.type === 'decision' && ev.verdict !== undefined;
    try {
      const res = await recompute(orgId, toTrackBody(ev)); // idempotent on externalRef
      if ('notFound' in res) {
        summary.errors.push({ index: i, message: 'decision not found for verdict event' });
        continue;
      }
    } catch (err) {
      summary.errors.push({ index: i, message: (err as Error).message });
      continue;
    }
    summary.mapped += 1;
    if (governed) summary.governed += 1;
    else summary.observeOnly += 1;
  }
  return summary;
}

/** Pull responses vary; accept a bare array or a common envelope ({records|data|items: [...]}). */
function extractRecords(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body !== null && typeof body === 'object') {
    for (const k of ['records', 'data', 'items'] as const) {
      const v = (body as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

export function registerConnectorEngine(app: FastifyInstance): void {
  // Create a stored connector config. The source credential (if any) is encrypted; the response
  // NEVER includes it (the public row carries only `hasCredential`).
  app.post('/connectors', async (req, reply) => {
    const orgId = await authenticate(extractKey(req.headers as Record<string, unknown>));
    if (orgId === null) return reply.code(401).send({ error: 'unauthorized' });

    const body = (req.body ?? {}) as {
      name?: string;
      mapping?: unknown;
      source?: { url?: string; authHeaderName?: string; authHeaderValue?: string };
    };
    if (typeof body.name !== 'string' || body.name.length === 0) {
      return reply.code(400).send({ error: 'name is required' });
    }
    let mapping: DeclarativeMapping;
    try {
      mapping = parseMapping(body.mapping);
    } catch (err) {
      return reply.code(400).send({ error: 'invalid mapping', detail: (err as Error).message });
    }

    const create: Parameters<typeof connectorConfigRepo.create>[2] = { name: body.name, mapping };
    if (body.source?.url !== undefined) create.sourceUrl = body.source.url;
    if (body.source?.authHeaderName !== undefined) create.sourceAuthHeaderName = body.source.authHeaderName;
    if (body.source?.authHeaderValue !== undefined && body.source.authHeaderValue.length > 0) {
      if (!encryptionAvailable()) {
        return reply.code(400).send({ error: 'CONNECTOR_SECRET not configured — cannot store a credential' });
      }
      create.sourceAuthHeaderValueEnc = encryptSecret(body.source.authHeaderValue);
    }

    const row = await withTenant(orgId, (tx) => connectorConfigRepo.create(tx, orgId, create));
    return reply.send({ connector: row }); // row has no credential, only hasCredential
  });

  app.get('/connectors', async (req, reply) => {
    const orgId = await authenticate(extractKey(req.headers as Record<string, unknown>));
    if (orgId === null) return reply.code(401).send({ error: 'unauthorized' });
    const rows = await withTenant(orgId, (tx) => connectorConfigRepo.list(tx, orgId));
    return reply.send({ connectors: rows });
  });

  // PUSH: arbitrary-shaped records → map → ingest → govern.
  app.post('/connectors/:id/ingest', async (req, reply) => {
    const orgId = await authenticate(extractKey(req.headers as Record<string, unknown>));
    if (orgId === null) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params as { id: string };

    const cfg = await withTenant(orgId, (tx) => connectorConfigRepo.getById(tx, orgId, id));
    if (cfg === null) return reply.code(404).send({ error: 'unknown connector' });
    if (!cfg.enabled) return reply.code(409).send({ error: 'connector is disabled' });

    let mapping: DeclarativeMapping;
    try {
      mapping = parseMapping(cfg.mapping);
    } catch (err) {
      return reply.code(500).send({ error: 'stored mapping is invalid', detail: (err as Error).message });
    }
    const records = Array.isArray(req.body) ? (req.body as unknown[]) : [req.body];
    const summary = await ingestRecords(orgId, mapping, records);
    return reply.send({ ok: true, connector: id, ...summary });
  });

  // PULL (manual trigger only — no scheduler): fetch a batch from source.url and run the pipeline.
  app.post('/connectors/:id/pull', async (req, reply) => {
    const orgId = await authenticate(extractKey(req.headers as Record<string, unknown>));
    if (orgId === null) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params as { id: string };

    const src = await withTenant(orgId, (tx) => connectorConfigRepo.getSourceSecret(tx, orgId, id));
    if (src === null) return reply.code(404).send({ error: 'unknown connector' });
    if (!src.enabled) return reply.code(409).send({ error: 'connector is disabled' });
    if (src.sourceUrl === null || src.sourceUrl.length === 0) {
      return reply.code(400).send({ error: 'connector has no pull source configured' });
    }

    // SSRF guard — reject loopback/private/link-local/metadata + non-http(s).
    try {
      await assertPullUrlAllowed(src.sourceUrl);
    } catch (err) {
      if (err instanceof SsrfError) return reply.code(400).send({ error: 'blocked pull url', detail: err.message });
      throw err;
    }

    let mapping: DeclarativeMapping;
    try {
      mapping = parseMapping(src.mapping);
    } catch (err) {
      return reply.code(500).send({ error: 'stored mapping is invalid', detail: (err as Error).message });
    }

    const headers: Record<string, string> = { accept: 'application/json' };
    if (src.sourceAuthHeaderName !== null && src.sourceAuthHeaderValueEnc !== null) {
      headers[src.sourceAuthHeaderName] = decryptSecret(src.sourceAuthHeaderValueEnc); // decrypt at fetch time
    }

    let upstream: Response;
    try {
      upstream = await fetch(src.sourceUrl, { method: 'GET', headers });
    } catch {
      return reply.code(502).send({ error: 'pull source fetch failed' });
    }
    if (!upstream.ok) return reply.code(502).send({ error: 'pull source returned an error', status: upstream.status });

    let payload: unknown;
    try {
      payload = await upstream.json();
    } catch {
      return reply.code(502).send({ error: 'pull source returned non-JSON' });
    }

    const records = extractRecords(payload);
    // Idempotent: ingestion dedups on externalRef (createIfAbsent), so re-pulling never doubles.
    const summary = await ingestRecords(orgId, mapping, records);
    return reply.send({ ok: true, connector: id, ...summary });
  });
}
