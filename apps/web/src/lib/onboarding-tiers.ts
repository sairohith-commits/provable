// Pure tier metadata (Phase C2) — the single source for the three-tier presentation, so the
// page and the test agree on fidelity + which tiers are actionable. Tier 2 is `actionable:false`
// (presented, never faked — the adapter framework is C3).
export type TierId = 'gateway' | 'adapter' | 'sdk';

export interface Tier {
  readonly id: TierId;
  readonly title: string;
  readonly fidelity: string;
  readonly actionable: boolean;
  /** 'recipe' → a concrete copy-paste recipe; 'pointer' → presented with a forward pointer. */
  readonly mode: 'recipe' | 'pointer';
}

export const TIERS: readonly Tier[] = [
  {
    id: 'gateway',
    title: 'Tier 1 · Gateway',
    fidelity: 'Observe-only — cost + activity',
    actionable: true,
    mode: 'recipe',
  },
  {
    id: 'adapter',
    title: 'Tier 2 · Adapter',
    fidelity: 'Full governance — no agent code',
    actionable: false,
    mode: 'pointer',
  },
  {
    id: 'sdk',
    title: 'Tier 3 · SDK',
    fidelity: 'Highest fidelity — minimal code',
    actionable: true,
    mode: 'recipe',
  },
];

export function tier(id: TierId): Tier {
  const t = TIERS.find((x) => x.id === id);
  if (t === undefined) throw new Error(`unknown tier ${id}`);
  return t;
}
