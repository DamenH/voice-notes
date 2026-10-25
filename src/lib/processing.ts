import { db } from './db';
import { newId, now } from './ids';
import { createEntry } from './library';
import { blobToBase64, formatTime } from './audio/pcm';
import { assembleTimed, planSegments } from './audio/segments';
import { energyReader, rangeWav } from './audio/store';
import { OpenRouterError, chat, transcribe } from './openrouter/client';
import type { Run, Segment, TimedText, Usage } from './types';

export class RunPaused extends Error {
  status: 'waiting_network' | 'awaiting_approval' | 'blocked';
  constructor(status: RunPaused['status']) {
    super(status);
    this.status = status;
  }
}

export function addUsage(a: Usage, b?: Usage): Usage {
  if (!b) return a;
  const sum = (x?: number, y?: number) => (x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0));
  return {
    cost: sum(a.cost, b.cost),
    promptTokens: sum(a.promptTokens, b.promptTokens),
    completionTokens: sum(a.completionTokens, b.completionTokens),
    seconds: sum(a.seconds, b.seconds),
    characters: sum(a.characters, b.characters),
  };
}

async function recordingFor(run: Run) {
  const ref = run.sourceRefs[0];
  const entry = ref && (await db.entries.get(ref.entryId));
  const recordingId = entry?.meta?.recordingId as string | undefined;
  const rec = recordingId && (await db.recordings.get(recordingId));
  if (!entry || !rec) throw new Error('The source recording was deleted.');
  return { entry, rec, start: ref.start ?? 0, end: Math.min(ref.end ?? rec.duration, rec.duration) };
}

async function ensureSegments(run: Run, segmentSeconds: number): Promise<Segment[]> {
  const existing = await db.segments.where('runId').equals(run.id).sortBy('index');
  if (existing.length) return existing;
  const { rec, start, end } = await recordingFor(run);
  const ranges = await planSegments({ start, end }, segmentSeconds, energyReader(rec.id));
  const segments: Segment[] = ranges.map((r, index) => ({
    id: newId('seg'),
    runId: run.id,
    index,
    start: r.start,
    end: r.end,
    status: 'pending',
    attempts: 0,
  }));
  await db.segments.bulkAdd(segments);
  return segments;
}

/** Transcript text for a time range from a finished transcription run, for audio-model context. */
async function transcriptForRange(runIds: string[], start: number, end: number): Promise<string | null> {
  for (const id of runIds) {
    const dep = await db.runs.get(id);
    if (dep?.kind !== 'process' || dep.mode !== 'stt' || !dep.outputEntryIds[0]) continue;
    const out = await db.entries.get(dep.outputEntryIds[0]);
    if (!out) continue;
    if (!out.timestamps) return out.text;
    return out.timestamps
      .filter((t) => t.end > start && t.start < end)
      .map((t) => t.text)
      .join(' ');
  }
  return null;
}

/**
 * Execute a processing run segment by segment. Each segment's state is persisted before
 * and after its paid request, so an interruption never silently re-sends a request.
 */
export async function executeProcessRun(run: Run, segmentSeconds: number, signal: AbortSignal) {
  const { entry: recording, rec } = await recordingFor(run);
  const segments = await ensureSegments(run, segmentSeconds);
  const total = segments.length;
  for (const seg of segments) {
    if (seg.status === 'done') continue;
    if (seg.status === 'uncertain') {
      throw new OpenRouterError('network', 'A request was interrupted and may already have been charged. Retry to send it again.', {
        ambiguous: true,
      });
    }
    signal.throwIfAborted();
    await db.segments.update(seg.id, { status: 'requesting', attempts: seg.attempts + 1 });
    try {
      const wav = await rangeWav(rec.id, seg.start, seg.end);
      const data = await blobToBase64(wav);
      let text: string;
      let timestamps: TimedText[] | undefined;
      let usage: Usage;
      if (run.mode === 'stt') {
        const language = String(run.settings.language ?? '') || undefined;
        const r = await transcribe({ model: run.model, wavBase64: data, language, timestamps: true }, signal);
        ({ text, timestamps, usage } = r);
      } else {
        const transcript = run.settings.withTranscript ? await transcriptForRange(run.dependsOn, seg.start, seg.end) : null;
        const context = [
          total > 1 ? `This is part ${seg.index + 1} of ${total}, covering ${formatTime(seg.start)}–${formatTime(seg.end)} of the recording.` : '',
          transcript
            ? `An automatic transcript of this audio, for reference (it may contain errors; trust what you hear):\n"""${transcript}"""\n\nDo not repeat the transcript; give only your notes.`
            : 'Start with a verbatim transcript (including fillers), then your notes.',
          'Process the attached audio according to the instructions.',
        ]
          .filter(Boolean)
          .join('\n\n');
        const r = await chat(
          {
            model: run.model,
            messages: [
              ...(run.instructions ? [{ role: 'system' as const, content: run.instructions }] : []),
              {
                role: 'user',
                content: [
                  { type: 'text', text: context },
                  { type: 'input_audio', input_audio: { data, format: 'wav' } },
                ],
              },
            ],
          },
          { signal },
        );
        text = typeof r.message.content === 'string' ? r.message.content : '';
        usage = r.usage;
      }
      await db.segments.update(seg.id, { status: 'done', text, timestamps, usage });
      const latest = await db.runs.get(run.id);
      await db.runs.update(run.id, { usage: addUsage(latest?.usage ?? {}, usage), updatedAt: now() });
    } catch (e) {
      const err = e instanceof OpenRouterError ? e : null;
      if (err?.kind === 'offline') {
        await db.segments.update(seg.id, { status: 'pending' });
        throw new RunPaused('waiting_network');
      }
      await db.segments.update(seg.id, {
        status: err?.ambiguous && err.kind !== 'cancelled' ? 'uncertain' : 'failed',
        error: (e as Error).message,
      });
      throw e;
    }
  }

  const done = await db.segments.where('runId').equals(run.id).sortBy('index');
  const assembled =
    run.mode === 'stt'
      ? assembleTimed(done.map((s) => ({ offset: s.start, text: s.text ?? '', timestamps: s.timestamps })))
      : {
          text: done
            .map((s) => (done.length > 1 ? `**${formatTime(s.start)}–${formatTime(s.end)}**\n\n${s.text ?? ''}` : (s.text ?? '')))
            .join('\n\n'),
        };
  const ref = run.sourceRefs[0];
  const output = await createEntry({
    sessionId: run.sessionId,
    groupId: run.groupId,
    turnId: run.turnId,
    runId: run.id,
    kind: run.mode === 'stt' ? 'transcript' : 'audio_notes',
    title: run.mode === 'stt' ? 'Transcript' : 'Audio notes',
    text: assembled.text,
    timestamps: assembled.timestamps,
    status: 'done',
    visibility: run.settings.primary ? 'primary' : 'detail',
    sourceRefs: [{ entryId: recording.id, start: ref?.start, end: ref?.end }],
    meta: { model: run.model, segments: done.length },
  });
  await db.runs.update(run.id, { outputEntryIds: [output.id] });
}
