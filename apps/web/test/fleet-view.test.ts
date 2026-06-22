import { GOVERNANCE_STATUSES, type GovernanceStatus, type TaskGovernanceView } from '@provable/contracts';
import { describe, expect, it } from 'vitest';
import {
  CHIP_SPEC,
  chipLabel,
  filterTasks,
  groupByAgent,
  ladderGeometry,
  queueEmptyCopy,
  rowAction,
  toggleFilter,
} from '../src/lib/fleet-view';

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
    // SUSPENDED chip reads the cause trigger — a manual kill-switch must NOT read as a guardrail.
    expect(chipLabel(task({ status: 'SUSPENDED', suspendTrigger: 'SUSPEND' }))).toBe('suspended · manual');
    expect(chipLabel(task({ status: 'SUSPENDED', suspendTrigger: 'GUARDRAIL' }))).toBe('suspended · guardrail');
    expect(chipLabel(task({ status: 'SUSPENDED', suspendTrigger: 'DRIFT' }))).toBe('suspended · drift');
    expect(chipLabel(task({ status: 'SUSPENDED' }))).toBe('suspended'); // unknown cause → honest generic
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

describe('work-queue filter (U5) — counters select over the readiness list', () => {
  // Includes an OBSERVING (gateway/observe-only) row so the U5 filter ∩ O2 status is covered.
  const fleet = [
    task({ agentKey: 'prioritize', taskKey: 'triage', status: 'PROMOTABLE' }),
    task({ agentKey: 'vision', taskKey: 'classify', status: 'DEGRADED' }),
    task({ agentKey: 'billing', taskKey: 'auto_refund', status: 'SUSPENDED' }),
    task({ agentKey: 'support', taskKey: 'reply', status: 'HELD' }),
    task({ agentKey: 'support', taskKey: 'route', status: 'AT_LEVEL' }),
    task({ agentKey: 'gw-agent', taskKey: 'chat', status: 'OBSERVING' }),
  ];

  it('Promotable → only PROMOTABLE rows', () => {
    const out = filterTasks(fleet, 'promotable');
    expect(out.map((t) => t.status)).toEqual(['PROMOTABLE']);
  });

  it('Needs attention → only DEGRADED + SUSPENDED (never HELD/AT_LEVEL/PROMOTABLE/OBSERVING)', () => {
    const out = filterTasks(fleet, 'attention');
    expect(out.map((t) => t.status).sort()).toEqual(['DEGRADED', 'SUSPENDED']);
  });

  it('no filter → every row, and the source array is never mutated', () => {
    const out = filterTasks(fleet, null);
    expect(out).toHaveLength(fleet.length);
    expect(out).not.toBe(fleet); // fresh copy
  });

  it('toggle: re-selecting the active queue clears it; selecting another switches', () => {
    expect(toggleFilter(null, 'promotable')).toBe('promotable');
    expect(toggleFilter('promotable', 'promotable')).toBeNull(); // active → clear
    expect(toggleFilter('promotable', 'attention')).toBe('attention'); // switch
  });

  it('empty-state copy is honest per queue', () => {
    expect(queueEmptyCopy('promotable')).toBe('Nothing ready to advance right now.');
    expect(queueEmptyCopy('attention')).toBe('No agents need attention.');
    expect(queueEmptyCopy(null)).toBeNull();
  });

  // INTEGRATION (U5 ∩ O2) — the previously-unverified cross-branch behavior, now proven:
  // an OBSERVING agent must be excluded from BOTH the work-queue attention filter AND the
  // needsAttention KPI rule (DEGRADED + SUSPENDED only). It surfaces in the DEFAULT view.
  it('OBSERVING is excluded from BOTH the attention queue and the needsAttention KPI', () => {
    const observing = task({ agentKey: 'gw-agent', taskKey: 'chat', status: 'OBSERVING' });

    // (1) Work-queue attention filter excludes OBSERVING…
    const attentionView = filterTasks(fleet, 'attention');
    expect(attentionView.some((t) => t.status === 'OBSERVING')).toBe(false);
    expect(attentionView).not.toContainEqual(observing);

    // …but the DEFAULT (unfiltered) view DOES include it.
    expect(filterTasks(fleet, null).some((t) => t.status === 'OBSERVING')).toBe(true);

    // (2) needsAttention KPI rule (the same DEGRADED+SUSPENDED set the API counts) excludes it.
    const needsAttention = fleet.filter((t) => t.status === 'DEGRADED' || t.status === 'SUSPENDED');
    expect(needsAttention.some((t) => t.status === 'OBSERVING')).toBe(false);
    expect(needsAttention).toHaveLength(2); // the DEGRADED + the SUSPENDED, never the OBSERVING
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
