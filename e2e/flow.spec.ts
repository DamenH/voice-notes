import { expect, test } from '@playwright/test';
import { CLEANED, setup } from './mock';

test('record, stop, and get a cleaned transcript automatically', async ({ page }, info) => {
  const calls = await setup(page);
  await page.goto('./');
  await page.getByRole('button', { name: /start a session/i }).click();
  await expect(page.getByText('Think out loud')).toBeVisible();
  await page.screenshot({ path: `test-results/shots/${info.project.name}-01-empty-session.png` });

  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByRole('group', { name: 'Recording' })).toBeVisible();
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `test-results/shots/${info.project.name}-02-recording.png` });
  await page.getByRole('button', { name: 'Stop recording' }).click();

  // The default pipeline runs on stop: transcribe, then clean up.
  await expect(page.getByText(CLEANED)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /Transcribed · Cleaned up/ })).toBeVisible();
  // The raw transcript is collapsed until asked for.
  await expect(page.getByText('um, that cities should invest')).toHaveCount(0);
  await page.screenshot({ path: `test-results/shots/${info.project.name}-03-cleaned.png` });

  const stt = calls.find((c) => c.path === 'audio/transcriptions')!;
  expect((stt.body.input_audio as { format: string }).format).toBe('wav');
  const audioBytes = Buffer.from((stt.body.input_audio as { data: string }).data, 'base64');
  // ~3.5 s of 16 kHz 16-bit mono WAV, actually captured from the fake microphone.
  expect(audioBytes.length).toBeGreaterThan(16000 * 2 * 2);
  const pcm = new Int16Array(audioBytes.buffer, audioBytes.byteOffset + 44, Math.floor((audioBytes.length - 44) / 2));
  expect(pcm.some((s) => Math.abs(s) > 500)).toBe(true);

  await page.getByRole('button', { name: /Transcribed · Cleaned up/ }).click();
  await expect(page.getByText('um, that cities should invest')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `test-results/shots/${info.project.name}-04-details.png` });

  // Survives a reload: the recording plays from local storage.
  await page.reload();
  await expect(page.getByText(CLEANED)).toBeVisible();
  await page.getByRole('button', { name: 'Play recording' }).click();
  await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible();
});

test('pipeline control opens inline and switches to Inkling', async ({ page }, info) => {
  await setup(page);
  await page.goto('./');
  await page.getByRole('button', { name: /start a session/i }).click();
  await page.getByRole('button', { name: /On stop: Transcribe, then Clean up/ }).click();
  await expect(page.getByRole('heading', { name: 'Steps' })).toBeVisible();
  await page.getByRole('button', { name: 'Language practice' }).click();
  await expect(page.getByText('Inkling hears the audio itself')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `test-results/shots/${info.project.name}-05-pipeline.png` });
  if (info.project.name === 'mobile') await page.getByRole('button', { name: 'Close' }).click();
  else await page.getByRole('button', { name: 'Close panel' }).click();
  await expect(page.getByRole('button', { name: /On stop: Transcribe, then Inkling, then Language feedback/ })).toBeVisible();
});

test('failures stay visible and retry resumes', async ({ page }) => {
  await setup(page, { failTranscription: true });
  await page.goto('./');
  await page.getByRole('button', { name: /start a session/i }).click();
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'failed' })).toBeVisible({ timeout: 15_000 });
  await page.unroute('https://openrouter.ai/**');
  await setup(page);
  await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText(CLEANED)).toBeVisible({ timeout: 15_000 });
});

test('chat with Big uses the composer', async ({ page }) => {
  await setup(page, { chat: () => 'Here is a **thought**: start with the shared-resource argument.' });
  await page.goto('./');
  await page.getByRole('button', { name: /start a session/i }).click();
  await page.getByRole('radio', { name: 'Big' }).click();
  await page.getByRole('textbox', { name: 'Message' }).fill('Where should I start?');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('start with the shared-resource argument')).toBeVisible();
  await expect(page.getByText('Where should I start?')).toBeVisible();
});

test('build a pipeline with Add step and see both outputs', async ({ page }, info) => {
  await setup(page, { chat: () => '- Hesitation before "bike lanes" (unsure)' });
  await page.goto('./');
  await page.getByRole('button', { name: /start a session/i }).click();
  await page.getByRole('button', { name: /On stop:/ }).click();
  await page.getByRole('button', { name: 'Transcribe only' }).click();
  await page.getByRole('button', { name: 'Add step' }).click();
  await page.getByRole('menuitem', { name: 'Listen (Inkling)' }).click();
  const transcribe = page.getByRole('listitem', { name: /Step 1: Transcribe/ });
  // Adding a step folds earlier ones; show the transcript too.
  await transcribe.getByRole('radio', { name: 'Show' }).click();
  // Inkling writes its own transcript by default.
  await expect(page.getByRole('listitem', { name: /Step 2: Inkling/ }).getByRole('switch', { name: /Give it the earlier transcript/ })).not.toBeChecked();
  // The hand-built pipeline is recognised as the matching preset.
  await expect(page.getByRole('button', { name: 'Transcribe + Inkling', pressed: true })).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `test-results/shots/${info.project.name}-06-steps.png` });
  if (info.project.name === 'mobile') await page.getByRole('button', { name: 'Close' }).click();
  else await page.getByRole('button', { name: 'Close panel' }).click();
  await expect(page.getByRole('button', { name: /On stop: Transcribe, then Inkling\./ })).toBeVisible();

  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.locator('article').filter({ hasText: 'Hesitation before' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('article').filter({ hasText: 'cities should invest in bike lanes' })).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `test-results/shots/${info.project.name}-07-both-outputs.png` });
});

test('rename a session by clicking its title', async ({ page }) => {
  await setup(page);
  await page.goto('./');
  await page.getByRole('button', { name: /start a session/i }).click();
  await page.getByRole('button', { name: /— rename/ }).click();
  await page.getByRole('textbox', { name: 'Session name' }).fill('Spanish practice');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: /Spanish practice/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: /Spanish practice/ })).toBeVisible();
});
