import type { Page, Route } from '@playwright/test';

export const TRANSCRIPT = {
  text: 'Okay, so for the essay, I think the main argument is, um, that cities should invest in bike lanes. Actually, no, wait.',
  segments: [
    { start: 0, end: 1.4, text: ' Okay, so for the essay,' },
    { start: 1.5, end: 5.8, text: ' I think the main argument is, um, that cities should invest in bike lanes.' },
    { start: 5.9, end: 7.2, text: ' Actually, no, wait.' },
  ],
  usage: { seconds: 7, cost: 0.00002 },
};

export const CLEANED = 'For the essay, I think the main argument is that cities should invest in bike lanes. Actually, no — wait.';

function sse(text: string, cost = 0.00007) {
  const half = Math.ceil(text.length / 2);
  return [
    { choices: [{ delta: { content: text.slice(0, half) } }] },
    { choices: [{ delta: { content: text.slice(half) }, finish_reason: 'stop' }] },
    { choices: [], usage: { cost, prompt_tokens: 120, completion_tokens: 40 } },
  ]
    .map((c) => `data: ${JSON.stringify(c)}\n\n`)
    .join('') + 'data: [DONE]\n\n';
}

export interface MockOptions {
  chat?: (body: Record<string, unknown>) => string;
  failTranscription?: boolean;
}

/** Mock OpenRouter and inject an API key so no real requests are made. */
export async function setup(page: Page, opts: MockOptions = {}) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  await page.addInitScript(() => {
    if (!localStorage.getItem('vn.e2e')) {
      localStorage.setItem('vn.e2e', '1');
      localStorage.setItem('vn.openrouter.key', 'sk-or-e2e-mock');
      localStorage.setItem('vn.openrouter.source', 'manual');
    }
  });
  await page.route('https://openrouter.ai/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1/', '');
    const body = route.request().postData() ? JSON.parse(route.request().postData()!) : {};
    calls.push({ path, body });
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b), headers: { 'access-control-allow-origin': '*' } });
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    if (path === 'models') return json({ data: [] });
    if (path === 'key') return json({ data: { label: 'mock', usage: 0.12, limit: 10, limit_remaining: 9.88 } });
    if (path === 'audio/transcriptions') return opts.failTranscription ? json({ error: { message: 'Upstream failed' } }, 502) : json(TRANSCRIPT);
    if (path === 'audio/speech') return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.alloc(0), headers: { 'access-control-allow-origin': '*' } });
    if (path === 'chat/completions') {
      const text = opts.chat?.(body) ?? CLEANED;
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(text), headers: { 'access-control-allow-origin': '*' } });
    }
    return json({ error: { message: 'unmocked' } }, 404);
  });
  return calls;
}
