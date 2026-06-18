import { NextResponse } from 'next/server';
import { revokeKey } from '@/lib/api';
import { getAuthContext } from '@/lib/auth';

// Revoke an org key by prefix (manage_keys, enforced API-side). Immediate: a revoked key dies
// on its next request. The browser never sees the internal token.
export async function DELETE(_req: Request, ctx: { params: Promise<{ prefix: string }> }) {
  const auth = await getAuthContext();
  if (auth === null) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { prefix } = await ctx.params;
  const r = await revokeKey(auth.orgId, auth.userId, prefix);
  if (!r.ok) return NextResponse.json({ error: 'revoke failed' }, { status: r.status });
  return NextResponse.json({ ok: true });
}
