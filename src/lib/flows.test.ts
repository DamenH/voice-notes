import { beforeAll, describe, expect, it, vi } from 'vitest';
import { db, updateSettings } from './db';
import { createEntry, createGroup, createSession, deleteEntry, deleteSession } from './library';
import { cancelRun, processRecording, resolveApproval, retryRun, runPipelineForRecording, sendMessage } from './runs';
import { recoverRuns, startScheduler } from './scheduler';
import { notifyScheduler } from './scheduler-signal';
import { searchGroup } from './search';
import { executeTool } from './tools';
import { exportLibrary, importLibrary } from './backup';
import { readPcm } from './audio/store';
import { setCatalogForTests } from './openrouter/catalog';
import { PIPELINE_PRESETS } from './defaults';
import { step } from './pipeline';
import type { PipelineConfig, PipelineStep } from './types';

const pipeline = (...steps: PipelineStep[]): PipelineConfig => ({ language: '', steps });
const WHISPER = 'openai/whisper-large-v3-turbo';
const INK = 'thinkingmachines/inkling';
import { mockOpenRouter, seedRecording, textStream, toolCallStream, waitFor } from '../test/helpers';

const WHISPER_RESPONSE = {
  text: 'Okay, so for the essay, um, bike lanes. Actually, no, wait.',
  segments: [
    { start: 0, end: 1.4, text: ' Okay, so for the essay,' },
    { start: 1.5, end: 5.8, text: ' um, bike lanes. Actually, no, wait.' },
  ],
  usage: { seconds: 18, cost: 0.00006 },
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeAll(() => {
  setCatalogForTests([
    { id: 'openai/whisper-large-v3-turbo', name: 'Whisper', kind: 'transcription', inputModalities: ['audio'], context: 0, tools: false, prompt: 0.0000033, completion: 0 },
    { id: 'anthropic/claude-haiku-5.5', name: 'Haiku', kind: 'chat', inputModalities: ['text'], context: 1e6, tools: true, prompt: 1e-7, completion: 5e-7 },
    { id: 'anthropic/claude-sonnet-5.5', name: 'Sonnet', kind: 'chat', inputModalities: ['text'], context: 1e6, tools: true, prompt: 2e-6, completion: 1e-5 },
    { id: 'thinkingmachines/inkling', name: 'Inkling', kind: 'chat', inputModalities: ['text', 'audio'], context: 1e6, tools: false, prompt: 1e-6, completion: 4e-6 },
  ]);
  startScheduler();
});

const terminal = ['done', 'failed', 'cancelled', 'blocked', 'awaiting_approval', 'waiting_network'];

async function settled(turnId: string) {
  return waitFor(async () => {
    const runs = await db.runs.where('turnId').equals(turnId).sortBy('createdAt');
    return runs.length > 0 && runs.every((r) => terminal.includes(r.status)) && runs;
  });
}

describe('recording storage', () => {
  it('reads exact ranges across chunk boundaries', async () => {
    const samples = new Int16Array(16000 * 12).map((_, i) => i % 1000);
    const { recordingId } = await seedRecording(samples);
    const pcm = await readPcm(recordingId, 4.5, 5.5);
    expect(pcm.length).toBe(16000);
    expect(pcm[0]).toBe((4.5 * 16000) % 1000);
    expect(pcm[15999]).toBe((5.5 * 16000 - 1) % 1000);
  });
});

describe('default pipeline', () => {
  it('stop → transcribe → clean up, with the transcript collapsed and cleanup primary', async () => {
    const calls = mockOpenRouter((path) =>
      path === 'audio/transcriptions' ? json(WHISPER_RESPONSE) : textStream('For the essay: bike lanes. Actually, no — wait.'),
    );
    const { entry } = await seedRecording();
    await runPipelineForRecording(entry.id);
    const runs = await settled(entry.turnId);
    expect(runs.map((r) => [r.mode, r.status])).toEqual([
      ['stt', 'done'],
      ['cleanup', 'done'],
    ]);
    const entries = await db.entries.where('turnId').equals(entry.turnId).sortBy('createdAt');
    const transcript = entries.find((e) => e.kind === 'transcript')!;
    const cleanup = entries.find((e) => e.kind === 'inference')!;
    expect(transcript.visibility).toBe('detail');
    expect(transcript.timestamps?.[1].start).toBe(1.5);
    expect(cleanup.visibility).toBe('primary');
    expect(cleanup.text).toContain('Actually, no');
    expect(cleanup.sourceRefs[0].entryId).toBe(transcript.id);
    // Whisper got WAV and asked for timestamps; cleanup got the transcript text.
    expect(calls[0].body.response_format).toBe('verbose_json');
    expect((calls[0].body.input_audio as { format: string }).format).toBe('wav');
    expect(JSON.stringify(calls[1].body.messages)).toContain('bike lanes');
    const stt = runs.find((r) => r.mode === 'stt')!;
    expect(stt.usage.cost).toBeCloseTo(0.00006);
    // Searchable.
    expect((await searchGroup(entry.groupId, 'bike lanes')).length).toBeGreaterThan(0);
  });

  it('waits for the network when offline and runs on reconnect', async () => {
    mockOpenRouter((path) => (path === 'audio/transcriptions' ? json(WHISPER_RESPONSE) : textStream('Clean.')));
    const { entry } = await seedRecording();
    (navigator as { onLine: boolean }).onLine = false;
    await runPipelineForRecording(entry.id);
    await waitFor(async () => (await db.runs.where('turnId').equals(entry.turnId).toArray()).some((r) => r.status === 'waiting_network'));
    (navigator as { onLine: boolean }).onLine = true;
    await db.runs.where('status').equals('waiting_network').modify({ status: 'queued' });
    notifyScheduler();
    const runs = await settled(entry.turnId);
    expect(runs.every((r) => r.status === 'done')).toBe(true);
  });

  it('stops at a failed step and resumes from it on retry', async () => {
    let fail = true;
    mockOpenRouter((path) => {
      if (path === 'audio/transcriptions') return fail ? json({ error: { message: 'bad audio' } }, 400) : json(WHISPER_RESPONSE);
      return textStream('Clean.');
    });
    const { entry } = await seedRecording();
    await runPipelineForRecording(entry.id);
    let runs = await settled(entry.turnId);
    expect(runs.map((r) => r.status)).toEqual(['failed', 'blocked']);
    const error = (await db.entries.where('turnId').equals(entry.turnId).toArray()).find((e) => e.kind === 'error')!;
    expect(error.visibility).toBe('primary');
    fail = false;
    await retryRun(runs[0].id);
    runs = await waitFor(async () => {
      const r = await db.runs.where('turnId').equals(entry.turnId).sortBy('createdAt');
      return r.every((x) => x.status === 'done') && r;
    });
    expect(runs.length).toBe(2);
    expect((await db.entries.get(error.id))!.visibility).toBe('detail');
  });

  it('marks interrupted paid requests uncertain and requires an explicit retry', async () => {
    const { entry, session, group } = await seedRecording();
    await db.runs.add({
      id: 'run_x',
      sessionId: session.id,
      groupId: group.id,
      turnId: entry.turnId,
      kind: 'process',
      mode: 'stt',
      model: 'openai/whisper-large-v3-turbo',
      trigger: 'auto',
      settings: {},
      instructions: '',
      sourceRefs: [{ entryId: entry.id, start: 0, end: 18 }],
      dependsOn: [],
      status: 'running',
      usage: {},
      outputEntryIds: [],
      createdAt: 1,
      updatedAt: 1,
    });
    await db.segments.add({ id: 'seg_x', runId: 'run_x', index: 0, start: 0, end: 18, status: 'requesting', attempts: 1 });
    await recoverRuns();
    expect((await db.runs.get('run_x'))!.status).toBe('failed');
    expect((await db.segments.get('seg_x'))!.status).toBe('uncertain');
    const calls = mockOpenRouter(() => json(WHISPER_RESPONSE));
    await retryRun('run_x');
    await waitFor(async () => (await db.runs.get('run_x'))!.status === 'done');
    expect(calls.length).toBe(1);
    expect((await db.segments.get('seg_x'))!.attempts).toBe(2);
  });

  it('asks for approval when an automatic run exceeds the cost ceiling', async () => {
    const calls = mockOpenRouter(() => json(WHISPER_RESPONSE));
    await updateSettings({ costCeiling: 0 });
    const { entry } = await seedRecording();
    await runPipelineForRecording(entry.id);
    const approval = await waitFor(async () => (await db.entries.where('turnId').equals(entry.turnId).toArray()).find((e) => e.kind === 'approval_request'));
    expect(calls.length).toBe(0);
    mockOpenRouter((path) => (path === 'audio/transcriptions' ? json(WHISPER_RESPONSE) : textStream('Clean.')));
    await resolveApproval(approval.id, true);
    const runs = await waitFor(async () => {
      const r = await db.runs.where('turnId').equals(entry.turnId).toArray();
      return r.every((x) => x.status === 'done') && r;
    });
    expect(runs.length).toBe(2);
  });

  it('can be cancelled, which cancels dependent steps', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mockOpenRouter(async (path) => {
      if (path === 'audio/transcriptions') {
        await gate;
        return json(WHISPER_RESPONSE);
      }
      return textStream('x');
    });
    const { entry } = await seedRecording();
    await runPipelineForRecording(entry.id);
    const stt = await waitFor(async () => (await db.runs.where('turnId').equals(entry.turnId).toArray()).find((r) => r.status === 'running'));
    await cancelRun(stt.id);
    release();
    const runs = await settled(entry.turnId);
    expect(runs.every((r) => r.status === 'cancelled')).toBe(true);
  });
});

