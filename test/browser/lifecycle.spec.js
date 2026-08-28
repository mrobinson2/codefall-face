import { test, expect } from '@playwright/test';

test('embedded faces destroy cleanly and keep instance datasets local', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { CodefallFace } = await import('/src/codefall-face.js');
    const host = document.createElement('div');
    host.id = 'secondary';
    host.style.cssText = 'width:320px;height:320px';
    document.body.appendChild(host);
    const face = new CodefallFace(host, { provider: 'local', face: { seed: 9 } });
    await face.ready;
    face.setTheme('codefall');
    const localTheme = host.dataset.theme;
    const before = host.querySelectorAll('canvas').length;
    const first = face.destroy();
    const second = face.destroy();
    const after = host.querySelectorAll('canvas').length;
    host.remove();
    return { localTheme, before, after, first, second };
  });
  expect(result).toEqual({ localTheme: 'codefall', before: 1, after: 0, first: true, second: false });
});
