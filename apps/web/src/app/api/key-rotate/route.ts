import { NextResponse } from 'next/server';
import { rotateKey } from '@/lib/api';
import { activeProvableOrg, currentApprover } from '@/lib/org';

// Clerk-authed key rotate: the signed-in human's org (from the VERIFIED session) is the only
// thing that reaches the API's internal rotate endpoint. The browser never sees the internal
// token; a machine key has no path here.
export async function POST() {
  const [orgId, approver] = await Promise.all([activeProvableOrg(), currentApprover()]);
  if (orgId === null || approver === null) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const r = await rotateKey(orgId, approver);
  if (!r.ok) return NextResponse.json({ error: 'rotate failed' }, { status: r.status });
  return NextResponse.json({ key: r.key, prefix: r.prefix });
}
