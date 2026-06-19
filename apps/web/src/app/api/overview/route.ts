import { NextResponse } from 'next/server';
import { loadOverview } from '@/lib/overview';
import { getAuthContext } from '@/lib/auth';
import type { OverviewData } from '@/lib/types';

export const dynamic = 'force-dynamic';

const ROI_EMPTY = {
  isProjection: true as const,
  label: 'Projection - proven savings IF Shadow agents are promoted to operate',
  assumptions: { assumedHumanMinutesPerDecision: 5, assumedHumanHourlyUsd: 45 },
  humanCostPerDecisionUsd: 0,
  agentCostPerDecisionUsd: 0,
  costDeltaPerDecisionUsd: 0,
  shadowDecisionVolume: 0,
  projectedSavingsIfPromotedUsd: 0,
};

const EMPTY: OverviewData = {
  agents: [],
  transitions: [],
  registry: [],
  visibility: [],
  cost: {
    tasks: [],
    org: { decisionCount: 0, tokens: 0, usd: 0, avgLatencyMs: null, hasCostSignal: false },
    roi: ROI_EMPTY,
  },
  guardrails: { events: [], suspended: [] },
  summary: {
    activeAgents: 0,
    agentsTotal: 0,
    pendingApprovals: 0,
    suspendedCount: 0,
    guardrailEventCount: 0,
    decisionCount: 0,
    tokenSpend: 0,
    usdSpend: 0,
    hasCostSignal: false,
    roi: ROI_EMPTY,
    apiKeyPrefix: null,
  },
  fleet: { tasks: [], kpis: { promotableNow: 0, needsAttention: 0, tasksGoverned: 0 } },
};

// Polled by the client overview so a running climb visibly updates (no SSE).
export async function GET() {
  const ctx = await getAuthContext();
  if (ctx === null) return NextResponse.json(EMPTY);
  return NextResponse.json(await loadOverview(ctx.orgId, ctx.userId));
}
