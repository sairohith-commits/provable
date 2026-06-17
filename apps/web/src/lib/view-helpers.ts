import type { AgentRow, ImpliedBand, TransitionView } from './types';

/**
 * PURE view helpers — persona pillar ordering, needs-attention ranking, and the
 * two-marker ladder math. No data is invented here: a persona lens only REORDERS the
 * same real sections; ranking only READS persisted state. Unit-tested in view-helpers.test.
 */

export const PERSONAS = ['All', 'CTO', 'COO', 'CFO', 'Legal'] as const;
export type Persona = (typeof PERSONAS)[number];

export type SectionKey = 'readiness' | 'governance' | 'visibility' | 'cost' | 'guardrails' | 'registry';

const ALL_SECTIONS: readonly SectionKey[] = [
  'readiness',
  'governance',
  'visibility',
  'cost',
  'guardrails',
  'registry',
];

/** Each lens RE-EMPHASIZES the same sections in the order that role cares about. */
const PERSONA_ORDER: Record<Persona, readonly SectionKey[]> = {
  All: ALL_SECTIONS,
  CTO: ['visibility', 'readiness', 'registry', 'guardrails', 'governance', 'cost'],
  COO: ['readiness', 'governance', 'guardrails', 'visibility', 'cost', 'registry'],
  CFO: ['cost', 'readiness', 'visibility', 'registry', 'guardrails', 'governance'],
  Legal: ['governance', 'guardrails', 'registry', 'readiness', 'visibility', 'cost'],
};

export function sectionOrder(persona: Persona): readonly SectionKey[] {
  return PERSONA_ORDER[persona];
}

/** Same set of sections for every persona — only the order differs (negative-test guard). */
export function sectionsAreSamePerPersona(): boolean {
  return PERSONAS.every((p) => {
    const s = sectionOrder(p);
    return s.length === ALL_SECTIONS.length && ALL_SECTIONS.every((k) => s.includes(k));
  });
}

// ── Needs-attention ranking ──────────────────────────────────────────────────
export interface AttentionInfo {
  needsAttention: boolean;
  pendingApproval: boolean;
  suspended: boolean;
  demoted: boolean;
  lowScore: boolean;
  rank: number; // higher = more urgent → floats to top
}

const SHADOW_MAX = 40;

export function attentionFor(row: AgentRow, transitions: readonly TransitionView[]): AttentionInfo {
  const mine = transitions.filter(
    (t) => t.agentKey === row.agentKey && t.taskKey === row.taskKey,
  );
  const pendingApproval = mine.some((t) => t.status === 'PENDING_APPROVAL');
  const suspended = row.effectiveMode === 'SUSPENDED';
  const demoted = mine.some((t) => t.direction === 'DEMOTION');
  const scored = row.score?.status === 'SCORED' && typeof row.score.readinessScore === 'number';
  const lowScore =
    scored &&
    (row.score!.readinessScore as number) <= SHADOW_MAX &&
    row.effectiveMode !== 'OBSERVING';
  // Urgency: pending approval (actionable now) > suspended > demoted > low score.
  let rank = 0;
  if (pendingApproval) rank += 8;
  if (suspended) rank += 4;
  if (demoted) rank += 2;
  if (lowScore) rank += 1;
  return {
    needsAttention: rank > 0,
    pendingApproval,
    suspended,
    demoted,
    lowScore,
    rank,
  };
}

/** Needs-attention-first ordering; ties keep a stable agentKey/taskKey order. */
export function sortReadinessRows(
  agents: readonly AgentRow[],
  transitions: readonly TransitionView[],
): { row: AgentRow; attention: AttentionInfo }[] {
  return agents
    .map((row) => ({ row, attention: attentionFor(row, transitions) }))
    .sort((a, b) => {
      if (b.attention.rank !== a.attention.rank) return b.attention.rank - a.attention.rank;
      if (a.row.agentKey !== b.row.agentKey) return a.row.agentKey.localeCompare(b.row.agentKey);
      return a.row.taskKey.localeCompare(b.row.taskKey);
    });
}

// ── Two-marker ladder math (the asymmetry made visible) ──────────────────────
const OPERATING_BANDS = new Set(['SHADOW', 'CO_PILOT', 'SOLO']);

/** Band CENTER on the 0–100 ladder (zones 0–40 / 41–70 / 71–100). */
export function bandCenter(band: string): number {
  if (band === 'SHADOW') return 20;
  if (band === 'CO_PILOT') return 55;
  if (band === 'SOLO') return 85;
  return 0;
}

export interface LadderMarkers {
  scorePct: number | null; // precise score position (0–100), if SCORED
  effectivePct: number | null; // SOLID marker — operating mode band center
  impliedPct: number | null; // GHOST/target marker — score-implied band center
  gap: boolean; // effective ≠ implied → ungoverned headroom
}

export function ladderMarkers(
  score: AgentRow['score'],
  effectiveMode: string,
): LadderMarkers {
  const scored = score?.status === 'SCORED' && typeof score.readinessScore === 'number';
  const scorePct = scored ? Math.max(0, Math.min(100, score!.readinessScore as number)) : null;
  const implied = (score?.impliedBand ?? null) as ImpliedBand | null;
  const effectivePct = OPERATING_BANDS.has(effectiveMode) ? bandCenter(effectiveMode) : null;
  const impliedPct = implied !== null ? bandCenter(implied) : null;
  const gap = effectivePct !== null && impliedPct !== null && effectivePct !== impliedPct;
  return { scorePct, effectivePct, impliedPct, gap };
}
