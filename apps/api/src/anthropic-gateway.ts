import { Readable, Transform } from 'node:stream';
import { ANTHROPIC_GW_PREFIX } from '@provable/contracts';
import {
  ANTHROPIC_BASE_URL,
  ANTHROPIC_MESSAGES_PATH,
  EMPTY_GATEWAY_USAGE,
  type GatewayUsage,
  type MappedDecision,
  mapAnthropicGatewayDecision,
  parseMessagesUsage,
  reduceSseUsage,
} from '@provable/adapters';
import type { FastifyInstance } from 'fastify';
import { authenticateGateway } from './auth.js';
import { recompute } from './recompute.js';
import type { TrackBody } from './schemas.js';

/**
 * Phase O2 — the Tier-1 Anthropic /v1/messages proxy. TRANSPARENT: the agent repoints its
 * Anthropic base URL to `${api}${ANTHROPIC_GW_PREFIX}/<gateway-key>` and keeps using its OWN
 * Anthropic key. The per-agent gateway key in the PATH identifies org + agent + task; the caller's
 * x-api-key is forwarded upstream and otherwise NEVER stored, logged, recorded, or echoed.
 *
 * One /v1/messages call = one OBSERVE-ONLY decision (no verdict/outcome → readiness stays N/A;
 * the locked cap: governance needs verdicts). Usage + real USD come from the Anthropic adapter
 * (the only place that knows the vendor's wire shapes + price table).
 *
 * Streaming (stream:true → SSE) is proxied in REAL TIME (agents depend on token latency): bytes
 * pass through a Transform UNCHANGED while usage is teed out of a copy; the observe-only decision
 * is recorded after the stream ends. Non-streaming reads usage from the response body.
 */

function anthropicBase(): string {
  // Test/self-host override; defaults to the real Anthropic API.
  return process.env['PROVABLE_ANTHROPIC_BASE'] ?? ANTHROPIC_BASE_URL;
}

/** MappedDecision → the existing recompute wire shape (orgId is passed separately, never here). */
function toTrackBody(e: MappedDecision): TrackBody {
  return {
    type: 'decision',
    agentKey: e.agentKey,
    taskKey: e.taskKey,
    action: e.action,
    source: e.source,
    externalRef: e.externalRef,
    ...(e.cost !== undefined ? { cost: e.cost } : {}),
    ...(e.metadata !== undefined ? { metadata: e.metadata } : {}),
  };
}

export function registerAnthropicGateway(app: FastifyInstance): void {
  app.post(`${ANTHROPIC_GW_PREFIX}/:gatewayKey/v1/messages`, async (req, reply) => {
    const { gatewayKey } = req.params as { gatewayKey: string };

    // Identity from the URL key → org + agent + task. Unknown/disabled/non-gateway → 401, no echo.
    const resolved = await authenticateGateway(gatewayKey);
    if (resolved === null) return reply.code(401).send({ error: 'unauthorized' });
    const { orgId, agentKey, taskKey } = resolved;

    const headers = req.headers as Record<string, unknown>;
    const body = req.body as { model?: string; stream?: boolean } | undefined;

    // Forward ONLY the caller's Anthropic auth + version headers. The Provable path key is never
    // forwarded; the x-api-key is forwarded upstream and otherwise NEVER persisted or logged.
    const fwd: Record<string, string> = { 'content-type': 'application/json' };
    for (const h of ['x-api-key', 'anthropic-version', 'anthropic-beta', 'authorization']) {
      const v = headers[h];
      if (typeof v === 'string' && v.length > 0) fwd[h] = v;
    }

    const startedAt = Date.now();
    let upstream: Response;
    try {
      upstream = await fetch(`${anthropicBase()}${ANTHROPIC_MESSAGES_PATH}`, {
        method: 'POST',
        headers: fwd,
        body: JSON.stringify(req.body ?? {}),
      });
    } catch {
      return reply.code(502).send({ error: 'upstream request failed' });
    }

    const ct = upstream.headers.get('content-type') ?? 'application/json';

    // Upstream error: pass the status + the UPSTREAM body through UNCHANGED; record nothing.
    if (!upstream.ok) {
      const text = await upstream.text();
      reply.header('x-provable-gateway', 'upstream-error-not-recorded');
      reply.code(upstream.status);
      reply.header('content-type', ct);
      return reply.send(text);
    }

    const recordObserveOnly = async (usage: GatewayUsage, latencyMs: number): Promise<void> => {
      const externalRef = usage.id ?? `gw:anthropic:${agentKey}:${startedAt}`;
      const decision = mapAnthropicGatewayDecision({ agentKey, taskKey, usage, latencyMs, externalRef });
      try {
        await recompute(orgId, toTrackBody(decision));
      } catch {
        // The LLM call already succeeded — a recording failure must never fail the caller.
      }
    };

    // ── STREAMING: real-time passthrough + usage tee (no buffering of the body) ──
    if (body?.stream === true) {
      const upstreamBody = upstream.body;
      reply.code(200);
      reply.header('content-type', ct);
      reply.header('x-provable-gateway', 'streaming');
      if (upstreamBody === null) {
        void recordObserveOnly(EMPTY_GATEWAY_USAGE, Date.now() - startedAt);
        return reply.send('');
      }

      let usage: GatewayUsage = EMPTY_GATEWAY_USAGE;
      let buf = '';
      const tee = new Transform({
        transform(chunk, _enc, cb) {
          // Parse a COPY for usage; never mutate the bytes flowing to the caller.
          buf += chunk.toString('utf8');
          let sep: number;
          // SSE events are separated by a blank line ("\n\n").
          while ((sep = buf.indexOf('\n\n')) !== -1) {
            const rawEvent = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            for (const line of rawEvent.split('\n')) {
              if (!line.startsWith('data:')) continue;
              const data = line.slice('data:'.length).trim();
              if (data.length === 0 || data === '[DONE]') continue;
              try {
                usage = reduceSseUsage(usage, JSON.parse(data));
              } catch {
                // ignore a non-JSON data line (keep streaming)
              }
            }
          }
          cb(null, chunk); // pass the original bytes through UNCHANGED
        },
      });

      const src = Readable.fromWeb(upstreamBody as never);
      src.on('error', () => tee.destroy());
      tee.on('end', () => {
        void recordObserveOnly(usage, Date.now() - startedAt);
      });
      src.pipe(tee);
      return reply.send(tee);
    }

    // ── NON-STREAMING: read usage from the response body, return it verbatim ──
    const text = await upstream.text();
    const latencyMs = Date.now() - startedAt;
    reply.code(200);
    reply.header('content-type', ct);

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Non-JSON 200 — return as-is; can't trust usage parsing, so record nothing.
      reply.header('x-provable-gateway', 'recorded-no-usage');
      return reply.send(text);
    }

    await recordObserveOnly(parseMessagesUsage(parsed), latencyMs);
    reply.header('x-provable-gateway', 'recorded');
    return reply.send(text);
  });
}
