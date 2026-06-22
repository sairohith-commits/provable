import { NextResponse } from 'next/server';
import { suspend } from '@/lib/api';
import { getAuthContext } from '@/lib/auth';

// Kill-switch suspend (ADVISORY — recorded + audited, NOT enforced at the gateway yet; Phase 2).
// taskKey present ⇒ per-task; taskKey omitted/null ⇒ agent-wide. The signed-in human's subject
// (role lookup) + approver (recorded actor) are forwarded; the browser never sees the internal
// token. The API enforces suspend_agent regardless of this proxy.
export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (ctx === null) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { agentKey, taskKey, reason } = (await req.json()) as {
    agentKey?: string;
    taskKey?: string | null;
    reason?: string;
  };
  if (!agentKey || !reason || reason.trim().length === 0) {
    return NextResponse.json({ error: 'agentKey and reason required' }, { status: 400 });
  }
  const actor = ctx.email ?? ctx.userId;
  const r = await suspend(ctx.orgId, ctx.userId, agentKey, taskKey ?? null, reason.trim(), actor);
  return NextResponse.json(r.body, { status: r.status });
}
