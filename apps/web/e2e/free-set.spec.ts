import { expect, test } from '@playwright/test';

/**
 * Phase U3 — the free-set (MANUAL_OVERRIDE) slide-over.
 * PREREQUISITES: a running web+api stack, Owner session, a seeded fleet with a `prioritize/triage`
 * task whose score implies a band ABOVE Shadow (so a Shadow override → HELD). Skips if unreachable.
 */
test.beforeEach(async ({ page }) => {
  const res = await page.goto('/');
  test.skip(res === null || !res.ok(), 'web shell not reachable — needs the seeded stack');
});

test('reason is required, submit posts NO score, and the row reads HELD after a below-band set', async ({ page }) => {
  const row = page.locator('[data-task="prioritize:triage"]');
  await expect(row).toBeVisible();

  // Open the free-set panel from the row's "Set mode" affordance.
  await row.locator('[data-set-mode]').click();
  const sheet = page.locator('[data-sheet]');
  await expect(sheet).toBeVisible();

  // Empty reason blocks submit.
  await expect(sheet.locator('[data-fs-submit]')).toBeDisabled();

  // Choose a mode below the implied band, give a reason → submit enabled.
  await sheet.locator('[data-fs-mode]').selectOption('SHADOW');
  await sheet.locator('[data-fs-reason]').fill('holding below earned for review');
  await expect(sheet.locator('[data-fs-submit]')).toBeEnabled();

  // Assert the POST body carries NO `score` field (effectiveMode-only).
  const [req] = await Promise.all([
    page.waitForRequest((r) => r.url().includes('/api/set-mode') && r.method() === 'POST'),
    sheet.locator('[data-fs-submit]').click(),
  ]);
  const body = req.postDataJSON() as Record<string, unknown>;
  expect(body).toMatchObject({ agentKey: 'prioritize', taskKey: 'triage', mode: 'SHADOW' });
  expect(body).not.toHaveProperty('score');

  // After refresh, the row recomputes to HELD (overridden below its implied band).
  await expect(row.locator('.status-chip[data-status="HELD"]')).toBeVisible();
  await expect(row.locator('[data-approve]')).toHaveCount(0);
});
