import { NextResponse } from 'next/server';
import { dryRunConnector } from '@/lib/api';
import { getAuthContext } from '@/lib/auth';

// Dry-run preview (Phase O3b): run the REAL O3a applyMapping on a pasted sample WITHOUT ingesting.
// Returns the mapped event + governed flag from the engine — the UI never reimplements this.
export async function POST(req: Request): Promise<Response> {
  const ctx = await getAuthContext();
  if (ctx === null) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { mapping, sample } = (await req.json().catch(() => ({}))) as { mapping?: unknown; sample?: unknown };
  const r = await dryRunConnector(ctx.orgId, ctx.userId, mapping, sample);
  return NextResponse.json(r);
}
