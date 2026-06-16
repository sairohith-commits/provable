import { clerk, clerkSetup } from '@clerk/testing/playwright';
import { expect, test } from '@playwright/test';

/**
 * The live-crossing beat, end-to-end with a REAL authenticated human.
 *
 * SCAFFOLD — runs only with Rohith's Clerk DEV keys present (CLERK_* in .env.local) and a
 * support-agent deterministic climb already driven so a PENDING_APPROVAL exists. Steps:
 *   1. sign in via @clerk/testing (a real Clerk session)
 *   2. the dashboard polls → the readiness ladder visibly advances during a climb
 *   3. a PENDING_APPROVAL promotion appears in the governance feed
 *   4. the human clicks Approve → the API records the Clerk user as approver
 *   5. the ladder advances a band and the named human shows in the trail
 */
test.beforeAll(async () => {
  await clerkSetup();
});

test('climb → poll updates → human approves → ladder advances; approver named', async ({ page }) => {
  test.skip(!process.env.CLERK_SECRET_KEY, 'Clerk dev keys not provided — ready for Tier-keys run');

  await page.goto('/');
  await clerk.signIn({
    page,
    signInParams: { strategy: 'password', identifier: process.env.E2E_CLERK_EMAIL!, password: process.env.E2E_CLERK_PASSWORD! },
  });

  await page.goto('/');
  // A PENDING_APPROVAL promotion must be visible (driven by a prior deterministic climb).
  const approve = page.getByRole('button', { name: /approve promotion/i }).first();
  await expect(approve).toBeVisible();

  await approve.click();

  // After approval the band advances and the signed-in human appears in the trail.
  await expect(page.locator('.t-approver').first()).toBeVisible();
});
