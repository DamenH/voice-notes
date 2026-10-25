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

describe('pipeline helpers', () => {
  it('converts the old mode-based shape to steps', async () => {
    const { fromLegacy, samePipeline, clonePipeline } = await import('./pipeline');
    const p = fromLegacy({
      process: { mode: 'combined', sttModel: 'w', audioModel: 'i', language: 'es', transcriptToAudioModel: false, instructions: 'listen' },
      infer: { preset: 'tutor', instructions: 'be kind' },
    });
    expect(p.language).toBe('es');
    expect(p.steps.map((s) => [s.kind, s.model ?? s.preset, s.output])).toEqual([
      ['transcribe', 'w', 'collapse'],
      ['listen', 'i', 'collapse'],
      ['assist', 'tutor', 'show'],
    ]);
    expect(p.steps[1].useTranscript).toBe(false);
    expect(p.steps[1].instructions).toBe('listen');
    expect(p.steps[2].input).toBe('all');
    expect(fromLegacy({ process: { mode: 'off', sttModel: 'w', audioModel: 'i' }, infer: { preset: 'cleanup' } }).steps).toEqual([]);
    expect(samePipeline(p, clonePipeline(p))).toBe(true);
    // Key order and unset fields don't matter; a real difference does.
    const reordered = { language: 'es', steps: p.steps.map((s) => Object.fromEntries(Object.entries(s).reverse()) as typeof s) };
    expect(samePipeline(p, reordered)).toBe(true);
    expect(samePipeline(p, { ...p, steps: p.steps.map((s, i) => (i === 0 ? { ...s, output: 'show' as const } : s)) })).toBe(false);
  });
});

describe('speech detection', () => {
  it('finds speech above an adaptive noise floor, padded and merged', async () => {
    const { detectSpeech, toRecordingTime, FRAME } = await import('./audio/speech');
    // 10 s at -50 dB with speech at 2–3 s and 3.5–4 s (merged) and 8–8.5 s.
    const levels = new Float32Array(Math.round(10 / FRAME)).fill(-50);
    const on = (a: number, b: number) => levels.fill(-20, Math.round(a / FRAME), Math.round(b / FRAME));
    on(2, 3);
    on(3.5, 4);
    on(8, 8.5);
    const regions = detectSpeech(levels, 100);
    expect(regions.length).toBe(2);
    expect(regions[0].start).toBeCloseTo(101.7, 1);
    expect(regions[0].end).toBeCloseTo(104.5, 1);
    expect(regions[1].start).toBeCloseTo(107.7, 1);
    // Joined audio: region 1 is 2.8 s, then a 0.4 s gap, then region 2.
    expect(toRecordingTime(regions, 1)).toBeCloseTo(102.7, 1);
    expect(toRecordingTime(regions, 3.0)).toBeCloseTo(107.7, 1);
    expect(toRecordingTime(regions, 3.5)).toBeCloseTo(108.0, 1);
  });

  it('treats a silent recording as having no speech', async () => {
    const { detectSpeech } = await import('./audio/speech');
    expect(detectSpeech(new Float32Array(300).fill(-90), 0)).toEqual([]);
  });
});

describe('noise floor', () => {
  it('ignores steady noise even when gain control has boosted it', async () => {
    const { detectSpeech, FRAME } = await import('./audio/speech');
    const levels = new Float32Array(Math.round(60 / FRAME)).map((_, i) => -40 + 3 * Math.sin(i * 0.7) + ((i * 7919) % 5) - 2);
    expect(detectSpeech(levels, 0)).toEqual([]);
  });

  it('still finds speech over that noise', async () => {
    const { detectSpeech, FRAME } = await import('./audio/speech');
    const levels = new Float32Array(Math.round(60 / FRAME)).map((_, i) => -40 + 3 * Math.sin(i * 0.7) + ((i * 7919) % 5) - 2);
    levels.fill(-18, Math.round(20 / FRAME), Math.round(24 / FRAME));
    const regions = detectSpeech(levels, 0);
    expect(regions.length).toBe(1);
    expect(regions[0].start).toBeCloseTo(19.7, 1);
  });

  it('drops a brief noise bump that only just crosses the threshold', async () => {
    const { detectSpeech, FRAME } = await import('./audio/speech');
    const levels = new Float32Array(Math.round(30 / FRAME)).fill(-45);
    levels.fill(-15, Math.round(5 / FRAME), Math.round(8 / FRAME)); // speech, gives contrast
    levels.fill(-33, Math.round(20 / FRAME), Math.round(21 / FRAME)); // a knock: above threshold, below floor + 15
    expect(detectSpeech(levels, 0).length).toBe(1);
  });
});

describe('whisper hallucination filter', () => {
  it('drops segments Whisper marks as probably not speech, and repetitive ones', async () => {
    const { likelyHallucination } = await import('./openrouter/client');
    expect(likelyHallucination({ start: 0, end: 2, text: ' Thank you for watching.', no_speech_prob: 0.8, avg_logprob: -1.3 })).toBe(true);
    expect(likelyHallucination({ start: 0, end: 2, text: ' you you you you you you', compression_ratio: 3.1 })).toBe(true);
    expect(likelyHallucination({ start: 0, end: 2, text: ' Bike lanes.', no_speech_prob: 0.7, avg_logprob: -0.3 })).toBe(false);
    expect(likelyHallucination({ start: 0, end: 2, text: ' Bike lanes.', no_speech_prob: 0.01, avg_logprob: -0.4 })).toBe(false);
  });
});
