import { NextResponse } from 'next/server';
import { getFleet } from '@/lib/api';
import { getAuthContext } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Phase W1 — the onboarding wizard's "waiting for first signal" beat polls this. It proxies the
// REAL fleet read-model (GET /overview/fleet) under the VERIFIED caller's org; the browser never
// holds the internal token. No agent is ever synthesized here — the wizard flips to "Live" only
// when the agentKey actually appears in this response.
export async function GET(): Promise<Response> {
  const ctx = await getAuthContext();
  if (ctx === null) {
    return NextResponse.json({ tasks: [], kpis: { promotableNow: 0, needsAttention: 0, tasksGoverned: 0 } });
  }
  try {
    const fleet = await getFleet(ctx.orgId, ctx.userId);
    return NextResponse.json(fleet);
  } catch {
    return NextResponse.json({ error: 'fleet read failed' }, { status: 502 });
  }
}
