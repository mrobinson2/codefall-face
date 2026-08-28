import { test, expect } from '@playwright/test';

test('deck is keyboard reachable and uses explicit state semantics', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const focused = page.locator(':focus');
  await expect(focused).toBeVisible();
  await expect(page.locator('#console-toggle')).toHaveAttribute('aria-expanded', /true|false/);
  await expect(page.locator('#live-status')).toHaveAttribute('aria-live', 'polite');
  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewport).not.toContain('user-scalable=no');
});

test('320px layout has no horizontal overflow and targets remain large', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/');
  const metrics = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    targets: [...document.querySelectorAll('button, select, input')]
      .filter((element) => getComputedStyle(element).display !== 'none')
      .map((element) => element.getBoundingClientRect().height),
  }));
  expect(metrics.overflow).toBeLessThanOrEqual(0);
  expect(Math.min(...metrics.targets)).toBeGreaterThanOrEqual(44);
});
