// Live smoke test against the real OpenRouter API, driving the built app in Chromium.
// Reads the key from ~/dev-key.txt (or OPENROUTER_API_KEY) at runtime; never prints it.
// Spends a few cents: short clips, cheap defaults. Aborts if total key spend passes the cap.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const CAP_USD = 5;
const keyFile = resolve(homedir(), 'dev-key.txt');
const KEY = (process.env.OPENROUTER_API_KEY || (existsSync(keyFile) ? readFileSync(keyFile, 'utf8') : '')).trim();
if (!KEY.startsWith('sk-or-')) {
  console.error('No OpenRouter key: set OPENROUTER_API_KEY or create ~/dev-key.txt');
  process.exit(1);
}

async function usage() {
  const r = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${KEY}` } });
  return (await r.json()).data.usage;
}

const before = await usage();
console.log(`Key spend before: $${before.toFixed(4)}`);
if (before > CAP_USD) {
  console.error(`Development spend cap ($${CAP_USD}) reached; not running.`);
  process.exit(1);
}

const server = spawn('npx', ['vite', 'preview', '--port', '4174', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
mkdirSync('test-results/live', { recursive: true });

const fixture = (name) => resolve('tests/fixtures', name);
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function launch(audio) {
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${fixture(audio)}%noloop`, '--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1360, height: 900 } });
  await context.addInitScript((k) => {
    if (!localStorage.getItem('vn.openrouter.key')) {
      localStorage.setItem('vn.openrouter.key', k);
      localStorage.setItem('vn.openrouter.source', 'manual');
    }
  }, KEY);
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('  page error:', e.message));
  return { browser, page };
}

async function record(page, seconds) {
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.waitForTimeout(seconds * 1000);
  await page.getByRole('button', { name: 'Stop recording' }).click();
}

const only = process.argv[2];
try {
  // 1. Default pipeline: Whisper → Little cleanup, on an English thinking-aloud clip.
  if (!only || only === 'en') {
    const { browser, page } = await launch('thinking-aloud-en.wav');
    await page.goto('http://localhost:4174/');
    await page.getByRole('button', { name: /start a session/i }).click();
    await record(page, 19);
    const cleanup = page.locator('article').filter({ hasText: 'Clean up' });
    await cleanup.waitFor({ timeout: 60_000 });
    await page.waitForFunction(() => !document.querySelector('[role=status] .animate-spin'), null, { timeout: 60_000 });
    const text = await cleanup.innerText();
    check('Default pipeline produced a cleanup', /bike lanes/i.test(text), text.split('\n').slice(1).join(' ').slice(0, 160));
    check('Cleanup kept the self-correction', /actually|no,|wait|rather|more that/i.test(text));
    const summary = await page.getByRole('button', { name: /Transcribed · Cleaned up/ }).innerText();
    check('Summary line shows steps and cost', /\$/.test(summary), summary);
    await page.screenshot({ path: 'test-results/live/1-default-pipeline.png' });

    // 2. Ask Big a question that should use tools, in the same group.
    await page.getByRole('button', { name: /start/i }).first().isVisible();
    await page.getByRole('radio', { name: 'Big' }).click();
    await page.getByRole('textbox', { name: 'Message' }).fill('Search my notes in this group for what I said about safety evidence, then give me one next step. Keep it to two sentences.');
    await page.getByRole('button', { name: 'Send' }).click();
    const reply = page.locator('article').filter({ hasText: 'Big' }).last();
    await reply.waitFor({ timeout: 90_000 });
    await page.waitForFunction(() => !document.querySelector('[role=status] .animate-spin'), null, { timeout: 90_000 });
    const replyText = await reply.innerText();
    check('Big replied', replyText.length > 40, replyText.split('\n').slice(1).join(' ').slice(0, 200));
    const toolLine = await page.getByRole('button', { name: /tool call/ }).count();
    check('Big used group tools', toolLine > 0);

    // 3. Read aloud with ElevenLabs (cached on replay).
    const reqs = [];
    page.on('request', (r) => r.url().includes('/audio/speech') && reqs.push(r.url()));
    await cleanup.getByRole('button', { name: 'Read aloud' }).click();
    await page.waitForTimeout(6000);
    check('Read aloud requested speech', reqs.length >= 1);
    await cleanup.getByRole('button', { name: /Read aloud|Stop reading/ }).click();
    await page.waitForTimeout(500);
    if (await cleanup.getByRole('button', { name: 'Read aloud' }).count()) {
      const n = reqs.length;
      await cleanup.getByRole('button', { name: 'Read aloud' }).click();
      await page.waitForTimeout(2000);
      check('Replay came from the local cache', reqs.length === n);
      await page.getByRole('button', { name: 'Stop reading' }).click().catch(() => {});
    }
    await page.screenshot({ path: 'test-results/live/2-chat.png' });
    await browser.close();
  }

  // 4. Language practice: Whisper + Inkling (combined), then Big tutor feedback, on a Spanish clip.
  if (!only || only === 'es') {
    const { browser, page } = await launch('language-practice-es.wav');
    await page.goto('http://localhost:4174/');
    await page.getByRole('button', { name: /start a session/i }).click();
    await page.getByRole('button', { name: /On stop:/ }).click();
    await page.getByRole('button', { name: 'Language practice' }).click();
    await page.getByRole('textbox', { name: /Language/ }).fill('es');
    await page.getByRole('button', { name: 'Close panel' }).click();
    await record(page, 9);
    const feedback = page.locator('article').filter({ hasText: 'Language feedback' });
    await feedback.waitFor({ timeout: 120_000 }).catch(async (e) => {
      await page.screenshot({ path: 'test-results/live/3-failure.png', fullPage: true });
      console.log((await page.locator('main').innerText()).slice(0, 1500));
      throw e;
    });
    await page.waitForFunction(() => !document.querySelector('[role=status] .animate-spin'), null, { timeout: 120_000 });
    const fb = await feedback.innerText();
    check('Tutor feedback produced', fb.length > 80, fb.split('\n').slice(1).join(' ').slice(0, 200));
    await page.getByRole('button', { name: /Transcribed · Inkling listened · Language feedback/ }).click();
    const notes = await page.locator('#root').innerText();
    check('Inkling audio notes present', /Audio notes/.test(notes));
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'test-results/live/3-language-practice.png', fullPage: true });
    await browser.close();
  }
} catch (e) {
  check('Live run completed without errors', false, e.message);
} finally {
  server.kill();
  await new Promise((r) => setTimeout(r, 4000));
  const after = await usage();
  console.log(`Key spend after: $${after.toFixed(4)} (this run ≈ $${(after - before).toFixed(4)}; usage can lag a few seconds)`);
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} check(s) failed` : 'All live checks passed');
process.exit(failed.length ? 1 : 0);
