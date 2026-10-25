import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';
import { db } from '../lib/db';
import { newId, now } from '../lib/ids';
import { createEntry, createGroup, createSession } from '../lib/library';
import { parseWav } from '../lib/audio/pcm';
import { writePcmChunks } from '../lib/audio/store';
import { setApiKey } from '../lib/openrouter/auth';

export function fixture(name: string) {
  const buf = readFileSync(resolve(__dirname, '../../tests/fixtures', name));
  return parseWav(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

/** A group, session and a complete recording made from PCM samples. */
export async function seedRecording(samples?: Int16Array, sampleRate = 16000) {
  setApiKey('sk-or-test', 'manual');
  const group = await createGroup('Essays');
  const session = await createSession(group.id, 'Bike lanes');
  const pcm = samples ?? fixture('thinking-aloud-en.wav').samples;
  const rate = samples ? sampleRate : fixture('thinking-aloud-en.wav').sampleRate;
  const entry = await createEntry({
    sessionId: session.id,
    groupId: group.id,
    kind: 'recording',
    text: '',
    title: 'Recording',
    status: 'done',
    visibility: 'primary',
  });
  const recordingId = newId('rec');
  const duration = await writePcmChunks(recordingId, pcm, rate);
  await db.recordings.add({
    id: recordingId,
    entryId: entry.id,
    sessionId: session.id,
    sampleRate: 16000,
    duration,
    chunkCount: Math.ceil(duration / 5),
    state: 'complete',
    createdAt: now(),
  });
  await db.entries.update(entry.id, { meta: { recordingId, duration } });
  return { group, session, entry: (await db.entries.get(entry.id))!, recordingId, duration };
}

export function sse(chunks: unknown[]): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

export function textStream(text: string, cost = 0.0001) {
  return sse([
    { choices: [{ delta: { content: text.slice(0, Math.ceil(text.length / 2)) } }] },
    { choices: [{ delta: { content: text.slice(Math.ceil(text.length / 2)) }, finish_reason: 'stop' }] },
    { choices: [], usage: { cost, prompt_tokens: 100, completion_tokens: 50 } },
  ]);
}

export function toolCallStream(id: string, name: string, args: unknown) {
  return sse([
    { choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: '' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] },
    { choices: [], usage: { cost: 0.0002, prompt_tokens: 200, completion_tokens: 20 } },
  ]);
}

export type Handler = (path: string, body: Record<string, unknown>) => Response | Promise<Response>;

/** Route OpenRouter requests to a handler and record them. */
export function mockOpenRouter(handler: Handler) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const path = String(url).replace('https://openrouter.ai/api/v1/', '');
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path, body });
    return handler(path, body);
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

export async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, timeout = 5000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}
