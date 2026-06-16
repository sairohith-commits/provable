import type { AutonomyMode, Transition } from '@provable/contracts';

export type { Transition };

export type ImpliedBand = 'SHADOW' | 'CO_PILOT' | 'SOLO';

export interface ScoreView {
  status: 'SCORED' | 'INSUFFICIENT';
  readinessScore?: number | null;
  impliedBand?: ImpliedBand | null;
  accuracyRate?: number | null;
  confidenceAvg?: number | null;
  overrideRate?: number | null;
  escalationRate?: number | null;
  missing?: string[];
  eventCount: number;
  resolvedCount: number;
}

export interface AgentRow {
  agentKey: string;
  taskKey: string;
  effectiveMode: AutonomyMode;
  score: ScoreView | null;
}

export interface OverviewData {
  agents: AgentRow[];
  transitions: Transition[];
}
