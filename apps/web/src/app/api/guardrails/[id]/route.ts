import { NextResponse } from 'next/server';
import { setGuardrailRuleEnabled } from '@/lib/api';
import { getAuthContext } from '@/lib/auth';

// Phase W4 — enable/disable a guardrail rule (no delete; disable via enabled). org from the
// verified caller; configure_guardrails enforced API-side.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const ctx = await getAuthContext();
  if (ctx === null) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const { enabled } = (await req.json().catch(() => ({}))) as { enabled?: boolean };
  if (typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled (boolean) is required' }, { status: 400 });
  }
  const r = await setGuardrailRuleEnabled(ctx.orgId, ctx.userId, id, enabled);
  if (!r.ok) return NextResponse.json({ error: 'update failed' }, { status: r.status });
  return NextResponse.json({ ok: true });
}
