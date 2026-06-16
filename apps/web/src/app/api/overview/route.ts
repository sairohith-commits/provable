import { NextResponse } from 'next/server';
import { getAgents, getTransitions } from '@/lib/api';
import { activeProvableOrg } from '@/lib/org';

export const dynamic = 'force-dynamic';

// Polled by the client overview so a running climb visibly updates (no SSE).
export async function GET() {
  const orgId = await activeProvableOrg();
  if (orgId === null) return NextResponse.json({ agents: [], transitions: [] });
  const [agents, transitions] = await Promise.all([getAgents(orgId), getTransitions(orgId)]);
  return NextResponse.json({ agents, transitions });
}
