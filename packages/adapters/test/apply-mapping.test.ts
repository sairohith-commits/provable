import { describe, expect, it } from 'vitest';
import { type DeclarativeMapping, applyMapping, parseMapping } from '../src/index.js';
import type { MappedDecision } from '../src/index.js';

const mapping: DeclarativeMapping = {
  agentKey: 'agent',
  taskKey: 'task',
  externalRef: 'id',
  confidence: 'conf',
  at: 'ts',
  verdict: { path: 'result', values: { approved: 'ACCEPTED', rejected: 'FAILED' } },
  outcome: { path: 'res', values: { ok: 'SUCCESS', bad: 'FAILURE' } },
};

describe('applyMapping — governed vs observe-only (Phase O3a)', () => {
  it('a record WITH verdict + outcome → governed decision (verdict translated via value-map)', () => {
    const ev = applyMapping(mapping, {
      agent: 'support',
      task: 'triage',
      id: 'rec-1',
      conf: 0.9,
      ts: '2026-06-15T00:00:00.000Z',
      result: 'approved',
      res: 'ok',
    }) as MappedDecision;
    expect(ev.type).toBe('decision');
    expect(ev.agentKey).toBe('support');
    expect(ev.externalRef).toBe('rec-1');
    expect(ev.verdict).toEqual({ kind: 'ACCEPTED' });
    expect(ev.outcome).toBe('SUCCESS');
    expect(ev.source).toBe('connector');
  });

  it('a record WITHOUT a verdict path value → observe-only (no verdict fabricated)', () => {
    const ev = applyMapping(mapping, { agent: 'support', task: 'triage', id: 'rec-2' }) as MappedDecision;
    expect(ev.verdict).toBeUndefined();
    expect(ev.outcome).toBeUndefined();
  });

  it('an UNKNOWN verdict value is dropped → observe-only (never mis-translated)', () => {
    const ev = applyMapping(mapping, { agent: 'a', task: 't', id: 'rec-3', result: 'maybe' }) as MappedDecision;
    expect(ev.verdict).toBeUndefined();
  });

  it('a record missing the required externalRef is rejected (no ingest-without-dedup)', () => {
    expect(() => applyMapping(mapping, { agent: 'a', task: 't' })).toThrow();
  });

  it('MappedEvent carries NO orgId (tenant is stamped by the composition root)', () => {
    const ev = applyMapping(mapping, { agent: 'a', task: 't', id: 'r' });
    expect((ev as unknown as Record<string, unknown>)['orgId']).toBeUndefined();
  });
});

describe('parseMapping — validates a stored mapping', () => {
  it('accepts a well-formed mapping and rejects an unknown verdict kind in the value-map', () => {
    expect(parseMapping(mapping)).toMatchObject({ agentKey: 'agent', externalRef: 'id' });
    const badMapping: unknown = { ...mapping, verdict: { path: 'result', values: { approved: 'NOT_A_KIND' } } };
    expect(() => parseMapping(badMapping)).toThrow();
  });

  it('rejects a mapping missing required field-paths', () => {
    expect(() => parseMapping({ agentKey: 'a' })).toThrow();
  });
});
