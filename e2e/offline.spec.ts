import { expect, test } from '@playwright/test';
import { CLEANED, setup } from './mock';

test('works offline after first load: record, queue, run on reconnect', async ({ page, context }) => {
  await setup(page);
  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload(); // now controlled by the service worker
  await page.getByRole('button', { name: /start a session/i }).click();
  await expect(page.getByText('Think out loud')).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Think out loud')).toBeVisible();
  await expect(page.getByText('Offline', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.getByText('Waiting for a connection')).toBeVisible({ timeout: 10_000 });
  await context.setOffline(false);
  await expect(page.getByText(CLEANED)).toBeVisible({ timeout: 15_000 });
});

test('search finds material and opens the entry', async ({ page }) => {
  await setup(page);
  await page.goto('./');
  await page.getByRole('button', { name: /start a session/i }).click();
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.getByText(CLEANED)).toBeVisible({ timeout: 15_000 });
  await page.goto('./#/search?q=bike%20lanes');
  const hit = page.getByRole('button', { name: /bike lanes/ }).first();
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(page.getByText(CLEANED)).toBeVisible();
  expect(page.url()).toContain('?e=');
});

test('connect starts OAuth PKCE with a callback to this app', async ({ page }) => {
  await page.route('https://openrouter.ai/api/v1/models**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }));
  let authUrl = '';
  await page.route('https://openrouter.ai/auth**', (r) => {
    authUrl = r.request().url();
    return r.fulfill({ status: 200, contentType: 'text/html', body: '<p>OpenRouter sign-in (mock)</p>' });
  });
  await page.goto('./#/settings/connection');
  await page.getByRole('button', { name: 'Connect OpenRouter' }).click();
  await expect(page.getByText('OpenRouter sign-in (mock)')).toBeVisible();
  const u = new URL(authUrl);
  expect(u.searchParams.get('callback_url')).toBe('http://localhost:4173/');
  expect(u.searchParams.get('code_challenge_method')).toBe('S256');
  expect(u.searchParams.get('code_challenge')!.length).toBeGreaterThan(40);
  expect(u.searchParams.get('state')).toBeTruthy();
});
