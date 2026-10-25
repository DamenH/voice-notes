import workletUrl from './capture-worklet.js?url';
import { db } from '../db';
import { newId, now } from '../ids';
import { createEntry } from '../library';
import { CHUNK_SECONDS, SAMPLE_RATE } from './pcm';

export type RecorderState = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping';

export interface RecorderSnapshot {
  state: RecorderState;
  sessionId: string | null;
  recordingId: string | null;
  entryId: string | null;
  elapsed: number;
  level: number;
  warning: string | null;
}

type Listener = (s: RecorderSnapshot) => void;

/**
 * Captures 16 kHz mono PCM and saves it to IndexedDB every few seconds, so at most one
 * chunk of audio can be lost if the page is killed. One recorder per app.
 */
class Recorder {
  private snap: RecorderSnapshot = {
    state: 'idle',
    sessionId: null,
    recordingId: null,
    entryId: null,
    elapsed: 0,
    level: 0,
    warning: null,
  };
  private listeners = new Set<Listener>();
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private pending: Int16Array[] = [];
  private pendingSamples = 0;
  private savedSamples = 0;
  private chunkIndex = 0;
  private wakeLock: WakeLockSentinel | null = null;
  private flushing: Promise<void> = Promise.resolve();
  private onFlushed: (() => void) | null = null;

  get snapshot() {
    return this.snap;
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private set(patch: Partial<RecorderSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((fn) => fn(this.snap));
  }

  async start(sessionId: string, groupId: string): Promise<void> {
    if (this.snap.state !== 'idle') throw new Error('Already recording');
    this.set({ state: 'starting', warning: null });
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (e) {
      this.set({ state: 'idle' });
      throw new Error(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Allow microphone access in your browser settings.'
          : `Could not open the microphone: ${(e as Error).message}`,
      );
    }
    this.ctx = new AudioContext();
    await this.ctx.audioWorklet.addModule(workletUrl);
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'pcm-capture', { processorOptions: { targetRate: SAMPLE_RATE } });
    this.node.port.onmessage = (e: MessageEvent<{ samples: Int16Array; peak: number; flushed?: boolean }>) => {
      this.onSamples(e.data);
      if (e.data.flushed) this.onFlushed?.();
    };
    source.connect(this.node);
    // Some browsers only pull audio through nodes connected to the destination; keep it silent.
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.node.connect(mute).connect(this.ctx.destination);
    this.ctx.onstatechange = () => this.onContextState();
    this.stream.getAudioTracks()[0]?.addEventListener('ended', () => {
      this.set({ warning: 'The microphone stopped. Your recording up to this point is saved.' });
      void this.stop();
    });

    const entry = await createEntry({
      sessionId,
      groupId,
      kind: 'recording',
      text: '',
      title: 'Recording',
      status: 'running',
      visibility: 'primary',
    });
    const recordingId = newId('rec');
    await db.recordings.add({
      id: recordingId,
      entryId: entry.id,
      sessionId,
      sampleRate: SAMPLE_RATE,
      duration: 0,
      chunkCount: 0,
      state: 'recording',
      createdAt: now(),
    });
    await db.entries.update(entry.id, { meta: { recordingId, duration: 0 } });
    this.pending = [];
    this.pendingSamples = 0;
    this.savedSamples = 0;
    this.chunkIndex = 0;
    this.set({ state: 'recording', sessionId, recordingId, entryId: entry.id, elapsed: 0, level: 0 });
    void this.acquireWakeLock();
  }

  private onSamples({ samples, peak }: { samples: Int16Array; peak: number }) {
    if (this.snap.state !== 'recording') return;
    this.pending.push(samples);
    this.pendingSamples += samples.length;
    this.set({ elapsed: (this.savedSamples + this.pendingSamples) / SAMPLE_RATE, level: peak });
    if (this.pendingSamples >= SAMPLE_RATE * CHUNK_SECONDS) this.queueFlush();
  }

