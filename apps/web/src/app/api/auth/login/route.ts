import { NextResponse } from 'next/server';
import { activeProviderType } from '@/lib/auth/config';
import { sessionCookieOptions } from '@/lib/auth/cookie-options';
import { verifyLocalCredentials } from '@/lib/auth/local/credential';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, createSession } from '@/lib/auth/session';

// Local seeded-admin login (Node runtime: bcryptjs). Constant-time credential check; on
// success mint the signed session cookie. 303 so the form POST lands on a GET.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  if (activeProviderType() !== 'local') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const form = await req.formData();
  const email = String(form.get('email') ?? '');
  const password = String(form.get('password') ?? '');
  const identity = await verifyLocalCredentials(email, password);
  if (identity === null) {
    return NextResponse.redirect(new URL('/login?error=1', req.url), 303);
  }
  const token = await createSession({
    sub: identity.userId,
    email: identity.email,
    name: identity.displayName,
    provider: 'local',
  });
  const res = NextResponse.redirect(new URL('/', req.url), 303);
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_TTL_SECONDS));
  return res;
}
