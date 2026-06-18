import { Readable } from 'node:stream';
import { GATEWAY_BASE_PATH, GATEWAY_HEADERS } from '@provable/contracts';
import type { FastifyInstance } from 'fastify';
import { authenticate } from './auth.js';
import { recompute } from './recompute.js';
import type { TrackBody } from './schemas.js';

/**
 * Phase C2 — the minimal functional gateway proxy (interim home in apps/api; refactors to
 * adapters/gateway when the adapter framework lands). OpenAI-compatible: a client repoints its
 * LLM base URL here, authenticates to Provable with a machine key, and Provable forwards the call
 * to the configured upstream and records an OBSERVE-ONLY decision (cost + activity, NO verdict).
 *
 * Key hygiene (S1 standard): the caller's BYO upstream key (Authorization) is forwarded upstream
 * and otherwise NEVER persisted, logged, recorded on the decision, or echoed in any error.
 *
 * Honest fidelity: a gateway-only agent has no verdict channel, so readiness stays N/A
 * (Observe-only) — never a fabricated score. The first call self-registers DISCOVERED→ACTIVE.
 */

function upstreamBase(): string {
  return process.env['PROVABLE_GATEWAY_UPSTREAM'] ?? 'https://api.openai.com';
}

interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export function registerGateway(app: FastifyInstance): void {
  app.post(`${GATEWAY_BASE_PATH}/chat/completions`, async (req, reply) => {
    const headers = req.headers as Record<string, unknown>;

    // Provable machine-key auth — DISTINCT from the upstream Authorization. Generic 401, no echo.
    const rawKey = headers[GATEWAY_HEADERS.key];
    const provableKey = typeof rawKey === 'string' ? rawKey : undefined;
    const orgId = await authenticate(provableKey);
    if (orgId === null) return reply.code(401).send({ error: 'unauthorized' });

    const agentKey = headers[GATEWAY_HEADERS.agent];
    const taskKey = headers[GATEWAY_HEADERS.task];
    if (typeof agentKey !== 'string' || agentKey.length === 0 || typeof taskKey !== 'string' || taskKey.length === 0) {
      return reply.code(400).send({ error: 'x-provable-agent and x-provable-task headers are required' });
    }

    const body = req.body as { model?: string; stream?: boolean } | undefined;

    // Forward ONLY safe headers upstream: the caller's own LLM key (Authorization) + content-type.
    // Provable's x-provable-* headers are never forwarded; nothing else leaks either direction.
    const fwd: Record<string, string> = { 'content-type': 'application/json' };
    if (typeof headers['authorization'] === 'string') fwd['authorization'] = headers['authorization'];

    const startedAt = Date.now();
    let upstream: Response;
    try {
      upstream = await fetch(`${upstreamBase()}/v1/chat/completions`, {
        method: 'POST',
        headers: fwd,
        body: JSON.stringify(req.body ?? {}),
      });
    } catch {
      // Network failure — never leak the key; record no decision.
      return reply.code(502).send({ error: 'upstream request failed' });
    }
    const latencyMs = Date.now() - startedAt;

    const passContentType = (): void => {
      const ct = upstream.headers.get('content-type');
      reply.header('content-type', ct ?? 'application/json');
    };

    // Streaming: pass through TRANSPARENTLY (agents that stream keep working) with NO cost
    // capture — documented via the response header. No silent half-work.
    if (body?.stream === true) {
      reply.header('x-provable-gateway', 'passthrough-streaming-no-capture');
      reply.code(upstream.status);
      passContentType();
      return reply.send(upstream.body === null ? '' : Readable.fromWeb(upstream.body as never));
    }

    const text = await upstream.text();

    // Upstream error: pass the status + the UPSTREAM body (provider's error, no Provable key in
    // it) straight through; record NO success-shaped decision.
    if (!upstream.ok) {
      reply.header('x-provable-gateway', 'upstream-error-not-recorded');
      reply.code(upstream.status);
      passContentType();
      return reply.send(text);
    }

    let parsed: { id?: string; model?: string; usage?: OpenAIUsage } = {};
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      // Non-JSON 200 — return as-is, no capture (can't trust usage parsing).
      reply.header('x-provable-gateway', 'recorded-no-usage');
      reply.code(200);
      passContentType();
      return reply.send(text);
    }

    const totalTokens =
      parsed.usage?.total_tokens ??
      (parsed.usage !== undefined
        ? (parsed.usage.prompt_tokens ?? 0) + (parsed.usage.completion_tokens ?? 0)
        : undefined);

    // Observe-only decision: cost (tokens + REAL latency) but NO verdict. `action` carries ONLY
    // non-secret metadata (model) — never the upstream key. USD is honest-null (no price table).
    const decision: TrackBody = {
      type: 'decision',
      agentKey,
      taskKey,
      action: { via: 'gateway', model: parsed.model ?? body?.model ?? null },
      source: 'gateway',
      cost: { ...(totalTokens !== undefined ? { tokens: totalTokens } : {}), latencyMs },
      ...(typeof parsed.id === 'string' && parsed.id.length > 0 ? { externalRef: parsed.id } : {}),
    };

    // Best-effort recording: the LLM call already succeeded, so a recording failure must NOT
    // fail the caller's request (don't break agents). Surface the outcome via the header.
    let recorded = 'recorded';
    try {
      await recompute(orgId, decision);
    } catch {
      recorded = 'record-failed';
    }

    reply.header('x-provable-gateway', recorded);
    reply.code(200);
    passContentType();
    return reply.send(text);
  });
}
