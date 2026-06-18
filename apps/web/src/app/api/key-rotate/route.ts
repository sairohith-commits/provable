import { NextResponse } from 'next/server';
import { rotateKey } from '@/lib/api';
import { getAuthContext } from '@/lib/auth';

// Authed key rotate: the signed-in human's org + subject reach the internal rotate endpoint;
// the API enforces the manage_keys permission (OWNER). The browser never sees the internal
// token; a machine key has no path here.
export async function POST() {
  const ctx = await getAuthContext();
  if (ctx === null) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const approver = ctx.email ?? ctx.userId;
  const r = await rotateKey(ctx.orgId, ctx.userId, approver);
  if (!r.ok) return NextResponse.json({ error: 'rotate failed' }, { status: r.status });
  return NextResponse.json({ key: r.key, prefix: r.prefix });
}
