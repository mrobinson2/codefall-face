import { test, expect } from '@playwright/test';

test('deterministic scene stays finite and within broad update guard', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    const face = window.codefall;
    const started = performance.now();
    let finite = true;
    for (let i = 0; i < 300; i++) {
      const frame = face.runtime.tick(1 / 60);
      finite &&= Object.values(frame.dyn).every(Number.isFinite);
    }
    return {
      finite,
      elapsed: performance.now() - started,
      snapshot: face.getSnapshot(),
    };
  });
  expect(result.finite).toBe(true);
  expect(result.elapsed).toBeLessThan(100);
  expect(['low', 'medium', 'high']).toContain(result.snapshot.rendering.tier);
});
