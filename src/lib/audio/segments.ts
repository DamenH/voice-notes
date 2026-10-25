import type { TimedText } from '../types';

export interface Range {
  start: number;
  end: number;
}

/**
 * Plan processing segments over [start, end). Each cut is moved to the quietest
 * window near its target so words are not split; `energyAt` returns RMS energy
 * for a short window starting at a time (seconds).
 */
export async function planSegments(
  range: Range,
  targetSeconds: number,
  energyAt: (time: number, window: number) => Promise<number>,
  { search = 15, window = 0.2, step = 0.1 } = {},
): Promise<Range[]> {
  const out: Range[] = [];
  let cursor = range.start;
  while (range.end - cursor > targetSeconds + search) {
    const target = cursor + targetSeconds;
    let best = target;
    let bestEnergy = Infinity;
    for (let t = target - search; t <= target + search; t += step) {
      const e = await energyAt(t, window);
      // Prefer the cut closest to the target among equally quiet windows.
      if (e < bestEnergy - 1e-9 || (Math.abs(e - bestEnergy) <= 1e-9 && Math.abs(t - target) < Math.abs(best - target))) {
        bestEnergy = e;
        best = t;
      }
    }
    const cut = round(best + window / 2);
    out.push({ start: round(cursor), end: cut });
    cursor = cut;
  }
  out.push({ start: round(cursor), end: round(range.end) });
  return out;
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}

/** Shift segment-relative timestamps to recording time and join the texts. */
export function assembleTimed(parts: { offset: number; text: string; timestamps?: TimedText[] }[]): {
  text: string;
  timestamps?: TimedText[];
} {
  const text = parts
    .map((p) => p.text.trim())
    .filter(Boolean)
    .join('\n\n');
  if (parts.some((p) => !p.timestamps)) return { text };
  const timestamps = parts.flatMap((p) =>
    p.timestamps!.map((t) => ({ start: round(t.start + p.offset), end: round(t.end + p.offset), text: t.text.trim() })),
  );
  return { text, timestamps };
}

export function rms(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length) / 32768;
}