describe('combined mode with Inkling', () => {
  it('sends audio and the transcript to the audio-aware model and keeps outputs separate', async () => {
    const calls = mockOpenRouter((path) => (path === 'audio/transcriptions' ? json(WHISPER_RESPONSE) : textStream('Observed: a pause before "queso".')));
    const { entry } = await seedRecording();
    const config = pipeline(
      step('transcribe', { model: WHISPER, output: 'show' }),
      step('listen', { model: INK, output: 'show', useTranscript: true, instructions: 'The speaker is practising a language.' }),
    );
    await processRecording(entry.id, config);
    const runs = await settled(entry.turnId);
    expect(runs.map((r) => r.mode)).toEqual(['stt', 'audio']);
    const inkling = calls.find((c) => c.body.model === 'thinkingmachines/inkling')!;
    const content = JSON.stringify(inkling.body.messages);
    expect(content).toContain('input_audio');
    expect(content).toContain('automatic transcript');
    const outs = await db.entries.where('turnId').equals(entry.turnId).toArray();
    expect(outs.filter((e) => e.kind === 'transcript').length).toBe(1);
    expect(outs.find((e) => e.kind === 'audio_notes')!.meta?.model).toBe('thinkingmachines/inkling');
    // The audio run records its dependency on the transcript.
    expect(runs[1].dependsOn).toEqual([runs[0].id]);
    expect(runs[1].instructions).toContain('practising a language');
    // Both steps were set to Show.
    expect(outs.filter((e) => e.kind === 'transcript' || e.kind === 'audio_notes').every((e) => e.visibility === 'primary')).toBe(true);
  });
});

