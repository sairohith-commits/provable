import { NextResponse } from 'next/server';
import { pullConnector } from '@/lib/api';
import { getAuthContext } from '@/lib/auth';

// Pull-now (Phase O3b): trigger a manual pull for a connector; the API enforces manage_agents and
// SSRF-guards the source URL. Returns the ingest summary (mapped / governed / observe-only / errors).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const ctx = await getAuthContext();
  if (ctx === null) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const r = await pullConnector(ctx.orgId, ctx.userId, id);
  return NextResponse.json(r.body, { status: r.status });
}
