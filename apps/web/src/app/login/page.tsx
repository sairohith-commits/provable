import { redirect } from 'next/navigation';
import { activeProviderType } from '@/lib/auth/config';

// Login surface for the self-hosted providers. Clerk has its own header sign-in widget, so under
// Clerk this route just bounces home.
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const type = activeProviderType();
  if (type === 'clerk') redirect('/');

  const { error } = await searchParams;
  const errorText =
    error === undefined
      ? null
      : error === 'session'
        ? 'Your login session expired — please try again.'
        : 'Sign-in failed. Check your credentials and try again.';

  if (type === 'oidc') {
    return (
      <div className="empty card glass">
        {errorText !== null && <p className="auth-error">{errorText}</p>}
        <a className="nav-link" href="/api/auth/start">
          Continue with single sign-on
        </a>
      </div>
    );
  }

  // local
  return (
    <form method="post" action="/api/auth/login" className="card glass login-form">
      <h1 className="login-title">Sign in</h1>
      {errorText !== null && <p className="auth-error">{errorText}</p>}
      <label>
        Email
        <input name="email" type="email" autoComplete="username" required />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      <button type="submit" className="nav-link">
        Sign in
      </button>
    </form>
  );
}
