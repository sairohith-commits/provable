import { clerkSetup } from '@clerk/testing/playwright';
import { expect, test } from '@playwright/test';
import { signInAndActivate } from './_auth';

/**
 * Phase 7c — KPI row on real data + the Connect onboarding surface.
 *   • KPI cards bind to GET /summary (real counts).
 *   • Connect shows the masked key prefix + the REAL SDK quickstart (no gateway URL).
 *   • Rotate (Clerk-authed) reveals a show-once key; the OLD machine key dies on /track.
 *   • The live waiting→connected beat reads "connected" with the seeded agent present.
 */
const API = 'http://localhost:3010';
const decision = (ref: string) => ({
  type: 'decision',
  agentKey: 'probe',
  taskKey: 'classify',
  action: {},
  verdict: { kind: 'ACCEPTED' },
  outcome: 'SUCCESS',
  confidence: 0.9,
  source: 'sdk',
  externalRef: ref,
});

test.beforeAll(async () => {
  await clerkSetup();
});

test('KPI row real → Connect → rotate show-once → old key dies → connected', async ({ page }) => {
  test.skip(!process.env.CLERK_SECRET_KEY, 'Clerk dev keys not provided');
  const email = process.env.E2E_CLERK_EMAIL!;
  const orgId = process.env.E2E_CLERK_ORG_ID!;
  const oldKey = process.env.E2E_SUPPORT_KEY!;

  await signInAndActivate(page, email, orgId);

  // KPI row binds to real /summary counts.
  await page.goto('/');
  await expect(page.locator('[data-kpi-row]')).toBeVisible();
  await expect(page.locator('[data-kpi="Active agents"] .kpi-value')).toHaveText(/\d+/);
  await expect(page.locator('[data-kpi="Pending approvals"] .kpi-value')).toHaveText(/\d+/);
  await expect(page.locator('[data-kpi="ROI projection"]')).toContainText('projection');

  // The seeded machine key works on /track BEFORE rotation.
  const pre = await page.request.post(`${API}/track`, {
    headers: { authorization: `Bearer ${oldKey}` },
    data: decision('probe-pre'),
  });
  expect(pre.status()).toBe(200);

  // Connect view: masked prefix + real SDK quickstart, no gateway endpoint.
  await page.goto('/connect');
  const qs = page.locator('[data-quickstart]');
  await expect(qs).toContainText('pip install provable_sdk');
  await expect(qs).toContainText('client.track(');
  await expect(qs).not.toContainText('gateway');
  await expect(page.locator('[data-key-prefix]')).toContainText('pvb_');

  // Live onboarding beat: the seeded agent makes this read "connected".
  await expect(page.locator('[data-connected]')).toBeVisible({ timeout: 15_000 });

  // Rotate (Clerk-authed) → show-once modal with a new key + the invalidation warning.
  await page.getByRole('button', { name: /rotate key/i }).click();
  await expect(page.locator('[data-rotate-modal]')).toBeVisible();
  await expect(page.locator('[data-new-key]')).toContainText(/^pvb_[0-9a-f]+_/);
  await expect(page.locator('[data-rotate-modal]')).toContainText(/invalidated the old key/i);
  // The quickstart now carries the freshly-revealed key.
  await expect(qs).toContainText('pvb_');

  // MOAT: the OLD machine key is dead on /track immediately after rotation.
  const post = await page.request.post(`${API}/track`, {
    headers: { authorization: `Bearer ${oldKey}` },
    data: decision('probe-post'),
  });
  expect(post.status()).toBe(401);
});
