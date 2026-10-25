import { strFromU8, strToU8, unzip, zip, type Unzipped } from 'fflate';
import { db } from './db';
import type { AudioChunk } from './types';

const FORMAT = 'voice-notes-library';
const VERSION = 1;

type Tables = 'groups' | 'sessions' | 'entries' | 'recordings' | 'runs' | 'segments' | 'searchRecords' | 'settings';
const TABLES: Tables[] = ['groups', 'sessions', 'entries', 'recordings', 'runs', 'segments', 'searchRecords', 'settings'];

/**
 * Export the whole library as a zip: library.json plus raw PCM audio chunks.
 * Credentials are never included (they are not in the database). Cached speech is
 * left out because it can be regenerated.
 */
/**
 * Export the library (or one session of it) as a zip: library.json plus raw PCM audio
 * chunks. The same format imports through Settings, merging by id. Credentials are
 * never included (they are not in the database). Cached speech is left out because it
 * can be regenerated.
 */
export async function exportLibrary(scope: { sessionId?: string } = {}): Promise<Blob> {
  const data: Record<string, unknown[]> = {};
  const session = scope.sessionId ? await db.sessions.get(scope.sessionId) : undefined;
  if (scope.sessionId && !session) throw new Error('Session not found');
  for (const t of TABLES) {
    if (!session) data[t] = await db.table(t).toArray();
    else if (t === 'settings') data[t] = [];
    else if (t === 'groups') data[t] = (await db.groups.bulkGet([session.groupId])).filter(Boolean);
    else if (t === 'sessions') data[t] = [session];
    else if (t === 'segments') {
      const runIds = await db.runs.where('sessionId').equals(session.id).primaryKeys();
      data[t] = await db.segments.where('runId').anyOf(runIds).toArray();
    } else data[t] = await db.table(t).where('sessionId').equals(session.id).toArray();
  }
  const recordingIds = session ? (data.recordings as { id: string }[]).map((r) => r.id) : null;
  const chunks = recordingIds ? await db.audioChunks.where('recordingId').anyOf(recordingIds).toArray() : await db.audioChunks.toArray();
  const files: Record<string, Uint8Array> = {};
  const chunkMeta = [];
  for (const c of chunks) {
    const path = `audio/${c.recordingId}/${String(c.index).padStart(6, '0')}.pcm`;
    files[path] = new Uint8Array(await c.data.arrayBuffer());
    chunkMeta.push({ id: c.id, recordingId: c.recordingId, index: c.index, start: c.start, end: c.end, path });
  }
  files['library.json'] = strToU8(
    JSON.stringify({ format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), tables: data, audioChunks: chunkMeta }),
  );
  return zipBlob(files);
}

export function zipBlob(files: Record<string, Uint8Array>): Promise<Blob> {
  return new Promise((resolve, reject) =>
    // Audio is already dense; store it without compression to keep export fast.
    zip(files, { level: 0 }, (err, out) => (err ? reject(err) : resolve(new Blob([out as BlobPart], { type: 'application/zip' })))),
  );
}

export interface ImportSummary {
  added: Record<string, number>;
  skipped: number;
}

/** Import a library export, merging by id: items already present are kept as they are. */
export async function importLibrary(file: Blob): Promise<ImportSummary> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const files = await new Promise<Unzipped>((resolve, reject) => unzip(buf, (err, out) => (err ? reject(err) : resolve(out))));
  const manifest = files['library.json'];
  if (!manifest) throw new Error('This file is not a Voice Notes library export.');
  const lib = JSON.parse(strFromU8(manifest));
  if (lib.format !== FORMAT) throw new Error('This file is not a Voice Notes library export.');
  if (lib.version > VERSION) throw new Error('This export comes from a newer version of Voice Notes. Update the app and try again.');

  const summary: ImportSummary = { added: {}, skipped: 0 };
  await db.transaction('rw', [...TABLES.map((t) => db.table(t)), db.audioChunks], async () => {
    for (const t of TABLES) {
      if (t === 'settings') continue;
      const rows = (lib.tables[t] ?? []) as { id: string }[];
      const existing = new Set(await db.table(t).where('id').anyOf(rows.map((r) => r.id)).primaryKeys());
      const fresh = rows.filter((r) => !existing.has(r.id));
      summary.skipped += rows.length - fresh.length;
      await db.table(t).bulkAdd(fresh);
      summary.added[t] = fresh.length;
    }
    if (!(await db.settings.get('global')) && lib.tables.settings?.[0]) await db.settings.add(lib.tables.settings[0]);
    const existingChunks = new Set(await db.audioChunks.where('id').anyOf(lib.audioChunks.map((c: AudioChunk) => c.id)).primaryKeys());
    const chunks: AudioChunk[] = [];
    for (const c of lib.audioChunks as (Omit<AudioChunk, 'data'> & { path: string })[]) {
      if (existingChunks.has(c.id)) continue;
      const bytes = files[c.path];
      if (!bytes) continue;
      chunks.push({ id: c.id, recordingId: c.recordingId, index: c.index, start: c.start, end: c.end, data: new Blob([bytes as BlobPart]) });
    }
    await db.audioChunks.bulkAdd(chunks);
    summary.added.audioChunks = chunks.length;
  });
  return summary;
}

export interface StorageStatus {
  usage: number;
  quota: number;
  persisted: boolean;
  supported: boolean;
}

export async function storageStatus(): Promise<StorageStatus> {
  const s = navigator.storage;
  if (!s?.estimate) return { usage: 0, quota: 0, persisted: false, supported: false };
  const [{ usage = 0, quota = 0 }, persisted] = await Promise.all([s.estimate(), s.persisted?.() ?? Promise.resolve(false)]);
  return { usage, quota, persisted, supported: true };
}

export async function requestPersistence(): Promise<boolean> {
  return (await navigator.storage?.persist?.()) ?? false;
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
