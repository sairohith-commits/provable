import { NextResponse } from 'next/server';
import { mintGatewayKey } from '@/lib/api';
import { getAuthContext } from '@/lib/auth';

// Authed Tier-1 gateway-key mint (Phase O2): the signed-in human's org + subject reach the
// internal endpoint; the API enforces manage_keys (OWNER). The browser never sees the internal
// token. Body: { agentKey, taskKey }. The plaintext key is returned ONCE.
export async function POST(req: Request): Promise<Response> {
  const ctx = await getAuthContext();
  if (ctx === null) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { agentKey?: string; taskKey?: string };
  const agentKey = typeof body.agentKey === 'string' ? body.agentKey.trim() : '';
  const taskKey = typeof body.taskKey === 'string' ? body.taskKey.trim() : '';
  if (agentKey.length === 0 || taskKey.length === 0) {
    return NextResponse.json({ error: 'agentKey and taskKey are required' }, { status: 400 });
  }
  const r = await mintGatewayKey(ctx.orgId, ctx.userId, agentKey, taskKey);
  if (!r.ok) return NextResponse.json({ error: 'mint failed' }, { status: r.status });
  return NextResponse.json({ key: r.key, prefix: r.prefix, agentKey: r.agentKey, taskKey: r.taskKey });
}
