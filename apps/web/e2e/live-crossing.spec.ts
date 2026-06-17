import { clerkSetup, setupClerkTestingToken } from '@clerk/testing/playwright';
import { expect, test } from '@playwright/test';

/**
 * The live-crossing beat, end-to-end with a REAL authenticated human.
 *
 * Runs with Rohith's Clerk DEV keys (CLERK_* in env) + a deterministic support climb already
 * driven so a PENDING_APPROVAL exists. Auth uses a Backend-API sign-in token (ticket) so it is
 * independent of which first-factor (password/OTP) the dev instance enables. Steps:
 *   1. mint a fresh sign-in token for the test user, exchange it for a real Clerk session
 *   2. activate the Clerk org so the verified session carries orgId → resolves the Provable org
 *   3. the dashboard renders REAL data (agent rows + readiness ladder + governance feed) — no mock
 *   4. a PENDING_APPROVAL promotion appears → the human clicks Approve (Clerk-authed)
 *   5. the API records the Clerk user as approver; the immutable trail names them
 */

const CLERK_API = 'https://api.clerk.com/v1';

async function clerkBackend(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${CLERK_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

test.beforeAll(async () => {
  await clerkSetup();
});

test('climb → reads render real data → human approves → approver named in trail', async ({
  page,
}) => {
  test.skip(!process.env.CLERK_SECRET_KEY, 'Clerk dev keys not provided — ready for Tier-keys run');
  const email = process.env.E2E_CLERK_EMAIL!;
  const clerkOrgId = process.env.E2E_CLERK_ORG_ID!;

  // Resolve the test user by email and mint a fresh single-use sign-in token (ticket).
  const usersRes = await clerkBackend(`/users?email_address=${encodeURIComponent(email)}`);
  const users = (await usersRes.json()) as Array<{ id: string }>;
  expect(users.length, `test user ${email} must exist`).toBeGreaterThan(0);
  const userId = users[0]!.id;

  const tokenRes = await clerkBackend('/sign_in_tokens', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
  });
  const { token } = (await tokenRes.json()) as { token: string };
  expect(token, 'sign-in token minted').toBeTruthy();

  // Clear bot protection for this page, then exchange the ticket for a real session.
  await setupClerkTestingToken({ page });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { Clerk?: { loaded: boolean } }).Clerk?.loaded));

  await page.evaluate(async ({ ticket, orgId }) => {
    const clerk = (window as unknown as { Clerk: any }).Clerk;
    const res = await clerk.client.signIn.create({ strategy: 'ticket', ticket });
    await clerk.setActive({ session: res.createdSessionId, organization: orgId });
  }, { ticket: token, orgId: clerkOrgId });

  await page.goto('/');

  // Reads render REAL data: agent rows with the readiness ladder, and the governance feed.
  await expect(page.locator('.agent-row').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.ladder').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Governance' })).toBeVisible();

  // All 5 pillars render (real data, no mock).
  for (const section of ['readiness', 'governance', 'visibility', 'cost', 'guardrails', 'registry']) {
    await expect(page.locator(`[data-section="${section}"]`)).toBeVisible();
  }

  // Guardrails render REAL safety events (seeded): a GUARDRAIL trip and a SIGNAL_LOSS demotion.
  const guardrails = page.locator('[data-section="guardrails"]');
  await expect(guardrails.locator('[data-trigger="GUARDRAIL"]').first()).toBeVisible();
  await expect(guardrails.locator('[data-trigger="SIGNAL_LOSS"]').first()).toBeVisible();

  // ROI integrity: the savings figure renders WITH its assumptions, labeled a projection.
  await expect(page.locator('.roi[data-projection="true"] .roi-figure')).toBeVisible();
  await expect(page.locator('.roi .roi-assumptions')).toBeVisible();

  // The two-marker ladder renders the asymmetry: classify has a gap (Co-Pilot vs Solo).
  await expect(page.locator('.marker-effective').first()).toBeVisible();
  await expect(page.locator('.marker-implied').first()).toBeVisible();

  // Persona lens reorders the SAME data: count agents, switch to Legal, re-count → unchanged.
  const agentCountBefore = await page.locator('[data-section="readiness"] .agent-row').count();
  await page.locator('button[data-persona="Legal"]').click();
  // Legal leads with the governance/audit feed.
  const firstSection = await page.locator('.pillar').first().getAttribute('data-section');
  expect(firstSection).toBe('governance');
  const agentCountAfter = await page.locator('[data-section="readiness"] .agent-row').count();
  expect(agentCountAfter).toBe(agentCountBefore); // lens reorders, never invents/drops data

  // A PENDING_APPROVAL promotion (driven by the deterministic climb) → an Approve button.
  await page.locator('button[data-persona="All"]').click();
  const approve = page.getByRole('button', { name: /approve promotion/i }).first();
  await expect(approve).toBeVisible();
  await approve.click();

  // After approval the immutable trail names the signed-in human as approver (a human name,
  // not a raw user_ id — Readiness fix #2).
  const approver = page.locator('.t-approver').first();
  await expect(approver).toBeVisible({ timeout: 15_000 });
  await expect(approver).not.toContainText('user_');
});
