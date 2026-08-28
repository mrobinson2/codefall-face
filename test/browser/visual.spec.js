import { test, expect } from '@playwright/test';

for (const scene of [
  ['wintermute-chiseled-neutral', '/?theme=wintermute&geometry=chiseled&emotion=neutral'],
  ['wintermute-smooth-speech', '/?theme=wintermute&geometry=smooth&pose=talk'],
  ['codefall-chiseled-anger', '/?theme=codefall&geometry=chiseled&emotion=anger'],
]) {
  test(`visual scene ${scene[0]} renders a non-empty canvas`, async ({ page }) => {
    await page.goto(scene[1]);
    await page.waitForFunction(() => window.codefall?.state === 'idle');
    const canvas = page.locator('#stage canvas');
    await expect(canvas).toBeVisible();
    const sample = await canvas.evaluate((element) => {
      const pixels = element.getContext('2d').getImageData(0, 0, element.width, element.height).data;
      let lit = 0;
      for (let i = 0; i < pixels.length; i += 64) if (pixels[i] || pixels[i + 1] || pixels[i + 2]) lit++;
      return lit;
    });
    expect(sample).toBeGreaterThan(20);
  });
}
