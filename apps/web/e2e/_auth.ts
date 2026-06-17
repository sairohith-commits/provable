import { setupClerkTestingToken } from '@clerk/testing/playwright';
import type { Page } from '@playwright/test';

const CLERK_API = 'https://api.clerk.com/v1';

async function be(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${CLERK_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

/** Mint a sign-in token (ticket), exchange it for a session, and activate the org. */
export async function signInAndActivate(page: Page, email: string, clerkOrgId: string): Promise<void> {
  const users = (await (await be(`/users?email_address=${encodeURIComponent(email)}`)).json()) as Array<{ id: string }>;
  const { token } = (await (
    await be('/sign_in_tokens', { method: 'POST', body: JSON.stringify({ user_id: users[0]!.id }) })
  ).json()) as { token: string };

  await setupClerkTestingToken({ page });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { Clerk?: { loaded: boolean } }).Clerk?.loaded));
  await page.evaluate(
    async ({ ticket, orgId }) => {
      const clerk = (window as unknown as { Clerk: any }).Clerk;
      const res = await clerk.client.signIn.create({ strategy: 'ticket', ticket });
      await clerk.setActive({ session: res.createdSessionId, organization: orgId });
    },
    { ticket: token, orgId: clerkOrgId },
  );
}
