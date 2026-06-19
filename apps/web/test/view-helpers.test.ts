import { describe, expect, it } from 'vitest';
import type { AgentRow, ScoreView, TransitionView } from '../src/lib/types';
import { attentionFor, bandCenter, ladderMarkers, sortReadinessRows } from '../src/lib/view-helpers';

const scored = (s: number, band: string): ScoreView => ({
  status: 'SCORED',
  readinessScore: s,
  impliedBand: band as ScoreView['impliedBand'],
  eventCount: 10,
  resolvedCount: 10,
});

function agent(agentKey: string, taskKey: string, mode: AgentRow['effectiveMode'], score: ScoreView | null): AgentRow {
  return { agentKey, taskKey, effectiveMode: mode, score };
}


describe('needs-attention ranking — actionable rows float to the top', () => {
  const pending: TransitionView = {
    orgId: 'o' as never,
    agentKey: 'a' as never,
    taskKey: 'classify' as never,
    fromMode: 'SHADOW',
    toMode: 'CO_PILOT',
    direction: 'PROMOTION',
    trigger: 'SCORE_CROSS',
    status: 'PENDING_APPROVAL',
    reason: 'x',
    at: '2026-06-17T00:00:00.000Z',
  };

  it('a pending-approval row outranks a clean high-score row', () => {
    const rows = [
      agent('a', 'solo-clean', 'SOLO', scored(95, 'SOLO')),
      agent('a', 'classify', 'SHADOW', scored(93, 'SOLO')),
    ];
    const sorted = sortReadinessRows(rows, [pending]);
    expect(sorted[0]?.row.taskKey).toBe('classify');
    expect(sorted[0]?.attention.pendingApproval).toBe(true);
  });

  it('flags suspended and low-score rows as needing attention', () => {
    const suspended = attentionFor(agent('a', 't', 'SUSPENDED', scored(30, 'SHADOW')), []);
    expect(suspended.needsAttention).toBe(true);
    expect(suspended.suspended).toBe(true);
    const clean = attentionFor(agent('a', 't', 'SOLO', scored(90, 'SOLO')), []);
    expect(clean.needsAttention).toBe(false);
  });
});

describe('two-marker ladder math (Readiness fix #1 + #4)', () => {
  it('classify shows a gap: Co-Pilot operating, Solo implied', () => {
    const m = ladderMarkers(scored(93, 'SOLO'), 'CO_PILOT');
    expect(m.effectivePct).toBe(bandCenter('CO_PILOT')); // 55
    expect(m.impliedPct).toBe(bandCenter('SOLO')); // 85
    expect(m.gap).toBe(true);
    expect(m.scorePct).toBe(93);
  });

  it('markers coincide when score-band == operating mode (no gap)', () => {
    const m = ladderMarkers(scored(85, 'SOLO'), 'SOLO');
    expect(m.effectivePct).toBe(m.impliedPct);
    expect(m.gap).toBe(false);
  });

  it('band centers sit inside the real 40/30/30 zones', () => {
    expect(bandCenter('SHADOW')).toBeLessThanOrEqual(40);
    expect(bandCenter('CO_PILOT')).toBeGreaterThan(40);
    expect(bandCenter('CO_PILOT')).toBeLessThanOrEqual(70);
    expect(bandCenter('SOLO')).toBeGreaterThan(70);
  });
});
