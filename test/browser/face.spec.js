import { test, expect } from '@playwright/test';

test('face boots and public controls remain operational', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?emotion=neutral');
  await page.waitForFunction(() => window.codefall?.state === 'idle');
  await expect(page.locator('#status')).toContainText('IDLE');
  await page.getByRole('button', { name: /face geometry/i }).click();
  await expect(page.locator('#stage')).toHaveAttribute('data-geometry', 'smooth');
  await page.getByRole('button', { name: /theme:/i }).click();
  await expect(page.locator('#stage')).toHaveAttribute('data-theme', 'codefall');
  expect(errors).toEqual([]);
});

test('quality and breach controls update the snapshot', async ({ page }) => {
  await page.goto('/');
  await page.locator('#quality').selectOption('low');
  await page.locator('#visual-intensity').selectOption('1');
  const snapshot = await page.evaluate(() => window.codefall.getSnapshot());
  expect(snapshot.rendering.tier).toBe('low');
  expect(snapshot.rendering.visualIntensity).toBe(1);
});
