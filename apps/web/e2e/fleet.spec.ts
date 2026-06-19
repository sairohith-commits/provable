import { expect, test } from '@playwright/test';

/**
 * Phase U2 — fleet readiness rows render one status per task, and the approve affordance is
 * structurally impossible unless the task is actionable.
 *
 * PREREQUISITES (this is a live DOM test against a seeded fleet — no Clerk required):
 *   • api on :3010 and web on :3020 (WEB_BASE_URL), AUTH_PROVIDER=local, signed in as an Owner.
 *   • a seeded fleet in the workspace org with these four tasks:
 *       vision/caption     → DEGRADED   (PENDING then SIGNAL_LOSS demotion — the U1 vision-agent)
 *       billing/charge     → SUSPENDED  (guardrail)
 *       prioritize/triage  → PROMOTABLE (clean climb to a live PENDING_APPROVAL)
 *       classify/intent    → HELD       (manual override below the earned band)
 * Skips if the fleet isn't reachable, so it never fails a bare CI run.
 */
const ROW = (agent: string, task: string) => `[data-task="${agent}:${task}"]`;

test.beforeEach(async ({ page }) => {
  const res = await page.goto('/');
  test.skip(res === null || !res.ok(), 'web/fleet not reachable — needs the seeded local stack');
});

test('vision-agent → DEGRADED chip and ZERO approve affordance on the row', async ({ page }) => {
  const row = page.locator(ROW('vision', 'caption'));
  await expect(row).toBeVisible();
  await expect(row.locator('.status-chip[data-status="DEGRADED"]')).toBeVisible();
  // The integrity assertion: no approve button anywhere on the row.
  await expect(row.locator('[data-approve]')).toHaveCount(0);
});

test('billing-agent → SUSPENDED chip + lock, no approve', async ({ page }) => {
  const row = page.locator(ROW('billing', 'charge'));
  await expect(row.locator('.status-chip[data-status="SUSPENDED"]')).toBeVisible();
  await expect(row.locator('[data-lock]')).toBeVisible(); // danger lock overlay
  await expect(row.locator('[data-approve]')).toHaveCount(0);
});

test('prioritize → PROMOTABLE chip + "Review promotion" button present', async ({ page }) => {
  const row = page.locator(ROW('prioritize', 'triage'));
  await expect(row.locator('.status-chip[data-status="PROMOTABLE"]')).toBeVisible();
  const approve = row.locator('[data-approve]');
  await expect(approve).toHaveCount(1);
  await expect(approve).toHaveText(/review promotion/i);
});

test('classify → HELD chip, "Review" link, no approve', async ({ page }) => {
  const row = page.locator(ROW('classify', 'intent'));
  await expect(row.locator('.status-chip[data-status="HELD"]')).toBeVisible();
  await expect(row.locator('[data-row-link="review"]')).toBeVisible();
  await expect(row.locator('[data-approve]')).toHaveCount(0);
});
