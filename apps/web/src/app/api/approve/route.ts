import { NextResponse } from 'next/server';
import { approve } from '@/lib/api';
import { getAuthContext } from '@/lib/auth';

// Authed approve: the signed-in human's subject (for the API's authoritative permission check)
// and approver are forwarded to the internal-only approve endpoint. The browser never sees the
// internal token; the API enforces the approve_transition permission regardless of this proxy.
export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (ctx === null) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { agentKey, taskKey } = (await req.json()) as { agentKey?: string; taskKey?: string };
  if (typeof agentKey !== 'string' || typeof taskKey !== 'string') {
    return NextResponse.json({ error: 'agentKey and taskKey required' }, { status: 400 });
  }
  const approver = ctx.email ?? ctx.userId;
  const result = await approve(ctx.orgId, ctx.userId, agentKey, taskKey, approver);
  return NextResponse.json(result.body, { status: result.status });
}
