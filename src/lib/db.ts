import Dexie, { type Table } from 'dexie';
import { DEFAULT_PROCESSING_INSTRUCTIONS, LANGUAGE_PRACTICE_PROCESSING, PIPELINE_PRESETS, defaultSettings } from './defaults';
import { normalizePipeline } from './pipeline';
import { OLD_LANGUAGE_PRACTICE_V1, OLD_LANGUAGE_PRACTICE_V2, OLD_PROCESSING_INSTRUCTIONS_V1, OLD_PROCESSING_INSTRUCTIONS_V2 } from './migrations';
import type {
  AudioChunk,
  PipelineConfig,
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
    // v2: shorter default audio-processing instructions. Replace the old defaults wherever
    // they were saved unchanged; customised text is left alone.
    this.version(2).upgrade(async (tx) => {
      const swap = (text: unknown) =>
        text === OLD_PROCESSING_INSTRUCTIONS_V1 ? DEFAULT_PROCESSING_INSTRUCTIONS : text === OLD_LANGUAGE_PRACTICE_V1 ? LANGUAGE_PRACTICE_PROCESSING : text;
      type Legacy = { process?: { instructions?: string } } | null | undefined;
      const fixPipeline = (p: Legacy) => {
        if (p?.process) p.process.instructions = swap(p.process.instructions) as string;
      };
      await tx.table('settings').toCollection().modify((s: { instructions: { processing: string }; pipeline: Legacy; pipelinePresets?: { config: Legacy }[] }) => {
        s.instructions.processing = swap(s.instructions.processing) as string;
        fixPipeline(s.pipeline);
        s.pipelinePresets?.forEach((p) => fixPipeline(p.config));
      });
      for (const t of ['groups', 'sessions']) {
        await tx.table(t).toCollection().modify((row: { pipeline: Legacy; instructions?: { processing?: string } }) => {
          fixPipeline(row.pipeline);
          if (row.instructions?.processing) row.instructions.processing = swap(row.instructions.processing) as string;
        });
      }
    });
    // v3: pipelines become step lists. Convert every saved pipeline and preset, and add
    // the new built-in "Transcribe + Inkling" preset.
    this.version(3).upgrade(async (tx) => {
      await tx.table('settings').toCollection().modify((s: Settings) => {
        if (s.pipeline) s.pipeline = normalizePipeline(s.pipeline)!;
        if (s.pipelinePresets) {
          s.pipelinePresets = s.pipelinePresets.map((p) => ({ ...p, config: normalizePipeline(p.config)! }));
          if (!s.pipelinePresets.some((p) => p.id === 'transcribe-inkling')) {
            const added = PIPELINE_PRESETS.find((p) => p.id === 'transcribe-inkling')!;
            s.pipelinePresets.splice(1, 0, added);
          }
        }
      });
      for (const t of ['groups', 'sessions']) {
        await tx.table(t).toCollection().modify((row: Group | Session) => {
          row.pipeline = normalizePipeline(row.pipeline);
        });
      }
    });
    // v4: Listen steps write their own transcript instead of being given Whisper's, and the
    // default listening instructions ask for that transcript (plus IPA for language practice).
    this.version(4).upgrade(async (tx) => {
      const swap = (text: string | undefined) =>
        text === OLD_PROCESSING_INSTRUCTIONS_V2 ? DEFAULT_PROCESSING_INSTRUCTIONS : text === OLD_LANGUAGE_PRACTICE_V2 ? LANGUAGE_PRACTICE_PROCESSING : text;
      const fix = (p: PipelineConfig | null | undefined) => {
        p?.steps?.forEach((st) => {
          if (st.kind !== 'listen') return;
          st.useTranscript = false;
          st.instructions = swap(st.instructions) ?? '';
        });
      };
      await tx.table('settings').toCollection().modify((s: Settings) => {
        s.instructions.processing = swap(s.instructions.processing) ?? '';
        fix(s.pipeline);
        s.pipelinePresets?.forEach((p) => fix(p.config));
      });
      for (const t of ['groups', 'sessions']) {
        await tx.table(t).toCollection().modify((row: Group | Session) => {
          fix(row.pipeline);
          if (row.instructions?.processing) row.instructions.processing = swap(row.instructions.processing);
        });
      }
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
  const merged: Settings = { ...defaultSettings(), ...stored, id: 'global' };
  // Settings imported from an older export may still use the old pipeline shape.
  merged.pipeline = normalizePipeline(merged.pipeline)!;
  merged.pipelinePresets = merged.pipelinePresets.map((p) => ({ ...p, config: normalizePipeline(p.config)! }));
  return merged;
}

export async function updateSettings(patch: Partial<Settings>) {
  const current = await getSettings();
  await db.settings.put({ ...current, ...patch, id: 'global' });
}
