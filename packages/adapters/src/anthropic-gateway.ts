import type { MappedDecision } from './port.js';

/**
 * Anthropic gateway adapter (Phase O2) — the ANTI-CORRUPTION layer for the Tier-1 /v1/messages
 * proxy. ALL Anthropic-shape knowledge lives here: the upstream URL, the price table, how to read
 * token usage from a non-streaming response body AND from the SSE event stream, and how to map a
 * completed call to a canonical OBSERVE-ONLY MappedDecision (no verdict → readiness stays N/A).
 *
 * The composition root (apps/api) does the HTTP plumbing and stamps the tenant; it imports these
 * helpers so no vendor noun leaks into core. Imports only @provable/contracts types (none needed
 * here beyond the local MappedDecision shape) — dependency-cruiser keeps it contracts-only.
 */

/** Anthropic upstream. The proxy posts `${ANTHROPIC_BASE_URL}${ANTHROPIC_MESSAGES_PATH}`. */
export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
export const ANTHROPIC_MESSAGES_PATH = '/v1/messages';

/**
 * Claude list prices in USD per MILLION tokens. MAINTAINABLE config — Rohith VERIFIES these
 * against current Anthropic pricing and bumps `ANTHROPIC_PRICES_AS_OF`. An unknown model yields a
 * null cost (honest), NEVER a guess.
 *
 * asOf: 2026-06-21 — VERIFY against https://www.anthropic.com/pricing before relying on USD.
 */
export const ANTHROPIC_PRICES_AS_OF = '2026-06-21';

export interface ModelPrice {
  readonly inputPerMTok: number;
  readonly outputPerMTok: number;
}

export const ANTHROPIC_PRICES: Readonly<Record<string, ModelPrice>> = {
  // Claude 4.x family
  'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-opus-4-1': { inputPerMTok: 15, outputPerMTok: 75 },
  'claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-sonnet-4-5': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
  // Claude 3.x family (still referenced by older agents)
  'claude-3-5-sonnet-latest': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-3-5-haiku-latest': { inputPerMTok: 0.8, outputPerMTok: 4 },
  'claude-3-opus-latest': { inputPerMTok: 15, outputPerMTok: 75 },
};

/**
 * Real USD for a call: input×in_rate + output×out_rate (rates are per-million). Returns null when
 * the model is unknown (never guessed) or when NO token signal exists. A model whose price exists
 * but with one token count missing treats the missing side as 0 (partial signal is still honest).
 */
export function priceUsd(
  model: string | null,
  inputTokens: number | null,
  outputTokens: number | null,
): number | null {
  if (model === null) return null;
  const p = ANTHROPIC_PRICES[model];
  if (p === undefined) return null; // unknown model → honest null, never a guess
  if (inputTokens === null && outputTokens === null) return null;
  const inT = inputTokens ?? 0;
  const outT = outputTokens ?? 0;
  return (inT / 1_000_000) * p.inputPerMTok + (outT / 1_000_000) * p.outputPerMTok;
}

/** What the proxy extracts from a call, regardless of streaming vs non-streaming. */
export interface GatewayUsage {
  readonly id: string | null; // Anthropic message id → externalRef (idempotency)
  readonly model: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

export const EMPTY_GATEWAY_USAGE: GatewayUsage = {
  id: null,
  model: null,
  inputTokens: null,
  outputTokens: null,
};

function asInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * NON-STREAMING: read usage from a parsed `/v1/messages` response body. Shape:
 *   { id, model, usage: { input_tokens, output_tokens } }
 */
export function parseMessagesUsage(body: unknown): GatewayUsage {
  if (body === null || typeof body !== 'object') return EMPTY_GATEWAY_USAGE;
  const b = body as { id?: unknown; model?: unknown; usage?: unknown };
  const usage = (b.usage ?? {}) as { input_tokens?: unknown; output_tokens?: unknown };
  return {
    id: asStr(b.id),
    model: asStr(b.model),
    inputTokens: asInt(usage.input_tokens),
    outputTokens: asInt(usage.output_tokens),
  };
}

/**
 * STREAMING: fold ONE parsed SSE `data:` object into the running usage. Anthropic emits:
 *   message_start → { message: { id, model, usage: { input_tokens, output_tokens } } }
 *   message_delta → { usage: { output_tokens } }   (cumulative running total)
 * Other event types (content_block_*, ping, message_stop) carry no usage and pass through unchanged.
 * PURE — the proxy reduces each event as it tees the stream, never buffering the body.
 */
export function reduceSseUsage(state: GatewayUsage, data: unknown): GatewayUsage {
  if (data === null || typeof data !== 'object') return state;
  const d = data as { type?: unknown; message?: unknown; usage?: unknown };

  if (d.type === 'message_start' && d.message !== null && typeof d.message === 'object') {
    const m = d.message as { id?: unknown; model?: unknown; usage?: unknown };
    const u = (m.usage ?? {}) as { input_tokens?: unknown; output_tokens?: unknown };
    return {
      id: asStr(m.id) ?? state.id,
      model: asStr(m.model) ?? state.model,
      inputTokens: asInt(u.input_tokens) ?? state.inputTokens,
      outputTokens: asInt(u.output_tokens) ?? state.outputTokens,
    };
  }

  if (d.type === 'message_delta' && d.usage !== null && typeof d.usage === 'object') {
    const u = d.usage as { output_tokens?: unknown };
    const out = asInt(u.output_tokens);
    return out === null ? state : { ...state, outputTokens: out }; // cumulative → latest wins
  }

  return state;
}

/** Inputs the proxy supplies once a call completes; `externalRef` is the resolved idempotency key. */
export interface GatewayCall {
  readonly agentKey: string;
  readonly taskKey: string;
  readonly usage: GatewayUsage;
  readonly latencyMs: number;
  readonly externalRef: string;
}

/**
 * Map a completed gateway call → a canonical OBSERVE-ONLY decision: source 'gateway', NO verdict
 * and NO outcome (so readiness/governance stays N/A — the locked observe-only cap), with real cost
 * (tokens + USD from the price table + latency). `action` carries ONLY non-secret metadata
 * (vendor + model); the caller's Anthropic key is never seen here. USD is omitted when the model is
 * unknown (honest null), never fabricated.
 */
export function mapAnthropicGatewayDecision(call: GatewayCall): MappedDecision {
  const { id: _id, model, inputTokens, outputTokens } = call.usage;
  const hasTokens = inputTokens !== null || outputTokens !== null;
  const tokens = (inputTokens ?? 0) + (outputTokens ?? 0);
  const usd = priceUsd(model, inputTokens, outputTokens);

  const cost = {
    ...(hasTokens ? { tokens } : {}),
    ...(usd !== null ? { usd } : {}),
    latencyMs: call.latencyMs,
  };

  return {
    type: 'decision',
    agentKey: call.agentKey,
    taskKey: call.taskKey,
    action: { via: 'gateway', vendor: 'anthropic', model: model ?? null },
    source: 'gateway',
    cost,
    externalRef: call.externalRef,
    metadata: {
      vendor: 'anthropic',
      ...(inputTokens !== null ? { inputTokens } : {}),
      ...(outputTokens !== null ? { outputTokens } : {}),
    },
    // NO verdict, NO outcome → observe-only. readiness can never be fabricated for this agent.
  };
}
