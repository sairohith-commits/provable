import { NextResponse } from 'next/server';
import { resume } from '@/lib/api';
import { getAuthContext } from '@/lib/auth';

// Kill-switch resume — route-driven recovery to OBSERVING (the auto-engine never self-resumes).
// taskKey present ⇒ per-task; taskKey omitted/null ⇒ agent-wide (clears the durable marker). The
// browser never sees the internal token; the API enforces suspend_agent regardless of this proxy.
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
  const r = await resume(ctx.orgId, ctx.userId, agentKey, taskKey ?? null, reason.trim(), actor);
  return NextResponse.json(r.body, { status: r.status });
}
