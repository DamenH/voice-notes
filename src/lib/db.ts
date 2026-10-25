import Dexie, { type Table } from 'dexie';
import { defaultSettings } from './defaults';
import type {
  AudioChunk,
  Entry,
  Group,
  Recording,
  Run,
  SearchRecord,
  Segment,
  Session,
  Settings,
  TtsCacheItem,
} from './types';

export class VoiceNotesDB extends Dexie {
  groups!: Table<Group, string>;
  sessions!: Table<Session, string>;
  entries!: Table<Entry, string>;
  recordings!: Table<Recording, string>;
  audioChunks!: Table<AudioChunk, string>;
  runs!: Table<Run, string>;
  segments!: Table<Segment, string>;
  searchRecords!: Table<SearchRecord, string>;
  ttsCache!: Table<TtsCacheItem, string>;
  settings!: Table<Settings, string>;

  constructor(name = 'voice-notes') {
    super(name);
    // Schema changes add a new version with an upgrade function; never edit a released version.
    this.version(1).stores({
      groups: 'id, name, updatedAt',
      sessions: 'id, groupId, lastActivityAt',
      entries: 'id, sessionId, groupId, turnId, runId, kind, createdAt, [sessionId+createdAt]',
      recordings: 'id, entryId, sessionId, state',
      audioChunks: 'id, recordingId, [recordingId+index]',
      runs: 'id, sessionId, groupId, turnId, status, kind, createdAt',
      segments: 'id, runId, [runId+index], status',
      searchRecords: 'id, groupId, sessionId, entryId',
      ttsCache: 'id, entryId, key',
      settings: 'id',
    });
  }
}

export let db = new VoiceNotesDB();

/** Tests swap in a fresh database. */
export function useDatabase(next: VoiceNotesDB) {
  db = next;
}

export async function getSettings(): Promise<Settings> {
  const stored = await db.settings.get('global');
  // Merge so settings added in later versions get their defaults.
  return { ...defaultSettings(), ...stored, id: 'global' };
}

export async function updateSettings(patch: Partial<Settings>) {
  const current = await getSettings();
  await db.settings.put({ ...current, ...patch, id: 'global' });
}
