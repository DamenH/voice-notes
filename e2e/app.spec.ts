import { execSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { setup } from './mock';

test('settings page scrolls inside the main pane only', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop layout');
  await setup(page);
  await page.goto('./#/settings');
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  const { doc, view } = await page.evaluate(() => ({ doc: document.documentElement.scrollHeight, view: innerHeight }));
  expect(doc).toBeLessThanOrEqual(view);
});

test('check for updates installs a new build and keeps data', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one browser is enough');
  await setup(page);
  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.getByRole('button', { name: /start a session/i }).click();
  await expect(page.getByText('Think out loud')).toBeVisible();
  await page.goto('./#/settings/app');
  const before = await page.getByText(/· build /).innerText();

  // Publish a new build to the running server.
  execSync('npx vite build --logLevel silent', { env: { ...process.env, VN_BUILD_ID: 'e2e-next-build' } });

  await page.getByRole('button', { name: 'Check for updates' }).click();
  await page.getByRole('button', { name: 'Update now' }).click();
  await expect(page.getByText(/build e2e-next-build/)).toBeVisible({ timeout: 15_000 });
  expect(before).not.toContain('e2e-next-build');
  // Library and connection survived.
  await expect(page.getByText(/Connected with an API key/)).toBeVisible();
  await page.goto('./#/');
  await expect(page.getByRole('link', { name: /Notes/ }).first()).toBeVisible();
});

test('export a session as text, then delete it from the list', async ({ page }) => {
  await setup(page);
  await page.goto('./');
  await page.getByRole('button', { name: /start a session/i }).click();
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.getByText(/main argument is that cities/)).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Session options' }).click();
  await page.getByRole('menuitem', { name: 'Export…' }).click();
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /^Text/ }).click()]);
  expect(file.suggestedFilename()).toMatch(/\.md$/);
  const text = await (await file.createReadStream()).toArray();
  expect(Buffer.concat(text).toString()).toContain('main argument is that cities');

  await page.goto('./#/');
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: /^Actions for/ }).first().click();
  await page.getByRole('menuitem', { name: 'Delete session' }).click();
  await expect(page.getByText('Session deleted')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent sessions' })).toHaveCount(0);
});
