import { test } from '@playwright/test';
import { setup } from './mock';

// Screenshots for manual review (not assertions).
test('screens', async ({ page }, info) => {
  await setup(page);
  await page.goto('./');
  await page.getByRole('button', { name: /start a session/i }).click();
  await page.getByRole('textbox', { name: 'Message' }).fill('Hello');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForTimeout(500);
  const n = info.project.name;
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('./#/');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `test-results/shots/${n}-home-${scheme}.png` });
    await page.goto('./#/settings');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `test-results/shots/${n}-settings-${scheme}.png` });
  }
  const group = await page.evaluate(() => location.hash);
  void group;
});
