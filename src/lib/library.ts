import { db } from './db';
import { newId, now } from './ids';
import { formatTime } from './audio/pcm';
import type { Entry, Group, Id, Session } from './types';

export async function createGroup(name: string): Promise<Group> {
  const t = now();
  const group: Group = { id: newId('grp'), name, instructions: {}, pipeline: null, tts: null, createdAt: t, updatedAt: t };
  await db.groups.add(group);
  return group;
}

export async function createSession(groupId: Id, title = ''): Promise<Session> {
  const t = now();
  const session: Session = {
    id: newId('ses'),
    groupId,
    title: title || defaultSessionTitle(t),
    instructions: {},
    pipeline: null,
    tts: null,
    showDetails: null,
    createdAt: t,
    updatedAt: t,
    lastActivityAt: t,
  };
  await db.sessions.add(session);
  return session;
}

export function defaultSessionTitle(t: number) {
  return new Date(t).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export type NewEntry = Pick<Entry, 'sessionId' | 'groupId' | 'kind' | 'text' | 'status' | 'visibility'> &
  Partial<Pick<Entry, 'turnId' | 'runId' | 'sourceRefs' | 'timestamps' | 'title' | 'meta' | 'id'>>;

export async function createEntry(input: NewEntry): Promise<Entry> {
  const t = now();
  const id = input.id ?? newId('ent');
  const entry: Entry = {
    sourceRefs: [],
    ...input,
    id,
    turnId: input.turnId ?? id,
    createdAt: t,
    updatedAt: t,
  };
  await db.transaction('rw', db.entries, db.searchRecords, db.sessions, async () => {
    await db.entries.add(entry);
    await indexEntry(entry);
    await db.sessions.update(entry.sessionId, { lastActivityAt: t });
  });
  return entry;
}

export async function updateEntry(id: Id, patch: Partial<Entry>) {
  await db.transaction('rw', db.entries, db.searchRecords, async () => {
    await db.entries.update(id, { ...patch, updatedAt: now() });
    const entry = await db.entries.get(id);
    if (entry) await indexEntry(entry);
  });
}

const SEARCHABLE: Entry['kind'][] = ['recording', 'user_message', 'transcript', 'audio_notes', 'inference', 'tool_call'];

/** Keep the search record for an entry in sync. Call inside a transaction that includes searchRecords. */
async function indexEntry(entry: Entry) {
  if (!SEARCHABLE.includes(entry.kind)) return;
  const text =
    entry.kind === 'recording'
      ? `Recording ${formatTime(Number(entry.meta?.duration ?? 0))} ${entry.title ?? ''}`
      : entry.kind === 'tool_call'
        ? String(entry.meta?.result ?? '')
        : entry.text;
  await db.searchRecords.put({
    id: `sr_${entry.id}`,
    groupId: entry.groupId,
    sessionId: entry.sessionId,
    entryId: entry.id,
    kind: entry.kind,
    text,
    title: entry.title ?? '',
    createdAt: entry.createdAt,
  });
}

/** Delete entries and everything that hangs off them (audio, search records, cached speech, segments of their runs). */
async function deleteEntriesCascade(ids: Id[]) {
  if (ids.length === 0) return;
  const recordings = await db.recordings.where('entryId').anyOf(ids).toArray();
  const recIds = recordings.map((r) => r.id);
  await db.audioChunks.where('recordingId').anyOf(recIds).delete();
  await db.recordings.bulkDelete(recIds);
  await db.searchRecords.where('entryId').anyOf(ids).delete();
  await db.ttsCache.where('entryId').anyOf(ids).delete();
  await db.entries.bulkDelete(ids);
}

const ALL_TABLES = () => [db.entries, db.recordings, db.audioChunks, db.searchRecords, db.ttsCache, db.runs, db.segments];

/** Entries that were derived (directly or transitively) from the given entries. */
export async function derivedEntryIds(sessionId: Id, rootIds: Id[]): Promise<Id[]> {
  const entries = await db.entries.where('sessionId').equals(sessionId).toArray();
  const found = new Set<Id>();
  let frontier = new Set(rootIds);
  while (frontier.size) {
    const next = new Set<Id>();
    for (const e of entries) {
      if (found.has(e.id) || rootIds.includes(e.id)) continue;
      if (e.sourceRefs.some((r) => frontier.has(r.entryId))) {
        found.add(e.id);
        next.add(e.id);
      }
    }
    frontier = next;
  }
  return [...found];
}

/**
 * Delete an entry. With `withDerived`, outputs produced from it go too; otherwise they
 * remain and show their source as deleted.
 */
export async function deleteEntry(id: Id, { withDerived = false } = {}) {
  const entry = await db.entries.get(id);
  if (!entry) return;
  const ids = [id, ...(withDerived ? await derivedEntryIds(entry.sessionId, [id]) : [])];
  await db.transaction('rw', ALL_TABLES(), async () => {
    await deleteEntriesCascade(ids);
    // Drop runs whose outputs are all gone.
    const runs = await db.runs.where('sessionId').equals(entry.sessionId).toArray();
    for (const run of runs) {
      const remaining = run.outputEntryIds.filter((o) => !ids.includes(o));
      if (run.outputEntryIds.length && remaining.length === 0 && !['queued', 'running'].includes(run.status)) {
        await db.segments.where('runId').equals(run.id).delete();
        await db.runs.delete(run.id);
      } else if (remaining.length !== run.outputEntryIds.length) {
        await db.runs.update(run.id, { outputEntryIds: remaining });
      }
    }
  });
}

export async function deleteSession(id: Id) {
  await db.transaction('rw', [...ALL_TABLES(), db.sessions], async () => {
    const ids = await db.entries.where('sessionId').equals(id).primaryKeys();
    await deleteEntriesCascade(ids);
    const runIds = await db.runs.where('sessionId').equals(id).primaryKeys();
    await db.segments.where('runId').anyOf(runIds).delete();
    await db.runs.bulkDelete(runIds);
    await db.sessions.delete(id);
  });
}

export async function deleteGroup(id: Id) {
  const sessions = await db.sessions.where('groupId').equals(id).primaryKeys();
  for (const s of sessions) await deleteSession(s);
  await db.groups.delete(id);
}

export async function renameSession(id: Id, title: string) {
  await db.sessions.update(id, { title, updatedAt: now() });
}

export async function renameGroup(id: Id, name: string) {
  await db.groups.update(id, { name, updatedAt: now() });
}
