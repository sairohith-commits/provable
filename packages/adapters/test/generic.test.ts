import { describe, expect, it } from 'vitest';
import { DEFAULT_EVENT_MAPPING, eventsConnector, genericConnector } from '../src/index.js';
import type { MappedDecision } from '../src/index.js';

const dec = (e: ReturnType<typeof eventsConnector.map>[number]): MappedDecision => {
  if (e.type !== 'decision') throw new Error('expected a decision');
  return e;
};

describe('generic connector — declarative mapping', () => {
  it('maps a verdict-present event to a GOVERNED decision (verdict + outcome)', () => {
    const [e] = eventsConnector.map({
      agent: 'support-bot',
      task: 'classify',
      id: 'evt-1',
      input: { text: 'hello' },
      confidence: 0.9,
      verdict: 'approved',
      outcome: 'success',
      timestamp: '2026-06-15T00:00:00.000Z',
    });
    const d = dec(e!);
    expect(d).toMatchObject({
      type: 'decision',
      agentKey: 'support-bot',
      taskKey: 'classify',
      externalRef: 'evt-1',
      source: 'connector',
      confidence: 0.9,
      verdict: { kind: 'ACCEPTED' },
      outcome: 'SUCCESS',
      at: '2026-06-15T00:00:00.000Z',
    });
    expect(d.action).toEqual({ text: 'hello' });
  });

  it('maps a verdict-ABSENT event to an Observe-only decision (no verdict)', () => {
    const d = dec(eventsConnector.map({ agent: 'a', task: 't', id: 'evt-2', input: 'x' })[0]!);
    expect(d.verdict).toBeUndefined();
    expect(d.outcome).toBeUndefined();
    expect(d.source).toBe('connector');
  });

  it('drops an UNKNOWN verdict value (→ Observe-only), never fabricates', () => {
    const d = dec(eventsConnector.map({ agent: 'a', task: 't', id: 'evt-3', verdict: 'banana' })[0]!);
    expect(d.verdict).toBeUndefined();
  });

  it('REJECTS an event missing the mapped externalRef (idempotency guarantee)', () => {
    expect(() => eventsConnector.map({ agent: 'a', task: 't', input: 'x' })).toThrow(/externalRef/i);
  });

  it('rejects a missing agentKey and a non-object item', () => {
    expect(() => eventsConnector.map({ task: 't', id: 'evt-4' })).toThrow(/agentKey/i);
    expect(() => eventsConnector.map(['not-an-object'])).toThrow(/not an object/i);
  });

  it('accepts a single event or an array', () => {
    expect(eventsConnector.map({ agent: 'a', task: 't', id: 'one' })).toHaveLength(1);
    expect(
      eventsConnector.map([
        { agent: 'a', task: 't', id: 'm1' },
        { agent: 'a', task: 't', id: 'm2' },
      ]),
    ).toHaveLength(2);
  });

  it('honors a custom declarative mapping (nested paths + value map)', () => {
    const c = genericConnector('custom', {
      agentKey: 'meta.agent',
      taskKey: 'meta.task',
      externalRef: 'ref',
      verdict: { path: 'review.decision', values: { ok: 'ACCEPTED', changed: 'OVERRIDDEN' } },
    });
    const d = dec(c.map({ meta: { agent: 'nested', task: 'review' }, ref: 'r1', review: { decision: 'changed' } })[0]!);
    expect(d.agentKey).toBe('nested');
    expect(d.verdict).toEqual({ kind: 'OVERRIDDEN' });
  });

  it('exposes the default mapping for the recipe/contract', () => {
    expect(DEFAULT_EVENT_MAPPING.externalRef).toBe('id');
    expect(DEFAULT_EVENT_MAPPING.agentKey).toBe('agent');
  });
});
