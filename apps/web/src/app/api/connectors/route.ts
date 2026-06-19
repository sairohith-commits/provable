import { NextResponse } from 'next/server';
import { createConnector, listConnectors } from '@/lib/api';
import { getAuthContext } from '@/lib/auth';

// Connectors list/create (Phase O3b). The signed-in human's org + subject reach the internal
// connector endpoints; the API re-derives the role (create needs manage_agents). The browser
// never sees the internal token; the credential VALUE is never returned.
export async function GET(): Promise<Response> {
  const ctx = await getAuthContext();
  if (ctx === null) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const connectors = await listConnectors(ctx.orgId, ctx.userId);
    return NextResponse.json({ connectors });
  } catch {
    return NextResponse.json({ error: 'list failed' }, { status: 502 });
  }
}

export async function POST(req: Request): Promise<Response> {
  const ctx = await getAuthContext();
  if (ctx === null) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    mapping?: unknown;
    source?: { url?: string; authHeaderName?: string; authHeaderValue?: string };
  };
  if (typeof body.name !== 'string' || body.name.length === 0) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  const r = await createConnector(ctx.orgId, ctx.userId, {
    name: body.name,
    mapping: body.mapping,
    ...(body.source ? { source: body.source } : {}),
  });
  if (!r.ok) return NextResponse.json({ error: 'create failed' }, { status: r.status });
  return NextResponse.json({ connector: r.connector });
}
