import { GOVERNANCE_STATUSES, type GovernanceStatus, type TaskGovernanceView } from '@provable/contracts';
import { describe, expect, it } from 'vitest';
import { CHIP_SPEC, chipLabel, groupByAgent, ladderGeometry, rowAction } from '../src/lib/fleet-view';

const task = (over: Partial<TaskGovernanceView>): TaskGovernanceView => ({
  agentKey: 'a',
  taskKey: 't',
  score: 80,
  impliedBand: 'SOLO',
  effectiveMode: 'SHADOW',
  status: 'AT_LEVEL',
  headroomTo: null,
  actionAvailable: false,
  reasonNote: '',
  ...over,
});

describe('StatusChip spec is exhaustive over GovernanceStatus (no free string)', () => {
  it('CHIP_SPEC keys == GOVERNANCE_STATUSES exactly', () => {
    expect(Object.keys(CHIP_SPEC).sort()).toEqual([...GOVERNANCE_STATUSES].sort());
  });
  it('each status maps to a tone + icon', () => {
    for (const s of GOVERNANCE_STATUSES) {
      expect(CHIP_SPEC[s].tone).toBeTruthy();
      expect(CHIP_SPEC[s].icon).toBeTruthy();
    }
  });
  it('labels read per status', () => {
    expect(chipLabel(task({ status: 'PROMOTABLE', headroomTo: 'SOLO' }))).toBe('promotable to Solo');
    expect(chipLabel(task({ status: 'HELD', effectiveMode: 'SHADOW' }))).toBe('held at Shadow · manual');
    expect(chipLabel(task({ status: 'AT_LEVEL' }))).toBe('at level');
    expect(chipLabel(task({ status: 'OBSERVING' }))).toBe('observe-only');
    expect(chipLabel(task({ status: 'DEGRADED', score: null }))).toBe('unscored');
    expect(chipLabel(task({ status: 'DEGRADED', score: 55 }))).toBe('signal lost · demoted');
    expect(chipLabel(task({ status: 'SUSPENDED' }))).toBe('suspended · guardrail');
  });

  it('OBSERVING is a neutral/informational chip (observe tone, eye icon) — Phase O2', () => {
    expect(CHIP_SPEC.OBSERVING).toEqual({ tone: 'observe', icon: 'eye' });
  });
});

describe('rowAction — an approve affordance is structurally impossible unless actionAvailable', () => {
  it('PROMOTABLE + actionAvailable + canApprove → approve "Review promotion"', () => {
    const a = rowAction(task({ status: 'PROMOTABLE', actionAvailable: true }), true);
    expect(a).toEqual({ kind: 'approve', label: 'Review promotion' });
  });

  it('actionAvailable but viewer cannot approve → no action (UX gate)', () => {
    expect(rowAction(task({ status: 'PROMOTABLE', actionAvailable: true }), false)).toBeNull();
  });

  it('NEVER an approve when actionAvailable=false — DEGRADED, SUSPENDED, HELD, AT_LEVEL, OBSERVING', () => {
    for (const status of ['DEGRADED', 'SUSPENDED', 'HELD', 'AT_LEVEL', 'OBSERVING'] as GovernanceStatus[]) {
      const a = rowAction(task({ status, actionAvailable: false }), true);
      expect(a?.kind).not.toBe('approve');
    }
    expect(rowAction(task({ status: 'OBSERVING', actionAvailable: false }), true)).toBeNull(); // observe-only: no affordance
    expect(rowAction(task({ status: 'HELD', actionAvailable: false }), true)).toEqual({ kind: 'review', label: 'Review' });
    expect(rowAction(task({ status: 'DEGRADED', actionAvailable: false }), true)?.kind).toBe('link');
    expect(rowAction(task({ status: 'SUSPENDED', actionAvailable: false }), true)?.kind).toBe('link');
    expect(rowAction(task({ status: 'AT_LEVEL', actionAvailable: false }), true)).toBeNull();
  });
});

describe('ladderGeometry — dot iff scored; ring suppressed + lock iff suspended', () => {
  it('dot present iff score != null', () => {
    expect(ladderGeometry(80, 'SHADOW', 'AT_LEVEL').dot).toBe(80);
    expect(ladderGeometry(null, 'SHADOW', 'DEGRADED').dot).toBeNull();
    expect(ladderGeometry(null, 'SHADOW', 'DEGRADED').dimmed).toBe(true);
  });
  it('SUSPENDED → lock true, ring suppressed (null)', () => {
    const g = ladderGeometry(95, 'SOLO', 'SUSPENDED');
    expect(g.lock).toBe(true);
    expect(g.ring).toBeNull();
  });
  it('non-suspended operating mode → ring at band center, no lock', () => {
    const g = ladderGeometry(60, 'CO_PILOT', 'AT_LEVEL');
    expect(g.lock).toBe(false);
    expect(g.ring).toBe(65);
  });
});

describe('groupByAgent — worst status leads', () => {
  it('groups tasks per agent with the worst status', () => {
    const groups = groupByAgent([
      task({ agentKey: 'vision', taskKey: 'caption', status: 'DEGRADED' }),
      task({ agentKey: 'vision', taskKey: 'tag', status: 'AT_LEVEL' }),
      task({ agentKey: 'billing', taskKey: 'charge', status: 'SUSPENDED' }),
    ]);
    expect(groups[0]!.agentKey).toBe('billing'); // SUSPENDED is most severe → first
    expect(groups[0]!.worst).toBe('SUSPENDED');
    const vision = groups.find((g) => g.agentKey === 'vision')!;
    expect(vision.worst).toBe('DEGRADED');
    expect(vision.count).toBe(2);
  });
});
