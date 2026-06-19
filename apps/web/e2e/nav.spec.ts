import { expect, test } from '@playwright/test';

/**
 * Phase U3 — left-sidebar nav routes to the right pillar and marks the active item.
 * PREREQUISITES: a running web+api stack with an Owner session (AUTH_PROVIDER=local is fine).
 * Skips if the shell isn't reachable so a bare CI run never red-fails.
 */
const PILLARS: { nav: string; path: string }[] = [
  { nav: 'overview', path: '/' },
  { nav: 'activity', path: '/activity' },
  { nav: 'safety', path: '/safety' },
  { nav: 'cost', path: '/cost' },
  { nav: 'registry', path: '/registry' },
];

test.beforeEach(async ({ page }) => {
  const res = await page.goto('/');
  test.skip(res === null || !res.ok(), 'web shell not reachable — needs the running stack');
  await expect(page.locator('[data-sidebar]')).toBeVisible();
});

for (const { nav, path } of PILLARS) {
  test(`sidebar → ${nav} routes to ${path} and marks it active`, async ({ page }) => {
    await page.locator(`[data-nav="${nav}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${path === '/' ? '/$' : path}`));
    await expect(page.locator(`[data-nav="${nav}"]`)).toHaveClass(/active/);
    await expect(page.locator(`[data-nav="${nav}"]`)).toHaveAttribute('aria-current', 'page');
  });
}

test('sidebar collapses to an icon rail', async ({ page }) => {
  await page.locator('[data-sidebar-toggle]').click();
  await expect(page.locator('[data-sidebar]')).toHaveClass(/collapsed/);
});