describe('agent tools', () => {
  it('enforce the group boundary', async () => {
    const { group, entry } = await seedRecording();
    const other = await createGroup('Other');
    const otherSession = await createSession(other.id);
    const secret = await createEntry({ sessionId: otherSession.id, groupId: other.id, kind: 'user_message', text: 'secret plan', status: 'done', visibility: 'primary' });
    await expect(executeTool(group.id, 'read_entry', JSON.stringify({ entry_id: secret.id }))).rejects.toThrow(/No entry/);
    await expect(executeTool(group.id, 'list_entries', JSON.stringify({ session_id: otherSession.id }))).rejects.toThrow(/No session/);
    const hits = await executeTool(group.id, 'search_group', JSON.stringify({ query: 'secret' }));
    expect(hits).toEqual({ kind: 'result', result: [] });
    const own = await executeTool(group.id, 'read_entry', JSON.stringify({ entry_id: entry.id }));
    expect(own.kind).toBe('result');
  });

  it('retrieve context from another session, then pause for approved reprocessing and resume', async () => {
    const { group, entry: recording } = await seedRecording();
    const earlier = await createSession(group.id, 'Earlier');
    await createEntry({ sessionId: earlier.id, groupId: group.id, kind: 'transcript', text: 'Street space is a shared resource.', status: 'done', visibility: 'primary' });
    const session = await createSession(group.id, 'Now');
    let step = 0;
    const calls = mockOpenRouter((path, body) => {
      if (path === 'audio/transcriptions') return json(WHISPER_RESPONSE);
      if (body.model === 'thinkingmachines/inkling') return textStream('Hesitation at 0:01.');
      step++;
      if (step === 1) return toolCallStream('call_1', 'search_group', { query: 'shared resource' });
      if (step === 2) return toolCallStream('call_2', 'request_audio_processing', { recording_entry_id: recording.id, start: 0, end: 5, mode: 'audio', instructions: 'Listen for hesitation.' });
      return textStream('You said street space is shared [earlier]. Inkling heard hesitation at 0:01.');
    });
    const { run } = await sendMessage(session.id, 'What did I say before, and did I hesitate?', 'big');
    const approval = await waitFor(async () => (await db.entries.where('turnId').equals(run.turnId).toArray()).find((e) => e.kind === 'approval_request'));
    expect((await db.runs.get(run.id))!.status).toBe('awaiting_approval');
    expect(approval.meta?.model).toBe('thinkingmachines/inkling');
    expect(approval.meta?.end).toBe(5);
    expect(calls.filter((c) => c.body.model === 'thinkingmachines/inkling').length).toBe(0);
    await resolveApproval(approval.id, true);
    await waitFor(async () => (await db.runs.get(run.id))!.status === 'done');
    const out = (await db.entries.where('runId').equals(run.id).toArray()).find((e) => e.kind === 'inference')!;
    expect(out.text).toContain('hesitation');
    const toolEntries = (await db.entries.where('runId').equals(run.id).sortBy('createdAt')).filter((e) => e.kind === 'tool_call');
    expect(toolEntries.map((e) => e.title)).toEqual(['search_group', 'request_audio_processing']);
    expect(toolEntries.every((e) => e.visibility === 'detail' && e.status === 'done')).toBe(true);
    expect(String(toolEntries[0].meta?.result)).toContain('shared resource');
    // The final request includes both tool results.
    const last = calls.at(-1)!;
    const msgs = last.body.messages as { role: string; content: string }[];
    expect(msgs.filter((m) => m.role === 'tool').length).toBe(2);
    expect(msgs.find((m) => m.role === 'tool' && m.content.includes('Hesitation'))).toBeTruthy();
  });

  it('resumes with the refusal when the user declines', async () => {
    const { entry: recording } = await seedRecording();
    let step = 0;
    mockOpenRouter(() => {
      step++;
      if (step === 1) return toolCallStream('c1', 'request_audio_processing', { recording_entry_id: recording.id, mode: 'stt', instructions: 'again' });
      return textStream('Okay, without reprocessing.');
    });
    const { run } = await sendMessage(recording.sessionId, 'Re-transcribe please', 'little');
    const approval = await waitFor(async () => (await db.entries.where('turnId').equals(run.turnId).toArray()).find((e) => e.kind === 'approval_request'));
    await resolveApproval(approval.id, false);
    await waitFor(async () => (await db.runs.get(run.id))!.status === 'done');
    const procRun = (await db.runs.where('turnId').equals(run.turnId).toArray()).find((r) => r.kind === 'process')!;
    expect(procRun.status).toBe('cancelled');
  });
});

