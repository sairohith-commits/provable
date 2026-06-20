import { NextResponse } from 'next/server';
import { createGuardrailRule, listGuardrailRules } from '@/lib/api';
import { getAuthContext } from '@/lib/auth';

// Phase W4 — guardrail rules list/create. The signed-in human's org + subject reach the internal
// endpoints; the API re-derives the role (needs configure_guardrails) and scopes to THAT org. The
// browser never sees the internal token, and the org is never taken from the payload.
export async function GET(): Promise<Response> {
  const ctx = await getAuthContext();
  if (ctx === null) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const rules = await listGuardrailRules(ctx.orgId, ctx.userId);
    return NextResponse.json({ rules });
  } catch {
    return NextResponse.json({ error: 'list failed' }, { status: 502 });
  }
}

export async function POST(req: Request): Promise<Response> {
  const ctx = await getAuthContext();
  if (ctx === null) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    guardrailId?: string;
    reasonTemplate?: string;
    agentKey?: string;
    taskKey?: string;
    verdict?: string;
    outcome?: string;
  };
  if (typeof body.guardrailId !== 'string' || body.guardrailId.length === 0) {
    return NextResponse.json({ error: 'guardrailId is required' }, { status: 400 });
  }
  if (typeof body.reasonTemplate !== 'string' || body.reasonTemplate.length === 0) {
    return NextResponse.json({ error: 'reasonTemplate is required' }, { status: 400 });
  }
  const r = await createGuardrailRule(ctx.orgId, ctx.userId, {
    guardrailId: body.guardrailId,
    reasonTemplate: body.reasonTemplate,
    ...(body.agentKey ? { agentKey: body.agentKey } : {}),
    ...(body.taskKey ? { taskKey: body.taskKey } : {}),
    ...(body.verdict ? { verdict: body.verdict } : {}),
    ...(body.outcome ? { outcome: body.outcome } : {}),
  });
  if (!r.ok) return NextResponse.json({ error: 'create failed' }, { status: r.status });
  return NextResponse.json({ rule: r.rule });
}
