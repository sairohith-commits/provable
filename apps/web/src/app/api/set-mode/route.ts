import { NextResponse } from 'next/server';
import { setMode } from '@/lib/api';
import { getAuthContext } from '@/lib/auth';

// Free-set mode (MANUAL_OVERRIDE). The signed-in human's subject (role lookup) + approver (the
// recorded actor) are forwarded; the browser never sees the internal token. The API enforces
// free_set_mode regardless of this proxy.
export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (ctx === null) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { agentKey, taskKey, mode, reason } = (await req.json()) as {
    agentKey?: string;
    taskKey?: string;
    mode?: string;
    reason?: string;
  };
  if (!agentKey || !taskKey || !mode || !reason) {
    return NextResponse.json({ error: 'agentKey, taskKey, mode, reason required' }, { status: 400 });
  }
  const actor = ctx.email ?? ctx.userId;
  const r = await setMode(ctx.orgId, ctx.userId, agentKey, taskKey, mode, reason, actor);
  return NextResponse.json(r.body, { status: r.status });
}