describe('long transcripts', () => {
  it('clean up in ordered chunks', async () => {
    const long = Array.from({ length: 1500 }, (_, i) => `Point ${i} is that, um, things matter.`).join(' ');
    let n = 0;
    const calls = mockOpenRouter((path) => {
      if (path === 'audio/transcriptions') return json({ text: long, usage: { cost: 0 } });
      n++;
      return textStream(`[chunk ${n}]`);
    });
    const { entry } = await seedRecording();
    await processRecording(entry.id, pipeline(step('transcribe', { model: 'openai/gpt-4o-mini-transcribe' }), step('assist', { preset: 'cleanup', output: 'show' })));
    await settled(entry.turnId);
    const cleanup = (await db.entries.where('turnId').equals(entry.turnId).toArray()).find((e) => e.kind === 'inference')!;
    const chunkCalls = calls.filter((c) => c.path === 'chat/completions');
    expect(chunkCalls.length).toBeGreaterThan(1);
    expect(cleanup.text).toBe(chunkCalls.map((_, i) => `[chunk ${i + 1}]`).join('\n\n'));
  });
});

describe('deletion', () => {
  it('removes audio and search records, optionally with derived outputs', async () => {
    mockOpenRouter((path) => (path === 'audio/transcriptions' ? json(WHISPER_RESPONSE) : textStream('Clean bike lanes.')));
    const { entry, recordingId } = await seedRecording();
    await runPipelineForRecording(entry.id);
    await settled(entry.turnId);
    await deleteEntry(entry.id);
    expect(await db.audioChunks.where('recordingId').equals(recordingId).count()).toBe(0);
    // Derived material stays (its source shows as deleted) and is still searchable.
    expect((await searchGroup(entry.groupId, 'bike')).length).toBeGreaterThan(0);
    const derived = await db.entries.where('turnId').equals(entry.turnId).toArray();
    expect(derived.length).toBeGreaterThan(0);

    const second = await seedRecording();
    await runPipelineForRecording(second.entry.id);
    await settled(second.entry.turnId);
    await deleteEntry(second.entry.id, { withDerived: true });
    expect(await db.entries.where('turnId').equals(second.entry.turnId).count()).toBe(0);
    expect(await db.runs.where('turnId').equals(second.entry.turnId).count()).toBe(0);
  });

  it('deletes a session completely', async () => {
    const { session } = await seedRecording();
    await deleteSession(session.id);
    expect(await db.entries.count()).toBe(0);
    expect(await db.audioChunks.count()).toBe(0);
    expect(await db.searchRecords.count()).toBe(0);
  });
});

