import { NextResponse } from 'next/server';
import { approve } from '@/lib/api';
import { activeProvableOrg, currentApprover } from '@/lib/org';

// Clerk-authed approve: the signed-in human is forwarded as the approver to the API's
// internal/Clerk-only approve endpoint. The browser never sees the internal token.
export async function POST(req: Request) {
  const [orgId, approver] = await Promise.all([activeProvableOrg(), currentApprover()]);
  if (orgId === null || approver === null) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { agentKey, taskKey } = (await req.json()) as { agentKey?: string; taskKey?: string };
  if (typeof agentKey !== 'string' || typeof taskKey !== 'string') {
    return NextResponse.json({ error: 'agentKey and taskKey required' }, { status: 400 });
  }
  const result = await approve(orgId, agentKey, taskKey, approver);
  return NextResponse.json(result.body, { status: result.status });
}
