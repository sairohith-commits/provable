import type { AgentIdentityState, AutonomyMode, FleetOverview, Transition } from '@provable/contracts';

export type { Transition };
export type { FleetOverview, TaskGovernanceView, FleetKpis, GovernanceStatus } from '@provable/contracts';

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

/** A governance transition with the Clerk approver id resolved to a human display name. */
export interface TransitionView extends Transition {
  approverDisplay?: string; // resolved name/email for an APPROVER (approved a promotion)
  actorDisplay?: string; // resolved name/email for an ACTOR (authored a MANUAL_OVERRIDE)
}

// ── Identity & Registry ──────────────────────────────────────────────────────
export interface RegistryAgentRow {
  agentKey: string;
  identityState: AgentIdentityState;
  storedIdentityState: AgentIdentityState;
  firstSeen: string | null;
  lastSeen: string | null;
  sources: string[];
  taskCount: number;
  retiredTaskCount: number;
  decisionCount: number;
}

// ── Visibility & Intelligence ────────────────────────────────────────────────
export interface VerdictMix {
  ACCEPTED: number;
  OVERRIDDEN: number;
  ESCALATED: number;
  FAILED: number;
  PENDING: number; // a decision genuinely awaiting a verdict
  OBSERVED: number; // gateway/observe-only: no verdict, none expected (distinct from PENDING)
}

export interface ScoreComponents {
  accuracyRate: number | null;
  confidenceAvg: number | null;
  overrideRate: number | null;
  escalationRate: number | null;
}

export interface ScoreTrendPoint {
  at: string;
  readinessScore: number | null;
  status: 'SCORED' | 'INSUFFICIENT';
}

export interface VisibilityRow {
  agentKey: string;
  taskKey: string;
  effectiveMode: AutonomyMode;
  verdictMix: VerdictMix;
  windowVolume: number;
  windowResolved: number;
  totalVolume: number;
  scoreStatus: 'SCORED' | 'INSUFFICIENT' | null;
  readinessScore: number | null;
  impliedBand: string | null;
  components: ScoreComponents | null;
  scoreTrend: ScoreTrendPoint[];
}

// ── Cost & ROI ───────────────────────────────────────────────────────────────
export interface CostRow {
  agentKey: string;
  taskKey: string;
  effectiveMode: AutonomyMode;
  decisionCount: number;
  tokens: number;
  usd: number;
  avgLatencyMs: number | null;
  hasCostSignal: boolean;
}

export interface RoiProjection {
  isProjection: true;
  label: string;
  assumptions: {
    assumedHumanMinutesPerDecision: number;
    assumedHumanHourlyUsd: number;
  };
  humanCostPerDecisionUsd: number;
  agentCostPerDecisionUsd: number;
  costDeltaPerDecisionUsd: number;
  shadowDecisionVolume: number;
  projectedSavingsIfPromotedUsd: number;
}

export interface CostView {
  tasks: CostRow[];
  org: {
    decisionCount: number;
    tokens: number;
    usd: number;
    avgLatencyMs: number | null;
    hasCostSignal: boolean;
  };
  roi: RoiProjection;
}

// ── Guardrails & Safety ──────────────────────────────────────────────────────
export interface SafetyView {
  events: TransitionView[];
  suspended: { agentKey: string; taskKey: string }[];
}

// ── KPI summary ──────────────────────────────────────────────────────────────
export interface SummaryView {
  activeAgents: number;
  agentsTotal: number;
  pendingApprovals: number;
  suspendedCount: number;
  guardrailEventCount: number;
  decisionCount: number;
  tokenSpend: number;
  usdSpend: number;
  hasCostSignal: boolean;
  roi: RoiProjection;
  apiKeyPrefix: string | null;
}

// ── Composite overview ───────────────────────────────────────────────────────
export interface OverviewData {
  agents: AgentRow[];
  transitions: TransitionView[];
  registry: RegistryAgentRow[];
  visibility: VisibilityRow[];
  cost: CostView;
  guardrails: SafetyView;
  summary: SummaryView;
  fleet: FleetOverview; // Phase U1/U2: one derived status per task + reconciled KPIs
}
