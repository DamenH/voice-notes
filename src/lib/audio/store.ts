import { db } from '../db';
import { newId } from '../ids';
import { CHUNK_SECONDS, SAMPLE_RATE, resample, wavBlob } from './pcm';
import { rms } from './segments';

/** Read PCM samples for [start, end) seconds of a recording without loading the rest. */
export async function readPcm(recordingId: string, start: number, end: number): Promise<Int16Array> {
  const rec = await db.recordings.get(recordingId);
  if (!rec) throw new Error('Recording not found');
  const rate = rec.sampleRate;
  const chunks = await db.audioChunks
    .where('recordingId')
    .equals(recordingId)
    .filter((c) => c.end > start && c.start < end)
    .sortBy('index');
  const from = Math.floor(start * rate);
  const to = Math.min(Math.floor(end * rate), Math.round(rec.duration * rate));
  const out = new Int16Array(Math.max(0, to - from));
  for (const c of chunks) {
    const samples = new Int16Array(await c.data.arrayBuffer());
    const cFrom = Math.round(c.start * rate);
    const lo = Math.max(from, cFrom);
    const hi = Math.min(to, cFrom + samples.length);
    if (hi > lo) out.set(samples.subarray(lo - cFrom, hi - cFrom), lo - from);
  }
  return out;
}

export async function rangeWav(recordingId: string, start: number, end: number): Promise<Blob> {
  const rec = await db.recordings.get(recordingId);
  const pcm = await readPcm(recordingId, start, end);
  return wavBlob([pcm.buffer as ArrayBuffer], pcm.byteLength, rec?.sampleRate ?? SAMPLE_RATE);
}

/** Full recording as a WAV blob built from stored chunk blobs (not copied into memory). */
export async function recordingWav(recordingId: string): Promise<Blob> {
  const rec = await db.recordings.get(recordingId);
  if (!rec) throw new Error('Recording not found');
  const chunks = await db.audioChunks.where('[recordingId+index]').between([recordingId, 0], [recordingId, Infinity]).toArray();
  const bytes = chunks.reduce((n, c) => n + c.data.size, 0);
  return wavBlob(
    chunks.map((c) => c.data),
    bytes,
    rec.sampleRate,
  );
}

export function energyReader(recordingId: string) {
  return async (time: number, window: number) => rms(await readPcm(recordingId, Math.max(0, time), time + window));
}

/** Store PCM (e.g. an imported file) as a complete recording's chunks. */
export async function writePcmChunks(recordingId: string, samples: Int16Array, sampleRate: number): Promise<number> {
  const pcm = sampleRate === SAMPLE_RATE ? samples : resample(samples, sampleRate, SAMPLE_RATE);
  const per = SAMPLE_RATE * CHUNK_SECONDS;
  let index = 0;
  const rows = [];
  for (let i = 0; i < pcm.length; i += per, index++) {
    const part = pcm.slice(i, i + per);
    rows.push({
      id: newId('chk'),
      recordingId,
      index,
      start: i / SAMPLE_RATE,
      end: (i + part.length) / SAMPLE_RATE,
      data: new Blob([part.buffer as ArrayBuffer]),
    });
  }
  await db.audioChunks.bulkPut(rows);
  return pcm.length / SAMPLE_RATE;
}
