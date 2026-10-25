import { db } from './db';
import { exportLibrary, zipBlob } from './backup';
import { formatTime } from './audio/pcm';
import { recordingWav } from './audio/store';
import type { Entry } from './types';

export type SessionExportKind = 'text' | 'audio' | 'dump';

export function fileSafe(name: string) {
  return (
    name
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase()
      .slice(0, 60) || 'session'
  );
}

const HEADINGS: Partial<Record<Entry['kind'], string>> = {
  user_message: 'You',
  transcript: 'Transcript',
  audio_notes: 'Audio notes',
  inference: 'Response',
};

/** The session as Markdown: messages, transcripts, audio notes and responses, in order. */
export async function sessionMarkdown(sessionId: string): Promise<string> {
  const session = await db.sessions.get(sessionId);
  if (!session) throw new Error('Session not found');
  const group = await db.groups.get(session.groupId);
  const entries = await db.entries.where('sessionId').equals(sessionId).sortBy('createdAt');
  const when = (t: number) => new Date(t).toLocaleString();
  const lines = [`# ${session.title}`, '', `${group ? `Group: ${group.name} · ` : ''}Created ${when(session.createdAt)}`, ''];
  for (const e of entries) {
    if (e.kind === 'recording') {
      lines.push(`---`, '', `**${e.title ?? 'Recording'}** · ${formatTime(Number(e.meta?.duration ?? 0))} · ${when(e.createdAt)}`, '');
      continue;
    }
    const heading = HEADINGS[e.kind];
    if (!heading || !e.text.trim() || e.status === 'running') continue;
    const label = e.kind === 'inference' ? (e.title ?? heading) : heading;
    const model = e.meta?.model ? ` (${String(e.meta.model)})` : '';
    lines.push(`### ${label}${model}`, '', e.text.trim(), '');
  }
  return lines.join('\n');
}

/** Build the export file for a session. */
export async function exportSession(sessionId: string, kind: SessionExportKind): Promise<{ blob: Blob; filename: string }> {
  const session = await db.sessions.get(sessionId);
  if (!session) throw new Error('Session not found');
  const base = fileSafe(session.title);
  if (kind === 'text') {
    return { blob: new Blob([await sessionMarkdown(sessionId)], { type: 'text/markdown' }), filename: `${base}.md` };
  }
  if (kind === 'dump') return { blob: await exportLibrary({ sessionId }), filename: `${base}-session.zip` };
  const recordings = (await db.entries.where('sessionId').equals(sessionId).sortBy('createdAt')).filter((e) => e.kind === 'recording' && e.meta?.recordingId);
  if (recordings.length === 0) throw new Error('This session has no recordings.');
  const named = recordings.map((e, i) => ({
    recordingId: String(e.meta!.recordingId),
    name: `${base}-${String(i + 1).padStart(2, '0')}${e.title && e.title !== 'Recording' ? `-${fileSafe(e.title)}` : ''}.wav`,
  }));
  if (named.length === 1) return { blob: await recordingWav(named[0].recordingId), filename: named[0].name };
  const files: Record<string, Uint8Array> = {};
  for (const r of named) files[r.name] = new Uint8Array(await (await recordingWav(r.recordingId)).arrayBuffer());
  return { blob: await zipBlob(files), filename: `${base}-audio.zip` };
}

/** Save a blob through the browser's download. */
export function download(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
