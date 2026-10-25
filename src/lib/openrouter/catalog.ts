import { OPENROUTER_ORIGIN } from './auth';

export type ModelKind = 'chat' | 'transcription' | 'speech';

export interface CatalogModel {
  id: string;
  name: string;
  kind: ModelKind;
  inputModalities: string[];
  context: number;
  tools: boolean;
  /** USD per unit, as published. */
  prompt: number;
  completion: number;
  audio?: number;
  voices?: string[];
}

const CACHE = 'vn.catalog.v1';
const MAX_AGE = 12 * 60 * 60 * 1000;

/** Measured on Inkling (2026-10-25): ~20 audio tokens per second of speech. */
export const AUDIO_TOKENS_PER_SECOND = 20;
/** Typical speech: ~160 words/min ≈ 220 tokens/min of transcript. */
export const TRANSCRIPT_TOKENS_PER_MINUTE = 220;

interface RawModel {
  id: string;
  name: string;
  context_length?: number;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  pricing?: Record<string, string>;
  supported_parameters?: string[];
  supported_voices?: string[];
}

function toModel(m: RawModel): CatalogModel | null {
  const out = m.architecture?.output_modalities ?? [];
  const kind: ModelKind | null = out.includes('transcription') ? 'transcription' : out.includes('speech') ? 'speech' : out.includes('text') ? 'chat' : null;
  if (!kind) return null;
  const p = m.pricing ?? {};
  const num = (v?: string) => (v && Number(v) > 0 ? Number(v) : 0);
  return {
    id: m.id,
    name: m.name,
    kind,
    inputModalities: m.architecture?.input_modalities ?? [],
    context: m.context_length ?? 0,
    tools: m.supported_parameters?.includes('tools') ?? false,
    prompt: num(p.prompt),
    completion: num(p.completion),
    audio: num(p.audio) || undefined,
    voices: m.supported_voices,
  };
}

let memory: CatalogModel[] | null = null;

export function cachedCatalog(): { models: CatalogModel[]; fetchedAt: number } | null {
  try {
    const raw = localStorage.getItem(CACHE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** The catalog is public, so it works without a key. Cached for offline price display. */
export async function loadCatalog(force = false): Promise<CatalogModel[]> {
  const cached = cachedCatalog();
  if (!force && cached && Date.now() - cached.fetchedAt < MAX_AGE) return (memory = cached.models);
  try {
    // `output_modalities=all` includes transcription and speech models alongside chat models.
    const res = await fetch(`${OPENROUTER_ORIGIN}/api/v1/models?output_modalities=all`);
    if (!res.ok) throw new Error(String(res.status));
    const { data } = (await res.json()) as { data: RawModel[] };
    const models = data.map(toModel).filter((m): m is CatalogModel => !!m && !m.id.endsWith(':batch'));
    try {
      localStorage.setItem(CACHE, JSON.stringify({ models, fetchedAt: Date.now() }));
    } catch {
      /* quota: keep in memory only */
    }
    return (memory = models);
  } catch {
    return (memory = cached?.models ?? []);
  }
}

export function catalogModel(id: string): CatalogModel | undefined {
  return (memory ?? cachedCatalog()?.models)?.find((m) => m.id === id);
}

const usd = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : n >= 0.01 ? `$${n.toFixed(3)}` : `$${n.toPrecision(2)}`);

/** Human-readable price with its unit. Text and audio pricing are shown separately. */
export function describePrice(m: CatalogModel | undefined): string {
  if (!m) return 'Price unknown (catalog not loaded)';
  if (m.kind === 'transcription') {
    return m.completion ? `${usd(m.prompt * 1e6)}/M input, ${usd(m.completion * 1e6)}/M output tokens` : `${usd(m.prompt * 3600)}/hour of audio`;
  }
  if (m.kind === 'speech') {
    return m.completion ? `${usd(m.prompt * 1e6)}/M in, ${usd(m.completion * 1e6)}/M out tokens` : `${usd(m.prompt * 1000)}/1K characters`;
  }
  const text = `${usd(m.prompt * 1e6)}/M in · ${usd(m.completion * 1e6)}/M out`;
  if (!m.inputModalities.includes('audio')) return text;
  const audioPerHour = (m.audio ?? m.prompt) * AUDIO_TOKENS_PER_SECOND * 3600;
  return `${text} · audio ≈ ${usd(audioPerHour)}/hour`;
}

export function formatCost(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return '';
  if (n === 0) return '$0';
  return n < 0.0001 ? '<$0.0001' : usd(n);
}

/** Estimated cost for a chat call. Unknown models estimate as 0 and are flagged by the caller. */
export function estimateChat(modelId: string, inputTokens: number, outputTokens: number, audioSeconds = 0): number {
  const m = catalogModel(modelId);
  if (!m) return 0;
  return inputTokens * m.prompt + outputTokens * m.completion + audioSeconds * AUDIO_TOKENS_PER_SECOND * (m.audio ?? m.prompt);
}

export function estimateTranscription(modelId: string, seconds: number): number {
  const m = catalogModel(modelId);
  if (!m) return 0;
  if (m.completion) return seconds * AUDIO_TOKENS_PER_SECOND * m.prompt + (seconds / 60) * TRANSCRIPT_TOKENS_PER_MINUTE * m.completion;
  return seconds * m.prompt;
}

export function estimateSpeech(modelId: string, characters: number): number {
  const m = catalogModel(modelId);
  if (!m) return 0;
  // Token-priced TTS: ~4 characters per token in, ~25 audio tokens/s out at ~15 chars/s.
  if (m.completion) return (characters / 4) * m.prompt + (characters / 15) * 25 * m.completion;
  return characters * m.prompt;
}

export function voicesFor(modelId: string): string[] {
  return catalogModel(modelId)?.voices ?? [];
}

export function isKnown(modelId: string) {
  return !!catalogModel(modelId);
}

export function setCatalogForTests(models: CatalogModel[]) {
  memory = models;
}
