import { db } from './db';
import { newId, now } from './ids';
import { estimateSpeech } from './openrouter/catalog';
import { speech } from './openrouter/client';
import { splitForChunks } from './inference';
import type { Entry, TtsSettings } from './types';

/** Per-request character limit we stay under (ElevenLabs v3 is the tightest at 5,000). */
export const TTS_CHUNK_CHARS = 2500;

/** Strip markdown so it is not read aloud literally. */
export function speakableText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__|\*|_)(.+?)\1/g, '$2')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\[(ent|rec|ses|grp)_[a-z0-9]+[^\]]*]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function cacheKey(text: string, s: TtsSettings) {
  // Cheap content hash: the cache is per entry, so collisions only matter within one entry.
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return `${s.model}|${s.voice}|${s.speed}|${text.length}|${h}`;
}

export function estimateEntrySpeech(entry: Entry, s: TtsSettings) {
  return estimateSpeech(s.model, speakableText(entry.text).length);
}

/**
 * Speech for an entry, from the local cache when the same text and settings were spoken
 * before; otherwise generated in chunks and cached. `onPart` lets playback start early.
 */
export async function speechForEntry(
  entry: Entry,
  s: TtsSettings,
  { signal, onPart }: { signal?: AbortSignal; onPart?: (blob: Blob, index: number, total: number) => void } = {},
): Promise<{ parts: Blob[]; cached: boolean }> {
  const text = speakableText(entry.text);
  const key = cacheKey(text, s);
  const hit = await db.ttsCache.where('entryId').equals(entry.id).filter((c) => c.key === key).first();
  if (hit) {
    hit.parts.forEach((p, i) => onPart?.(p, i, hit.parts.length));
    return { parts: hit.parts, cached: true };
  }
  const chunks = splitForChunks(text, TTS_CHUNK_CHARS);
  const parts: Blob[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const blob = await speech({ model: s.model, input: chunks[i], voice: s.voice, speed: s.speed }, signal);
    parts.push(blob);
    onPart?.(blob, i, chunks.length);
  }
  // Replace any older cached speech for this entry (different text or settings).
  await db.transaction('rw', db.ttsCache, async () => {
    await db.ttsCache.where('entryId').equals(entry.id).delete();
    await db.ttsCache.add({
      id: newId('tts'),
      entryId: entry.id,
      key,
      parts,
      characters: text.length,
      cost: estimateSpeech(s.model, text.length),
      createdAt: now(),
    });
  });
  return { parts, cached: false };
}

export async function clearSpeechCache() {
  await db.ttsCache.clear();
}

export async function speechCacheSize(): Promise<{ items: number; bytes: number }> {
  let bytes = 0;
  let items = 0;
  await db.ttsCache.each((c) => {
    items++;
    bytes += c.parts.reduce((n, p) => n + p.size, 0);
  });
  return { items, bytes };
}

/** Plays a sequence of audio blobs; one player app-wide so only one thing speaks at a time. */
class SpeechPlayer {
  private audio: HTMLAudioElement | null = null;
  private queue: Blob[] = [];
  private urls: string[] = [];
  private listeners = new Set<() => void>();
  entryId: string | null = null;
  state: 'idle' | 'loading' | 'playing' = 'idle';
  private controller: AbortController | null = null;

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  async play(entry: Entry, s: TtsSettings) {
    this.stop();
    this.entryId = entry.id;
    this.state = 'loading';
    this.emit();
    this.controller = new AbortController();
    const controller = this.controller;
    try {
      await speechForEntry(entry, s, {
        signal: controller.signal,
        onPart: (blob) => {
          if (controller.signal.aborted) return;
          this.queue.push(blob);
          if (!this.audio) this.next();
        },
      });
    } catch (e) {
      if (!controller.signal.aborted) {
        this.stop();
        throw e;
      }
    }
  }

  private next() {
    const blob = this.queue.shift();
    if (!blob) {
      if (this.state === 'playing') this.stop();
      return;
    }
    const url = URL.createObjectURL(blob);
    this.urls.push(url);
    this.audio = new Audio(url);
    this.audio.onended = () => {
      this.audio = null;
      this.next();
    };
    this.state = 'playing';
    this.emit();
    void this.audio.play().catch(() => this.stop());
  }

  stop() {
    this.controller?.abort();
    this.controller = null;
    this.audio?.pause();
    this.audio = null;
    this.queue = [];
    this.urls.forEach((u) => URL.revokeObjectURL(u));
    this.urls = [];
    this.entryId = null;
    this.state = 'idle';
    this.emit();
  }
}

export const speechPlayer = new SpeechPlayer();
