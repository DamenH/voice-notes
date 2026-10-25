/** Capture rate for all recordings: mono 16-bit PCM. See docs/FINDINGS.md. */
export const SAMPLE_RATE = 16000;
export const CHUNK_SECONDS = 5;

export function wavHeader(dataBytes: number, sampleRate = SAMPLE_RATE, channels = 1): ArrayBuffer {
  const buf = new ArrayBuffer(44);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, dataBytes, true);
  return buf;
}

export function wavBlob(pcmParts: BlobPart[], dataBytes: number, sampleRate = SAMPLE_RATE): Blob {
  return new Blob([wavHeader(dataBytes, sampleRate), ...pcmParts], { type: 'audio/wav' });
}

export function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** Parse a 16-bit PCM WAV (as used for fixtures and imports) into samples and rate. */
export function parseWav(buf: ArrayBuffer): { samples: Int16Array; sampleRate: number } {
  const v = new DataView(buf);
  let offset = 12;
  let sampleRate = SAMPLE_RATE;
  let channels = 1;
  while (offset + 8 <= buf.byteLength) {
    const id = String.fromCharCode(v.getUint8(offset), v.getUint8(offset + 1), v.getUint8(offset + 2), v.getUint8(offset + 3));
    const size = v.getUint32(offset + 4, true);
    if (id === 'fmt ') {
      channels = v.getUint16(offset + 10, true);
      sampleRate = v.getUint32(offset + 12, true);
    } else if (id === 'data') {
      const all = new Int16Array(buf.slice(offset + 8, offset + 8 + size));
      if (channels === 1) return { samples: all, sampleRate };
      const mono = new Int16Array(all.length / channels);
      for (let i = 0; i < mono.length; i++) mono[i] = all[i * channels];
      return { samples: mono, sampleRate };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('Not a PCM WAV file');
}

/** Linear-interpolating resampler with a simple box pre-filter when downsampling. */
export function resample(input: Int16Array, from: number, to: number): Int16Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Int16Array(Math.floor(input.length / ratio));
  const span = Math.max(1, Math.floor(ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    if (span > 1) {
      let sum = 0;
      let n = 0;
      for (let k = 0; k < span && i0 + k < input.length; k++, n++) sum += input[i0 + k];
      out[i] = n ? sum / n : 0;
    } else {
      const a = input[i0] ?? 0;
      const b = input[i0 + 1] ?? a;
      out[i] = a + (b - a) * (pos - i0);
    }
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function parseTime(text: string): number | null {
  const parts = text.trim().split(':').map(Number);
  if (parts.length === 0 || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}
