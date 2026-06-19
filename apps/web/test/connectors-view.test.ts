import { describe, expect, it } from 'vitest';
import {
  type ConnectorForm,
  buildMapping,
  emptyForm,
  governLabel,
  mappingComplete,
  parseSample,
  valuesFromRows,
} from '../src/lib/connectors-view';

const filled = (over: Partial<ConnectorForm> = {}): ConnectorForm => ({
  ...emptyForm(),
  name: 'c',
  ...over,
});

describe('valuesFromRows — lowercased source-value → canonical kind; empty rows dropped', () => {
  it('builds the value-map and drops incomplete rows', () => {
    expect(
      valuesFromRows([
        { from: 'Approved', to: 'ACCEPTED' },
        { from: 'rejected', to: 'FAILED' },
        { from: '', to: 'SUCCESS' }, // dropped
        { from: 'x', to: '' }, // dropped
      ]),
    ).toEqual({ approved: 'ACCEPTED', rejected: 'FAILED' });
  });
});

describe('buildMapping — assembles the declarative mapping the editor represents', () => {
  it('includes verdict+outcome blocks only when path + at least one value-map row exist', () => {
    const m = buildMapping(
      filled({
        verdictPath: 'result',
        verdictMap: [{ from: 'approved', to: 'ACCEPTED' }],
        outcomePath: 'res',
        outcomeMap: [{ from: 'ok', to: 'SUCCESS' }],
        confidence: 'conf',
      }),
    );
    expect(m.verdict).toEqual({ path: 'result', values: { approved: 'ACCEPTED' } });
    expect(m.outcome).toEqual({ path: 'res', values: { ok: 'SUCCESS' } });
    expect(m.confidence).toBe('conf');
    expect(m.agentKey).toBe('agent');
  });

  it('OMITS verdict when there is no value-map row (→ observe-only mapping)', () => {
    const m = buildMapping(filled({ verdictPath: 'result', verdictMap: [{ from: '', to: '' }] }));
    expect(m.verdict).toBeUndefined();
    expect(m.outcome).toBeUndefined();
  });

  it('omits empty optional paths (no empty timestamp/action/confidence keys)', () => {
    const m = buildMapping(filled());
    expect(m.at).toBeUndefined();
    expect(m.action).toBeUndefined();
    expect(m.confidence).toBeUndefined();
    expect(Object.keys(m).sort()).toEqual(['agentKey', 'externalRef', 'taskKey']);
  });
});

describe('mappingComplete / parseSample / governLabel', () => {
  it('mappingComplete requires name + the three required paths', () => {
    expect(mappingComplete(filled())).toBe(true);
    expect(mappingComplete(filled({ name: '' }))).toBe(false);
    expect(mappingComplete(filled({ externalRef: '' }))).toBe(false);
  });

  it('parseSample returns ok for valid JSON, error otherwise', () => {
    expect(parseSample('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseSample('not json').ok).toBe(false);
  });

  it('governLabel reflects the backend governed flag (display only)', () => {
    expect(governLabel(true)).toMatch(/GOVERN/);
    expect(governLabel(false)).toMatch(/OBSERVE-ONLY/);
  });
});
