import { planSegments, rms, type Range } from './segments';

/** Analysis frame length (seconds). */
export const FRAME = 0.03;
/** Silence inserted between speech regions when they are joined for one request. */
export const JOIN_GAP = 0.4;

export interface SpeechOptions {
  /** Padding kept before and after detected speech, so word edges are not clipped. */
  padBefore: number;
  padAfter: number;
  /** Regions closer than this are merged (natural pauses inside a thought). */
  mergeGap: number;
  /** Shorter bursts (clicks, bumps) are ignored. */
  minSpeech: number;
}

export const DEFAULT_SPEECH: SpeechOptions = { padBefore: 0.3, padAfter: 0.5, mergeGap: 1.2, minSpeech: 0.15 };

/** Per-frame level in dBFS for [start, end), reading the audio in blocks. */
export async function frameLevels(read: (start: number, end: number) => Promise<Int16Array>, rate: number, start: number, end: number, blockSeconds = 60): Promise<Float32Array> {
  const frames = Math.max(0, Math.floor((end - start) / FRAME));
  const out = new Float32Array(frames);
  const perFrame = Math.round(FRAME * rate);
  const framesPerBlock = Math.floor(blockSeconds / FRAME);
  for (let f0 = 0; f0 < frames; f0 += framesPerBlock) {
    const f1 = Math.min(frames, f0 + framesPerBlock);
    const samples = await read(start + f0 * FRAME, start + f1 * FRAME);
    for (let f = f0; f < f1; f++) {
      const level = rms(samples.subarray((f - f0) * perFrame, (f - f0 + 1) * perFrame));
      out[f] = 20 * Math.log10(level + 1e-9);
    }
  }
  return out;
}

function percentile(values: Float32Array, p: number) {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? -120;
}

/**
 * Find speech in a recording from its frame levels. The noise floor is the recording's
 * quiet level (10th percentile). Speech must stand clearly above it: frames above the
 * threshold start a region, and a region only counts if its peak is at least
 * MIN_CONTRAST dB over the floor. Steady noise (no contrast) therefore yields nothing,
 * even when the browser's gain control has boosted it.
 */
export const MIN_CONTRAST = 15;

export function detectSpeech(levels: Float32Array, offset: number, opts: SpeechOptions = DEFAULT_SPEECH): Range[] {
  if (levels.length === 0) return [];
  const floor = percentile(levels, 0.1);
  const loud = percentile(levels, 0.95);
  if (loud < -55 || loud - floor < MIN_CONTRAST) return []; // silent, or steady noise only
  // Halfway-ish between floor and loud, but at least 9 dB above the floor.
  const threshold = floor + Math.min(15, Math.max(9, loud - floor - 10));
  const raw: Range[] = [];
  let begin = -1;
  let peak = -Infinity;
  for (let i = 0; i <= levels.length; i++) {
    const on = i < levels.length && levels[i] > threshold;
    if (on) {
      if (begin < 0) begin = i;
      peak = Math.max(peak, levels[i]);
    }
    if (!on && begin >= 0) {
      if ((i - begin) * FRAME >= opts.minSpeech && peak >= floor + MIN_CONTRAST) raw.push({ start: begin * FRAME, end: i * FRAME });
      begin = -1;
      peak = -Infinity;
    }
  }
  const total = levels.length * FRAME;
  const merged: Range[] = [];
  for (const r of raw) {
    const padded = { start: Math.max(0, r.start - opts.padBefore), end: Math.min(total, r.end + opts.padAfter) };
    const last = merged.at(-1);
    if (last && padded.start - last.end < opts.mergeGap) last.end = Math.max(last.end, padded.end);
    else merged.push(padded);
  }
  return merged.map((r) => ({ start: round(r.start + offset), end: round(r.end + offset) }));
}

/**
 * Group speech regions into requests of at most `maxSeconds` of audio (including the
 * joining gaps). A single region longer than that is split at its quietest points.
 */
export async function packRegions(regions: Range[], maxSeconds: number, energyAt: (time: number, window: number) => Promise<number>): Promise<Range[][]> {
  const pieces: Range[] = [];
  for (const r of regions) {
    if (r.end - r.start > maxSeconds) pieces.push(...(await planSegments(r, maxSeconds - 15, energyAt)));
    else pieces.push(r);
  }
  const groups: Range[][] = [];
  let current: Range[] = [];
  let length = 0;
  for (const p of pieces) {
    const add = p.end - p.start + (current.length ? JOIN_GAP : 0);
    if (current.length && length + add > maxSeconds) {
      groups.push(current);
      current = [];
      length = 0;
    }
    length += p.end - p.start + (current.length ? JOIN_GAP : 0);
    current.push(p);
  }
  if (current.length) groups.push(current);
  return groups;
}

/** Map a time in the joined audio sent for `regions` back to recording time. */
export function toRecordingTime(regions: Range[], t: number): number {
  let packed = 0;
  for (let i = 0; i < regions.length; i++) {
    const len = regions[i].end - regions[i].start;
    if (t < packed + len || i === regions.length - 1) return round(regions[i].start + Math.min(Math.max(0, t - packed), len));
    packed += len;
    // Inside the joining gap: snap to the start of the next region.
    if (t < packed + JOIN_GAP) return regions[i + 1].start;
    packed += JOIN_GAP;
  }
  return regions[0]?.start ?? 0;
}

export function speechSeconds(regions: Range[]) {
  return regions.reduce((n, r) => n + (r.end - r.start), 0);
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}