  private queueFlush() {
    const parts = this.pending;
    const count = this.pendingSamples;
    this.pending = [];
    this.pendingSamples = 0;
    if (count === 0) return this.flushing;
    const merged = new Int16Array(count);
    let o = 0;
    for (const p of parts) {
      merged.set(p, o);
      o += p.length;
    }
    const start = this.savedSamples / SAMPLE_RATE;
    this.savedSamples += count;
    const end = this.savedSamples / SAMPLE_RATE;
    const index = this.chunkIndex++;
    const recordingId = this.snap.recordingId!;
    const entryId = this.snap.entryId!;
    this.flushing = this.flushing.then(async () => {
      try {
        await db.transaction('rw', db.audioChunks, db.recordings, db.entries, async () => {
          await db.audioChunks.add({ id: newId('chk'), recordingId, index, start, end, data: new Blob([merged.buffer]) });
          await db.recordings.update(recordingId, { duration: end, chunkCount: index + 1 });
          await db.entries.update(entryId, { meta: { recordingId, duration: end }, updatedAt: now() });
        });
      } catch (e) {
        this.set({
          warning:
            (e as Error).name === 'QuotaExceededError'
              ? 'Storage is full. Recording stopped; everything before this point is saved.'
              : `Could not save audio: ${(e as Error).message}`,
        });
        void this.stop();
      }
    });
    return this.flushing;
  }

  pause() {
    if (this.snap.state !== 'recording') return;
    void this.queueFlush();
    this.set({ state: 'paused', level: 0 });
  }

  resume() {
    if (this.snap.state === 'paused') this.set({ state: 'recording' });
  }

  /** Stop and persist. Resolves with the recording entry id once everything is saved. */
  async stop(): Promise<{ entryId: string; recordingId: string; sessionId: string } | null> {
    const { state, recordingId, entryId, sessionId } = this.snap;
    if (state !== 'recording' && state !== 'paused') return null;
    // Collect the worklet's partial batch (accepted even while paused is ending).
    if (state === 'recording' && this.node) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 300);
        this.onFlushed = () => {
          clearTimeout(timer);
          resolve();
        };
        this.node!.port.postMessage('flush');
      });
      this.onFlushed = null;
    }
    this.set({ state: 'stopping' });
    await this.queueFlush();
    await this.flushing;
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => {});
    this.ctx = this.node = this.stream = null;
    void this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
    const duration = this.savedSamples / SAMPLE_RATE;
    await db.recordings.update(recordingId!, { state: 'complete', duration });
    await db.entries.update(entryId!, { status: 'done', meta: { recordingId, duration }, updatedAt: now() });
    this.set({ state: 'idle', sessionId: null, recordingId: null, entryId: null, level: 0 });
    return { entryId: entryId!, recordingId: recordingId!, sessionId: sessionId! };
  }

  private onContextState() {
    const s = this.ctx?.state as string | undefined;
    if (this.snap.state === 'recording' && (s === 'suspended' || s === 'interrupted')) {
      this.set({ warning: 'Recording was interrupted by the system. Trying to resume…' });
      void this.ctx?.resume().then(() => this.set({ warning: null }));
    }
  }

  private async acquireWakeLock() {
    try {
      this.wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
    } catch {
      /* Not supported or denied: recording continues, the UI advises keeping the screen on. */
    }
  }

  /** Re-acquire the wake lock when returning to the page (browsers release it when hidden). */
  onVisible() {
    if (this.snap.state === 'recording' && !this.wakeLock) void this.acquireWakeLock();
  }
}

export const recorder = new Recorder();

/** On startup, recordings left in 'recording' state were interrupted (tab closed, crash). Keep what was saved. */
export async function recoverInterruptedRecordings(activeRecordingId: string | null = null) {
  const stale = await db.recordings.where('state').equals('recording').toArray();
  for (const rec of stale) {
    if (rec.id === activeRecordingId) continue;
    const chunks = await db.audioChunks.where('recordingId').equals(rec.id).toArray();
    const duration = chunks.reduce((m, c) => Math.max(m, c.end), 0);
    await db.recordings.update(rec.id, { state: 'interrupted', duration, chunkCount: chunks.length });
    await db.entries.update(rec.entryId, {
      status: 'done',
      meta: { recordingId: rec.id, duration, interrupted: true },
      updatedAt: now(),
    });
  }
  return stale.length;
}
