import { db } from './db';
import { formatTime } from './audio/pcm';
import { searchGroup } from './search';
import type { ToolSpec } from './openrouter/client';
import type { Entry, Id } from './types';

export const TOOL_SPECS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'search_group',
      description: 'Full-text search over transcripts, audio notes, messages, responses and tool results in sessions of the current group.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 10 } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_sessions',
      description: 'List sessions in the current group, most recent first.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_entries',
      description: 'List entries in a session of the current group with short previews.',
      parameters: { type: 'object', properties: { session_id: { type: 'string' } }, required: ['session_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_entry',
      description:
        'Read an entry. Returns a bounded excerpt; use offset to continue. For timestamped transcripts, start/end (seconds) select a time range.',
      parameters: {
        type: 'object',
        properties: {
          entry_id: { type: 'string' },
          offset: { type: 'integer', minimum: 0 },
          max_chars: { type: 'integer', minimum: 200, maximum: 6000 },
          start: { type: 'number' },
          end: { type: 'number' },
        },
        required: ['entry_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_audio_processing',
      description:
        'Ask to transcribe original audio from a recording again (optionally a time range), e.g. when a transcript looks wrong. This costs money, so the user must approve it; the new transcript is returned when done.',
      parameters: {
        type: 'object',
        properties: {
          recording_entry_id: { type: 'string' },
          start: { type: 'number', description: 'Seconds' },
          end: { type: 'number', description: 'Seconds' },
          instructions: { type: 'string', description: 'Why it is needed.' },
        },
        required: ['recording_entry_id'],
      },
    },
  },
];

export const MAX_TOOL_RESULT_CHARS = 8000;

export class ToolError extends Error {}

export interface AudioRequest {
  recordingEntryId: Id;
  start?: number;
  end?: number;
  mode: 'audio' | 'stt';
  instructions: string;
}

export type ToolOutcome = { kind: 'result'; result: unknown } | { kind: 'approval'; request: AudioRequest };

/** Load an entry and enforce the group boundary. */
async function entryInGroup(groupId: Id, entryId: unknown): Promise<Entry> {
  if (typeof entryId !== 'string') throw new ToolError('entry_id must be a string');
  const entry = await db.entries.get(entryId);
  if (!entry || entry.groupId !== groupId) throw new ToolError(`No entry ${entryId} in this group.`);
  return entry;
}

function describeEntry(e: Entry) {
  return {
    entry_id: e.id,
    kind: e.kind,
    title: e.title,
    created: new Date(e.createdAt).toISOString(),
    ...(e.kind === 'recording' ? { duration: formatTime(Number(e.meta?.duration ?? 0)) } : {}),
    preview: e.text.slice(0, 160),
    sources: e.sourceRefs.map((r) => ({ entry_id: r.entryId, start: r.start, end: r.end })),
  };
}

export async function executeTool(groupId: Id, name: string, rawArgs: string): Promise<ToolOutcome> {
  let args: Record<string, unknown>;
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    throw new ToolError('Arguments were not valid JSON.');
  }
  switch (name) {
    case 'search_group': {
      const limit = Math.min(10, Math.max(1, Number(args.limit ?? 8)));
      const hits = await searchGroup(groupId, String(args.query ?? ''), limit);
      const sessions = new Map((await db.sessions.where('groupId').equals(groupId).toArray()).map((s) => [s.id, s.title]));
      return {
        kind: 'result',
        result: hits.map((h) => ({
          entry_id: h.entryId,
          session_id: h.sessionId,
          session_title: sessions.get(h.sessionId),
          kind: h.kind,
          created: new Date(h.createdAt).toISOString(),
          snippet: h.snippet,
        })),
      };
    }
    case 'list_sessions': {
      const sessions = await db.sessions.where('groupId').equals(groupId).reverse().sortBy('lastActivityAt');
      return {
        kind: 'result',
        result: sessions.slice(0, 30).map((s) => ({
          session_id: s.id,
          title: s.title,
          created: new Date(s.createdAt).toISOString(),
          last_activity: new Date(s.lastActivityAt).toISOString(),
        })),
      };
    }
    case 'list_entries': {
      const session = await db.sessions.get(String(args.session_id));
      if (!session || session.groupId !== groupId) throw new ToolError(`No session ${String(args.session_id)} in this group.`);
      const entries = await db.entries.where('sessionId').equals(session.id).sortBy('createdAt');
      return {
        kind: 'result',
        result: entries
          .filter((e) => e.kind !== 'approval_request' && e.kind !== 'error')
          .slice(-50)
          .map(describeEntry),
      };
    }
    case 'read_entry': {
      const entry = await entryInGroup(groupId, args.entry_id);
      const maxChars = Math.min(6000, Math.max(200, Number(args.max_chars ?? 4000)));
      let text = entry.kind === 'tool_call' ? String(entry.meta?.result ?? '') : entry.text;
      let timestamps = entry.timestamps;
      if (timestamps && (args.start !== undefined || args.end !== undefined)) {
        const s = Number(args.start ?? 0);
        const e = Number(args.end ?? Infinity);
        timestamps = timestamps.filter((t) => t.end > s && t.start < e);
        text = timestamps.map((t) => t.text).join(' ');
      }
      const offset = Math.max(0, Number(args.offset ?? 0));
      const excerpt = text.slice(offset, offset + maxChars);
      return {
        kind: 'result',
        result: {
          ...describeEntry(entry),
          preview: undefined,
          offset,
          total_chars: text.length,
          text: excerpt,
          ...(offset + maxChars < text.length ? { next_offset: offset + maxChars } : {}),
          ...(timestamps
            ? { time_range: timestamps.length ? `${formatTime(timestamps[0].start)}–${formatTime(timestamps.at(-1)!.end)}` : 'none' }
            : {}),
        },
      };
    }
    case 'request_audio_processing': {
      const entry = await entryInGroup(groupId, args.recording_entry_id);
      if (entry.kind !== 'recording') throw new ToolError('That entry is not a recording.');
      const duration = Number(entry.meta?.duration ?? 0);
      const start = args.start === undefined ? undefined : Math.max(0, Number(args.start));
      const end = args.end === undefined ? undefined : Math.min(duration, Number(args.end));
      if (start !== undefined && end !== undefined && end <= start) throw new ToolError('end must be after start.');
      const mode = 'stt' as const;
      return { kind: 'approval', request: { recordingEntryId: entry.id, start, end, mode, instructions: String(args.instructions ?? '') } };
    }
    default:
      throw new ToolError(`Unknown tool ${name}.`);
  }
}

/** Serialise a tool result for the model, bounded so it can ask for more. */
export function boundedResult(result: unknown): string {
  const s = JSON.stringify(result);
  return s.length <= MAX_TOOL_RESULT_CHARS ? s : `${s.slice(0, MAX_TOOL_RESULT_CHARS)}… [truncated; request a narrower range or use offset]`;
}