describe('export and import', () => {
  it('round-trips the library, including audio, without credentials', async () => {
    const { recordingId, group } = await seedRecording();
    const before = await readPcm(recordingId, 0, 3);
    const blob = await exportLibrary();
    const text = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
    expect(text).not.toContain('sk-or-test');
    await deleteSession((await db.sessions.toArray())[0].id);
    await db.groups.clear();
    const summary = await importLibrary(blob);
    expect(summary.added.entries).toBe(1);
    expect((await db.groups.get(group.id))?.name).toBe('Essays');
    const after = await readPcm(recordingId, 0, 3);
    expect([...after.slice(0, 50)]).toEqual([...before.slice(0, 50)]);
    // Importing again skips everything.
    const again = await importLibrary(blob);
    expect(again.added.entries).toBe(0);
  });
});

vi.setConfig({ testTimeout: 15000 });

describe('long recordings', () => {
  it('process in bounded segments cut at pauses, with global timestamps', async () => {
    // 11 minutes of "speech" (noise) with a short silence near every 5-minute mark.
    const rate = 16000;
    const samples = new Int16Array(rate * 660);
    for (let i = 0; i < samples.length; i++) samples[i] = ((i * 7919) % 2000) - 1000;
    for (const quiet of [296, 607]) samples.fill(0, quiet * rate, (quiet + 1) * rate);
    const sizes: number[] = [];
    mockOpenRouter((path, body) => {
      if (path === 'audio/transcriptions') {
        const bytes = atob((body.input_audio as { data: string }).data).length;
        sizes.push(bytes);
        return json({ text: `part ${sizes.length}`, segments: [{ start: 1, end: 2, text: `part ${sizes.length}` }], usage: { cost: 0.001 } });
      }
      return textStream('ok');
    });
    const { entry } = await seedRecording(samples, rate);
    await processRecording(entry.id, pipeline(step('transcribe', { model: WHISPER, output: 'show' })));
    const [run] = await settled(entry.turnId);
    expect(run.status).toBe('done');
    const segs = await db.segments.where('runId').equals(run.id).sortBy('index');
    expect(segs.length).toBe(3);
    expect(segs[0].end).toBeGreaterThan(296);
    expect(segs[0].end).toBeLessThan(297.2);
    expect(segs[1].end).toBeGreaterThan(607);
    // Each request is at most ~5.25 minutes of 16 kHz mono WAV (~10 MB), well under limits.
    expect(Math.max(...sizes)).toBeLessThan(16000 * 2 * 320);
    const transcript = (await db.entries.where('turnId').equals(entry.turnId).toArray()).find((e) => e.kind === 'transcript')!;
    expect(transcript.timestamps!.map((t) => Math.round(t.start))).toEqual([1, Math.round(segs[1].start + 1), Math.round(segs[2].start + 1)]);
    expect(run.usage.cost).toBeCloseTo(0.003);
  }, 60000);
});

