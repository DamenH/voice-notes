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

test('pipeline control opens inline and switches presets', async ({ page }, info) => {
  await setup(page);
  await page.goto('./');
  await page.getByRole('button', { name: /start a session/i }).click();
  await page.getByRole('button', { name: /On stop: Transcribe, then Clean up/ }).click();
  await expect(page.getByRole('heading', { name: 'Steps' })).toBeVisible();
  await page.getByRole('button', { name: 'Transcribe only' }).click();
  await expect(page.getByRole('switch', { name: /Skip silence/ })).toBeChecked();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `test-results/shots/${info.project.name}-05-pipeline.png` });
  await closePanel(page, info.project.name);
  await expect(page.getByRole('button', { name: /On stop: Transcribe\. Change pipeline/ })).toBeVisible();
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

test('build a pipeline with Add step', async ({ page }, info) => {
  await setup(page);
  await page.goto('./');
  await page.getByRole('button', { name: /start a session/i }).click();
  await page.getByRole('button', { name: /On stop:/ }).click();
  await page.getByRole('button', { name: 'Transcribe only' }).click();
  await page.getByRole('button', { name: 'Add step' }).click();
  await expect(page.getByRole('menuitem', { name: /Listen/ })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Assist' }).click();
  // Transcribe (collapsed) → Clean up (shown) is exactly the Thinking aloud preset.
  await expect(page.getByRole('button', { name: 'Thinking aloud', pressed: true })).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `test-results/shots/${info.project.name}-06-steps.png` });
  await closePanel(page, info.project.name);
  await expect(page.getByRole('button', { name: /On stop: Transcribe, then Clean up/ })).toBeVisible();
});

test('record several takes, then process them together', async ({ page }, info) => {
  await setup(page, { chat: (body) => (JSON.stringify(body.messages).includes('Summarise') ? 'Both takes argue for bike lanes.' : 'Cleaned take.') });
  await page.goto('./');
  await page.getByRole('button', { name: /start a session/i }).click();
  await page.getByRole('button', { name: /On stop:/ }).click();
  await page.getByRole('radio', { name: 'When I ask' }).click();
  await page.getByRole('combobox', { name: 'After processing, also' }).selectOption('summarize');
  await closePanel(page, info.project.name);
  await expect(page.getByRole('button', { name: /When asked: Transcribe, then Clean up/ })).toBeVisible();
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Start recording' }).click();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'Stop recording' }).click();
    await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible();
  }
  await expect(page.getByText('2 recordings waiting')).toBeVisible();
  await expect(page.getByText(/then summarise across all/)).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `test-results/shots/${info.project.name}-08-waiting.png` });
  await page.getByRole('button', { name: 'Process now' }).click();
  await expect(page.getByText('Both takes argue for bike lanes.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Cleaned take.')).toHaveCount(2);
  await expect(page.getByText('Across 2 recordings')).toBeVisible();
  await expect(page.getByText(/recordings? waiting/)).toHaveCount(0);
});

async function closePanel(page: import('@playwright/test').Page, project: string) {
  if (project === 'mobile') await page.getByRole('button', { name: 'Close', exact: true }).click();
  else await page.getByRole('button', { name: 'Close panel' }).click();
}

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
