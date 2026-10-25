import type { ChatMessage, TimedText, ToolCall, Usage } from '../types';
import { OPENROUTER_ORIGIN, getApiKey } from './auth';

const API = `${OPENROUTER_ORIGIN}/api/v1`;

export type ErrorKind = 'auth' | 'credits' | 'rate' | 'network' | 'server' | 'bad_request' | 'offline' | 'cancelled';

export class OpenRouterError extends Error {
  kind: ErrorKind;
  status?: number;
  /** The request may have reached the provider and been charged; retrying could double-charge. */
  ambiguous: boolean;
  constructor(kind: ErrorKind, message: string, { status, ambiguous = false }: { status?: number; ambiguous?: boolean } = {}) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.ambiguous = ambiguous;
  }
}

export function friendlyError(e: unknown): string {
  if (e instanceof OpenRouterError) return e.message;
  return (e as Error)?.message ?? String(e);
}

function headers(): HeadersInit {
  const key = getApiKey();
  if (!key) throw new OpenRouterError('auth', 'Connect your OpenRouter account in Settings first.');
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': location.origin,
    'X-Title': 'Voice Notes',
  };
}

async function errorFrom(res: Response): Promise<OpenRouterError> {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error?.message ?? JSON.stringify(body).slice(0, 300);
  } catch {
    /* ignore */
  }
  const s = res.status;
  if (s === 401 || s === 403) return new OpenRouterError('auth', `OpenRouter rejected the key (${s}). Reconnect in Settings. ${detail}`, { status: s });
  if (s === 402) return new OpenRouterError('credits', `Your OpenRouter account is out of credits or over its limit. ${detail}`, { status: s });
  if (s === 429) return new OpenRouterError('rate', `Rate limited by OpenRouter. Try again shortly. ${detail}`, { status: s });
  if (s >= 500) return new OpenRouterError('server', `OpenRouter or the provider failed (${s}). ${detail}`, { status: s, ambiguous: true });
  return new OpenRouterError('bad_request', `Request rejected (${s}): ${detail}`, { status: s });
}

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new OpenRouterError('offline', 'You are offline. This will run when you reconnect.');
  }
  let res: Response;
  try {
    res = await fetch(`${API}/${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new OpenRouterError('cancelled', 'Cancelled.');
    if (e instanceof OpenRouterError) throw e;
    // The request may or may not have reached OpenRouter.
    throw new OpenRouterError('network', 'Network error while contacting OpenRouter.', { ambiguous: true });
  }
  if (!res.ok) throw await errorFrom(res);
  return res;
}

export interface TranscriptionResult {
  text: string;
  timestamps?: TimedText[];
  usage: Usage;
}

export async function transcribe(
  opts: { model: string; wavBase64: string; language?: string; timestamps: boolean },
  signal?: AbortSignal,
): Promise<TranscriptionResult> {
  const body: Record<string, unknown> = {
    model: opts.model,
    input_audio: { data: opts.wavBase64, format: 'wav' },
    response_format: opts.timestamps ? 'verbose_json' : 'json',
  };
  if (opts.timestamps) body.timestamp_granularities = ['segment'];
  if (opts.language) body.language = opts.language;
  let res: Response;
  try {
    res = await post('audio/transcriptions', body, signal);
  } catch (e) {
    // Some models (e.g. gpt-4o-mini-transcribe) do not support timestamps; fall back to plain text.
    if (opts.timestamps && e instanceof OpenRouterError && e.kind === 'bad_request' && /verbose_json|timestamp/i.test(e.message)) {
      return transcribe({ ...opts, timestamps: false }, signal);
    }
    throw e;
  }
  const d = (await res.json()) as {
    text: string;
    segments?: { start: number; end: number; text: string }[];
    usage?: { cost?: number; seconds?: number; input_tokens?: number; output_tokens?: number };
  };
  return {
    text: d.text?.trim() ?? '',
    timestamps: d.segments?.map((s) => ({ start: s.start, end: s.end, text: s.text.trim() })),
    usage: {
      cost: d.usage?.cost,
      seconds: d.usage?.seconds,
      promptTokens: d.usage?.input_tokens,
      completionTokens: d.usage?.output_tokens,
    },
  };
}

export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatResult {
  message: ChatMessage;
  usage: Usage;
  finishReason?: string;
}

interface StreamChunk {
  choices?: {
    delta?: { content?: string | null; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] };
    finish_reason?: string | null;
  }[];
  usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

/** Streamed chat completion. `onText` receives the accumulated assistant text. */
export async function chat(
  opts: { model: string; messages: ChatMessage[]; tools?: ToolSpec[]; toolChoice?: 'auto' | 'none'; maxTokens?: number },
  { signal, onText }: { signal?: AbortSignal; onText?: (text: string) => void } = {},
): Promise<ChatResult> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    stream: true,
    usage: { include: true },
  };
  if (opts.tools?.length) body.tools = opts.tools;
  if (opts.tools?.length && opts.toolChoice) body.tool_choice = opts.toolChoice;
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  const res = await post('chat/completions', body, signal);
  if (!res.body) throw new OpenRouterError('server', 'Empty response from OpenRouter.', { ambiguous: true });

  let text = '';
  const calls: ToolCall[] = [];
  let usage: Usage = {};
  let finishReason: string | undefined;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue; // SSE comments keep the connection alive
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let chunk: StreamChunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        if (chunk.error) throw new OpenRouterError('server', `Provider error: ${chunk.error.message ?? 'unknown'}`, { ambiguous: true });
        const choice = chunk.choices?.[0];
        if (choice?.delta?.content) {
          text += choice.delta.content;
          onText?.(text);
        }
        for (const tc of choice?.delta?.tool_calls ?? []) {
          const slot = (calls[tc.index] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.function.name += tc.function.name;
          if (tc.function?.arguments) slot.function.arguments += tc.function.arguments;
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (chunk.usage) {
          usage = { cost: chunk.usage.cost, promptTokens: chunk.usage.prompt_tokens, completionTokens: chunk.usage.completion_tokens };
        }
      }
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new OpenRouterError('cancelled', 'Cancelled.');
    if (e instanceof OpenRouterError) throw e;
    throw new OpenRouterError('network', 'The connection dropped while receiving the response.', { ambiguous: true });
  }
  const toolCalls = calls.filter(Boolean);
  return {
    message: { role: 'assistant', content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
    usage,
    finishReason,
  };
}

/** Text to speech. Returns mp3 audio. */
export async function speech(
  opts: { model: string; input: string; voice: string; speed?: number },
  signal?: AbortSignal,
): Promise<Blob> {
  const body: Record<string, unknown> = { model: opts.model, input: opts.input, voice: opts.voice, response_format: 'mp3' };
  if (opts.speed && opts.speed !== 1) body.speed = opts.speed;
  const res = await post('audio/speech', body, signal);
  return new Blob([await res.arrayBuffer()], { type: 'audio/mpeg' });
}

export interface KeyInfo {
  label?: string;
  usage: number;
  limit: number | null;
  limitRemaining: number | null;
}

export async function getKeyInfo(): Promise<KeyInfo> {
  let res: Response;
  try {
    res = await fetch(`${API}/key`, { headers: headers() });
  } catch {
    throw new OpenRouterError('network', 'Could not reach OpenRouter.');
  }
  if (!res.ok) throw await errorFrom(res);
  const { data } = await res.json();
  return { label: data.label, usage: data.usage, limit: data.limit, limitRemaining: data.limit_remaining };
}
