import { describe, expect, it } from 'vitest';
import { resolveInstructions } from './instructions';
import { formatTime, parseTime, parseWav, resample, wavHeader } from './audio/pcm';
import { assembleTimed, planSegments } from './audio/segments';
import { splitForChunks } from './inference';
import { speakableText } from './tts';
import { buildAuthUrl, challengeFor } from './openrouter/auth';

describe('instructions', () => {
  it('keeps every level in order and states precedence', () => {
    const out = resolveInstructions('inference', {
      global: { inference: 'Be brief.' },
      group: { inference: 'Use British spelling.' },
      session: {},
      run: 'Reply in Spanish.',
    });
    expect(out.indexOf('Be brief')).toBeLessThan(out.indexOf('British'));
    expect(out.indexOf('British')).toBeLessThan(out.indexOf('Spanish'));
    expect(out).toContain('more specific');
    expect(out).not.toContain('Session instructions');
  });

  it('uses the chain requested', () => {
    expect(resolveInstructions('processing', { global: { processing: 'P', inference: 'I' } })).toBe('## Global defaults\nP');
  });
});

describe('pcm', () => {
  it('round-trips a wav header', () => {
    const samples = new Int16Array([0, 1000, -1000, 32767]);
    const buf = new Uint8Array(44 + samples.byteLength);
    buf.set(new Uint8Array(wavHeader(samples.byteLength, 16000)), 0);
    buf.set(new Uint8Array(samples.buffer), 44);
    const parsed = parseWav(buf.buffer);
    expect(parsed.sampleRate).toBe(16000);
    expect([...parsed.samples]).toEqual([...samples]);
  });

  it('resamples to the target length', () => {
    const input = new Int16Array(24000).fill(100);
    const out = resample(input, 24000, 16000);
    expect(out.length).toBe(16000);
    expect(out[500]).toBe(100);
  });

  it('formats and parses times', () => {
    expect(formatTime(75)).toBe('1:15');
    expect(formatTime(3725)).toBe('1:02:05');
    expect(parseTime('1:15')).toBe(75);
    expect(parseTime('x')).toBeNull();
  });
});

describe('segments', () => {
  it('returns one segment for short audio', async () => {
    const segs = await planSegments({ start: 0, end: 100 }, 300, async () => 1);
    expect(segs).toEqual([{ start: 0, end: 100 }]);
  });

  it('cuts long audio at the quietest point near each target', async () => {
    // Silence at 295 s and 608 s; everything else is loud.
    const energy = async (t: number) => (Math.abs(t - 295) < 0.05 || Math.abs(t - 608) < 0.05 ? 0 : 1);
    const segs = await planSegments({ start: 0, end: 900 }, 300, energy);
    expect(segs.length).toBe(3);
    expect(segs[0].end).toBeCloseTo(295.1, 1);
    expect(segs[1].start).toBe(segs[0].end);
    expect(segs[1].end).toBeCloseTo(608.1, 1);
    expect(segs.at(-1)!.end).toBe(900);
  });

  it('offsets timestamps when assembling', () => {
    const out = assembleTimed([
      { offset: 0, text: 'one', timestamps: [{ start: 0, end: 1, text: 'one' }] },
      { offset: 300, text: 'two', timestamps: [{ start: 2, end: 3, text: 'two' }] },
    ]);
    expect(out.text).toBe('one\n\ntwo');
    expect(out.timestamps![1]).toEqual({ start: 302, end: 303, text: 'two' });
  });

  it('drops timestamps if any part lacks them', () => {
    expect(assembleTimed([{ offset: 0, text: 'a' }, { offset: 1, text: 'b', timestamps: [] }]).timestamps).toBeUndefined();
  });
});

describe('chunking', () => {
  it('splits at sentence boundaries and preserves content', () => {
    const text = Array.from({ length: 200 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
    const parts = splitForChunks(text, 500);
    expect(parts.length).toBeGreaterThan(5);
    expect(parts.every((p) => p.length <= 500)).toBe(true);
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(text);
  });
});

describe('tts text', () => {
  it('strips markdown and entry references', () => {
    expect(speakableText('## Title\n**Bold** and [link](http://x) [ent_abc123 · Transcript]')).toBe('Title\nBold and link');
  });
});

describe('oauth', () => {
  it('builds an S256 PKCE authorization URL', async () => {
    // RFC 7636 appendix B test vector.
    expect(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    const url = new URL(await buildAuthUrl('v', 'https://damenh.github.io/voice-notes/', 'st'));
    expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth');
    expect(url.searchParams.get('callback_url')).toBe('https://damenh.github.io/voice-notes/');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('st');
  });
});
