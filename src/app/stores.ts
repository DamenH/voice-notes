import { useSyncExternalStore } from 'react';
import { recordingWav } from '../lib/audio/store';
import { speechPlayer } from '../lib/tts';

function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T | ((v: T) => T)) {
      value = typeof next === 'function' ? (next as (v: T) => T)(value) : next;
      listeners.forEach((fn) => fn());
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
}

export function useStore<T>(s: { get: () => T; subscribe: (fn: () => void) => () => void }): T {
  return useSyncExternalStore(s.subscribe, s.get);
}

// ---------- Inspector (desktop side panel / phone bottom sheet) ----------

export type Panel =
  | { kind: 'pipeline'; scope?: 'session' | 'group' | 'global' }
  | { kind: 'instructions' }
  | { kind: 'voice' }
  | { kind: 'turn'; turnId: string }
  | { kind: 'process'; entryId: string };

export const inspector = store<Panel | null>(null);

export function openPanel(p: Panel) {
  inspector.set(p);
}

export function closePanel() {
  inspector.set(null);
}

// ---------- Recording playback (one audio element app-wide) ----------

export interface PlaybackState {
  entryId: string | null;
  playing: boolean;
  time: number;
  duration: number;
  /** Stop automatically at this time (range playback from a transcript). */
  until: number | null;
  loading: boolean;
}

export const playback = store<PlaybackState>({ entryId: null, playing: false, time: 0, duration: 0, until: null, loading: false });

let audio: HTMLAudioElement | null = null;
let url: string | null = null;
let currentRecordingId: string | null = null;

function ensureAudio() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'auto';
  audio.ontimeupdate = () => {
    const t = audio!.currentTime;
    const { until } = playback.get();
    if (until !== null && t >= until) {
      audio!.pause();
      playback.set((s) => ({ ...s, until: null }));
    }
    playback.set((s) => ({ ...s, time: t }));
  };
  audio.onplay = () => playback.set((s) => ({ ...s, playing: true }));
  audio.onpause = () => playback.set((s) => ({ ...s, playing: false }));
  audio.onended = () => playback.set((s) => ({ ...s, playing: false, time: 0 }));
  audio.onloadedmetadata = () => playback.set((s) => ({ ...s, duration: audio!.duration }));
  return audio;
}

/** Play a recording entry, optionally a range. Builds the WAV from stored chunks on first use. */
export async function playRecording(entryId: string, recordingId: string, duration: number, from?: number, until?: number) {
  const a = ensureAudio();
  speechPlayer.stop();
  if (currentRecordingId !== recordingId) {
    a.pause();
    playback.set({ entryId, playing: false, time: from ?? 0, duration, until: until ?? null, loading: true });
    const blob = await recordingWav(recordingId);
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(blob);
    currentRecordingId = recordingId;
    a.src = url;
    await new Promise((r) => a.addEventListener('loadedmetadata', r, { once: true }));
  }
  playback.set((s) => ({ ...s, entryId, until: until ?? null, loading: false, duration }));
  if (from !== undefined) a.currentTime = from;
  await a.play().catch(() => {});
}

export function pausePlayback() {
  audio?.pause();
}

export function seekPlayback(time: number) {
  if (audio) audio.currentTime = time;
  playback.set((s) => ({ ...s, time }));
}

/** Forget a recording's audio (e.g. after deletion). */
export function releaseRecording(recordingId: string) {
  if (currentRecordingId !== recordingId) return;
  audio?.pause();
  if (url) URL.revokeObjectURL(url);
  url = null;
  currentRecordingId = null;
  playback.set({ entryId: null, playing: false, time: 0, duration: 0, until: null, loading: false });
}
