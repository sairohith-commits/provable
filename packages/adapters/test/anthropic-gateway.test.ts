import { describe, expect, it } from 'vitest';
import {
  EMPTY_GATEWAY_USAGE,
  mapAnthropicGatewayDecision,
  parseMessagesUsage,
  priceUsd,
  reduceSseUsage,
} from '../src/index.js';

describe('priceUsd — real USD from the price table; unknown model → null', () => {
  it('computes input×in_rate + output×out_rate (per-million)', () => {
    // claude-sonnet-4-6: $3 / $15 per MTok.
    expect(priceUsd('claude-sonnet-4-6', 1_000_000, 1_000_000)).toBeCloseTo(18, 10);
    expect(priceUsd('claude-sonnet-4-6', 1000, 500)).toBeCloseTo(0.003 + 0.0075, 10);
  });

  it('unknown model → null (honest, never guessed)', () => {
    expect(priceUsd('gpt-4o', 1000, 1000)).toBeNull();
    expect(priceUsd(null, 1000, 1000)).toBeNull();
  });

  it('no token signal → null even for a known model', () => {
    expect(priceUsd('claude-sonnet-4-6', null, null)).toBeNull();
  });

  it('a partial token signal is honest (missing side counted as 0)', () => {
    expect(priceUsd('claude-sonnet-4-6', 1_000_000, null)).toBeCloseTo(3, 10);
  });

  // The Anthropic RESPONSE body returns a dated snapshot, not the bare alias — it must price the same.
  it('a dated snapshot resolves to its alias price', () => {
    const alias = priceUsd('claude-sonnet-4-6', 1_000_000, 1_000_000);
    expect(priceUsd('claude-sonnet-4-6-20251114', 1_000_000, 1_000_000)).toBe(alias);
    // opus-4-8 dated snapshot prices the same as the alias (and NOT as opus-4-1's $15/$75).
    expect(priceUsd('claude-opus-4-8-20260321', 1_000_000, 1_000_000)).toBe(
      priceUsd('claude-opus-4-8', 1_000_000, 1_000_000),
    );
    // a `-latest` table key (3.x) still resolves from a dated snapshot of that family.
    expect(priceUsd('claude-3-5-sonnet-20241022', 1_000_000, 0)).toBe(
      priceUsd('claude-3-5-sonnet-latest', 1_000_000, 0),
    );
  });

  it('an extra qualifier after the family root still resolves (longest-prefix)', () => {
    expect(priceUsd('claude-sonnet-4-6-v2-20251114', 1_000_000, 1_000_000)).toBe(
      priceUsd('claude-sonnet-4-6', 1_000_000, 1_000_000),
    );
  });

  it('a genuinely unknown family stays null (no false prefix match)', () => {
    // Not in the table; must NOT borrow opus-4-8's price via a loose prefix.
    expect(priceUsd('claude-opus-5-0-20270101', 1000, 1000)).toBeNull();
  });
});

describe('parseMessagesUsage — non-streaming response body', () => {
  it('reads id, model, input/output tokens', () => {
    const u = parseMessagesUsage({
      id: 'msg_01abc',
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 25, output_tokens: 40 },
    });
    expect(u).toEqual({ id: 'msg_01abc', model: 'claude-sonnet-4-6', inputTokens: 25, outputTokens: 40 });
  });

  it('tolerates a missing usage block → nulls (never throws)', () => {
    expect(parseMessagesUsage({ id: 'msg_x', model: 'claude-haiku-4-5' })).toEqual({
      id: 'msg_x',
      model: 'claude-haiku-4-5',
      inputTokens: null,
      outputTokens: null,
    });
    expect(parseMessagesUsage('not json')).toEqual(EMPTY_GATEWAY_USAGE);
  });
});

describe('reduceSseUsage — streaming SSE token capture', () => {
  it('captures input from message_start and the cumulative output from message_delta', () => {
    let u = EMPTY_GATEWAY_USAGE;
    u = reduceSseUsage(u, {
      type: 'message_start',
      message: { id: 'msg_stream', model: 'claude-sonnet-4-6', usage: { input_tokens: 25, output_tokens: 1 } },
    });
    u = reduceSseUsage(u, { type: 'content_block_delta', delta: { text: 'hi' } }); // no usage → no-op
    u = reduceSseUsage(u, { type: 'message_delta', usage: { output_tokens: 17 } });
    u = reduceSseUsage(u, { type: 'message_delta', usage: { output_tokens: 42 } }); // cumulative → latest wins
    u = reduceSseUsage(u, { type: 'message_stop' });
    expect(u).toEqual({ id: 'msg_stream', model: 'claude-sonnet-4-6', inputTokens: 25, outputTokens: 42 });
  });
});

describe('mapAnthropicGatewayDecision — OBSERVE-ONLY canonical decision', () => {
  it('emits source gateway, NO verdict/outcome, real cost (tokens+usd+latency)', () => {
    const d = mapAnthropicGatewayDecision({
      agentKey: 'a',
      taskKey: 't',
      usage: { id: 'msg_1', model: 'claude-sonnet-4-6', inputTokens: 1_000_000, outputTokens: 1_000_000 },
      latencyMs: 123,
      externalRef: 'msg_1',
    });
    expect(d.source).toBe('gateway');
    expect(d.verdict).toBeUndefined(); // observe-only → readiness can never be fabricated
    expect(d.outcome).toBeUndefined();
    expect(d.externalRef).toBe('msg_1');
    expect(d.cost).toEqual({ tokens: 2_000_000, usd: 18, latencyMs: 123 });
    expect(d.action).toMatchObject({ via: 'gateway', vendor: 'anthropic', model: 'claude-sonnet-4-6' });
  });

  it('unknown model → tokens kept but USD omitted (honest null cost)', () => {
    const d = mapAnthropicGatewayDecision({
      agentKey: 'a',
      taskKey: 't',
      usage: { id: 'msg_2', model: 'some-unknown-model', inputTokens: 10, outputTokens: 20 },
      latencyMs: 5,
      externalRef: 'msg_2',
    });
    expect(d.cost).toEqual({ tokens: 30, latencyMs: 5 }); // no usd key
    expect(d.cost?.usd).toBeUndefined();
  });
});
