import {
  DEFAULT_EVENT_MAPPING,
  type Connector,
  type MappedEvent,
  eventsConnector,
  genericConnector,
} from '@provable/adapters';
import type { FastifyInstance } from 'fastify';
import { authenticate, extractKey } from './auth.js';
import { recompute } from './recompute.js';
import type { TrackBody } from './schemas.js';

/**
 * Phase C3 — the connector data path (Tier 2). Machine-key auth (→ orgId), like /track and the
 * gateway. The reference connector validates + maps the agent's existing structured events to
 * canonical Decisions; the composition root stamps the AUTHENTICATED orgId and ingests via the
 * existing recompute path. The mapping output carries no tenant, so a payload that names another
 * org cannot leak — orgId always comes from the machine key.
 *
 * Mapping is code-default + optional CONNECTOR_MAPPING (JSON) override — composition-root config.
 */
function loadConnector(): Connector {
  const raw = process.env['CONNECTOR_MAPPING'];
  if (raw === undefined || raw.length === 0) return eventsConnector;
  try {
    return genericConnector('events', { ...DEFAULT_EVENT_MAPPING, ...(JSON.parse(raw) as object) });
  } catch {
    return eventsConnector; // malformed override → default (do not crash ingestion)
  }
}

/** Convert a canonical mapped event → the existing recompute wire shape (orgId is passed separately). */
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

export function registerConnector(app: FastifyInstance): void {
  const connector = loadConnector();

  app.post('/connector/:connectorId', async (req, reply) => {
    const orgId = await authenticate(extractKey(req.headers as Record<string, unknown>));
    if (orgId === null) return reply.code(401).send({ error: 'unauthorized' });

    const { connectorId } = req.params as { connectorId: string };
    if (connectorId !== connector.id) return reply.code(404).send({ error: 'unknown connector' });

    // Validate + map (anti-corruption). A missing externalRef / required field rejects here.
    let events: MappedEvent[];
    try {
      events = connector.map(req.body);
    } catch (err) {
      return reply.code(400).send({ error: 'invalid connector payload', detail: (err as Error).message });
    }

    // Ingest via the EXISTING canonical path; orgId is the machine-key org, never the payload's.
    let ingested = 0;
    for (const e of events) {
      const result = await recompute(orgId, toTrackBody(e));
      if (!('notFound' in result)) ingested += 1;
    }
    return reply.send({ ok: true, connector: connector.id, received: events.length, ingested });
  });
}