describe('fixes from review', () => {
  it('cleanup uses only the transcript, not audio notes', async () => {
    const calls = mockOpenRouter((path, body) => {
      if (path === 'audio/transcriptions') return json(WHISPER_RESPONSE);
      if (body.model === 'thinkingmachines/inkling') return textStream('- Hesitation before "bike lanes"');
      return textStream('Cleaned.');
    });
    const { entry } = await seedRecording();
    await processRecording(
      entry.id,
      pipeline(step('transcribe', { model: WHISPER }), step('listen', { model: INK, useTranscript: true }), step('assist', { preset: 'cleanup', input: 'all', output: 'show' })),
    );
    await settled(entry.turnId);
    const cleanupCall = calls.find((c) => c.path === 'chat/completions' && c.body.model === 'anthropic/claude-haiku-5.5')!;
    const sent = JSON.stringify(cleanupCall.body.messages);
    expect(sent).toContain('bike lanes. Actually');
    expect(sent).not.toContain('Hesitation before');
    // Inkling was told not to repeat the transcript it was given.
    const inkling = calls.find((c) => c.body.model === 'thinkingmachines/inkling')!;
    expect(JSON.stringify(inkling.body.messages)).toContain('Do not repeat the transcript');
  });

  it('migrates old saved settings: shorter instructions (v2) and step-list pipelines (v3)', async () => {
    const { default: Dexie } = await import('dexie');
    const { OLD_PROCESSING_INSTRUCTIONS_V1, OLD_LANGUAGE_PRACTICE_V1 } = await import('./migrations');
    const { DEFAULT_PROCESSING_INSTRUCTIONS, LANGUAGE_PRACTICE_PROCESSING, defaultSettings } = await import('./defaults');
    const { VoiceNotesDB } = await import('./db');
    const name = `migrate-${Math.random()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({ groups: 'id', sessions: 'id', settings: 'id' });
    const legacy = (mode: string, preset: string, instructions = '') => ({
      process: { mode, sttModel: WHISPER, audioModel: INK, language: 'es', transcriptToAudioModel: true, instructions },
      infer: { preset, instructions: '' },
    });
    await v1.table('settings').put({
      ...defaultSettings(),
      instructions: { processing: OLD_PROCESSING_INSTRUCTIONS_V1, inference: 'x' },
      pipeline: legacy('stt', 'cleanup'),
      pipelinePresets: [
        { id: 'thinking-aloud', name: 'Thinking aloud', config: legacy('stt', 'cleanup'), builtin: true },
        { id: 'language-practice', name: 'Language practice', config: legacy('combined', 'tutor', OLD_LANGUAGE_PRACTICE_V1), builtin: true },
      ],
    });
    await v1.table('sessions').put({ id: 's1', instructions: { processing: 'My own words.' }, pipeline: legacy('combined', 'off', OLD_LANGUAGE_PRACTICE_V1) });
    v1.close();

    const db3 = new VoiceNotesDB(name);
    const migrated = (await db3.settings.get('global'))!;
    expect(migrated.instructions.processing).toBe(DEFAULT_PROCESSING_INSTRUCTIONS);
    expect(migrated.pipeline.steps.map((x) => [x.kind, x.output])).toEqual([
      ['transcribe', 'collapse'],
      ['assist', 'show'],
    ]);
    expect(migrated.pipeline.language).toBe('es');
    const lp = migrated.pipelinePresets.find((p) => p.id === 'language-practice')!.config;
    expect(lp.steps.map((x) => x.kind)).toEqual(['transcribe', 'listen', 'assist']);
    expect(lp.steps[1].instructions).toBe(LANGUAGE_PRACTICE_PROCESSING);
    expect(lp.steps[2].input).toBe('all');
    expect(migrated.pipelinePresets.some((p) => p.id === 'transcribe-inkling')).toBe(true);
    const session = (await db3.sessions.get('s1'))!;
    expect(session.instructions.processing).toBe('My own words.');
    // Combined without assistance: transcript collapsed, Inkling's notes shown, as before.
    expect(session.pipeline!.steps.map((x) => [x.kind, x.output, x.useTranscript ?? null])).toEqual([
      ['transcribe', 'collapse', null],
      ['listen', 'show', true],
    ]);
    db3.close();
  });
});

describe('multi-step pipelines', () => {
  it('chains assist steps: summarise reads the cleanup, not the transcript', async () => {
    const calls = mockOpenRouter((path, body) => {
      if (path === 'audio/transcriptions') return json(WHISPER_RESPONSE);
      const sys = JSON.stringify((body.messages as unknown[])[0]);
      return textStream(sys.includes('Clean up') ? 'CLEANED TEXT about bike lanes.' : '- Summary point');
    });
    const { entry } = await seedRecording();
    await processRecording(
      entry.id,
      pipeline(step('transcribe', { model: WHISPER }), step('assist', { preset: 'cleanup' }), step('assist', { preset: 'summarize', output: 'show' })),
    );
    const runs = await settled(entry.turnId);
    expect(runs.map((r) => [r.mode, r.status])).toEqual([
      ['stt', 'done'],
      ['cleanup', 'done'],
      ['summarize', 'done'],
    ]);
    expect(runs[2].dependsOn).toEqual([runs[1].id]);
    const summariseCall = calls.filter((c) => c.path === 'chat/completions').at(-1)!;
    const sent = JSON.stringify(summariseCall.body.messages);
    expect(sent).toContain('CLEANED TEXT');
    expect(sent).not.toContain('um, bike lanes');
    // Show/Collapse: only the last step is in the session view; it links back to the cleanup.
    const entries = await db.entries.where('turnId').equals(entry.turnId).sortBy('createdAt');
    const visible = entries.filter((e) => e.visibility === 'primary' && e.id !== entry.id);
    expect(visible.map((e) => e.text)).toEqual(['- Summary point']);
    const cleanup = entries.find((e) => e.text.startsWith('CLEANED'))!;
    expect(cleanup.visibility).toBe('detail');
    expect(visible[0].sourceRefs.map((r) => r.entryId)).toEqual([cleanup.id]);
  });

  it('runs independent steps and skips an assist step with nothing before it', async () => {
    const calls = mockOpenRouter((path) => (path === 'audio/transcriptions' ? json(WHISPER_RESPONSE) : textStream('notes')));
    const { entry } = await seedRecording();
    const plan = await processRecording(entry.id, pipeline(step('assist', { preset: 'cleanup' }), step('listen', { model: INK, output: 'show' })));
    expect(plan.runs.map((r) => r.mode)).toEqual(['audio']);
    await settled(entry.turnId);
    // With no transcript available, Inkling is asked to transcribe first.
    expect(JSON.stringify(calls[0].body.messages)).toContain('Start with a verbatim transcript');
  });

  it('the Transcribe + Inkling preset shows both outputs side by side', async () => {
    mockOpenRouter((path) => (path === 'audio/transcriptions' ? json(WHISPER_RESPONSE) : textStream('- hesitation on "um"')));
    const { entry } = await seedRecording();
    await processRecording(entry.id, PIPELINE_PRESETS.find((p) => p.id === 'transcribe-inkling')!.config);
    await settled(entry.turnId);
    const shown = (await db.entries.where('turnId').equals(entry.turnId).sortBy('createdAt')).filter((e) => e.visibility === 'primary' && e.id !== entry.id);
    expect(shown.map((e) => e.kind)).toEqual(['transcript', 'audio_notes']);
  });

  it('accepts old-shape pipelines from an imported library', async () => {
    const calls = mockOpenRouter((path) => (path === 'audio/transcriptions' ? json(WHISPER_RESPONSE) : textStream('Clean.')));
    const { entry, session } = await seedRecording();
    // As if imported from an export made before step lists.
    await db.sessions.update(session.id, {
      pipeline: { process: { mode: 'stt', sttModel: WHISPER, audioModel: INK, language: '', transcriptToAudioModel: true, instructions: '' }, infer: { preset: 'cleanup', instructions: '' } } as never,
    });
    await runPipelineForRecording(entry.id);
    const runs = await settled(entry.turnId);
    expect(runs.map((r) => r.mode)).toEqual(['stt', 'cleanup']);
    expect(calls.length).toBe(2);
  });
});
