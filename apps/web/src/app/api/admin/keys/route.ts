import { NextResponse } from 'next/server';
import { mintKey } from '@/lib/api';
import { getAuthContext } from '@/lib/auth';

// Mint a new org key (manage_keys, enforced API-side). The plaintext is returned once; the
// browser never sees the internal token. A machine key has no path here.
export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (ctx === null) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { label } = (await req.json().catch(() => ({}))) as { label?: string };
  const r = await mintKey(ctx.orgId, ctx.userId, typeof label === 'string' ? label : undefined);
  if (!r.ok) return NextResponse.json({ error: 'mint failed' }, { status: r.status });
  return NextResponse.json({ key: r.key, prefix: r.prefix });
}
