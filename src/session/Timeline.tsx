import { useEffect, useMemo, useState } from 'react';
import { db } from '../lib/db';
import { deleteEntry, derivedEntryIds, updateEntry } from '../lib/library';
import { cancelRun, inferOnEntries, resolveApproval, retryRun } from '../lib/runs';
import { formatCost } from '../lib/openrouter/catalog';
import { formatTime } from '../lib/audio/pcm';
import { modelName, runActivity, runVerb } from '../lib/pipelineInfo';
import { resolveTts } from '../lib/instructions';
import { speechPlayer } from '../lib/tts';
import { friendlyError } from '../lib/openrouter/client';
import type { Entry, Group, Run, Session, Settings } from '../lib/types';
import { openPanel, playRecording, playback, releaseRecording, useStore } from '../app/stores';
import { Icon } from '../ui/Icon';
import { Markdown } from '../ui/Markdown';
import { Button, IconButton, Menu, confirmAction, toast, type MenuItem } from '../ui/primitives';
import { RecordingPlayer } from './RecordingPlayer';

export interface Turn {
  id: string;
  anchor?: Entry;
  entries: Entry[];
  runs: Run[];
  createdAt: number;
}

export function buildTurns(entries: Entry[], runs: Run[]): Turn[] {
  const map = new Map<string, Turn>();
  for (const e of entries) {
    let t = map.get(e.turnId);
    if (!t) map.set(e.turnId, (t = { id: e.turnId, entries: [], runs: [], createdAt: e.createdAt }));
    if (e.id === e.turnId) t.anchor = e;
    else t.entries.push(e);
  }
  for (const r of runs) {
    let t = map.get(r.turnId);
    if (!t) map.set(r.turnId, (t = { id: r.turnId, entries: [], runs: [], createdAt: r.createdAt }));
    t.runs.push(r);
  }
  return [...map.values()].sort((a, b) => a.createdAt - b.createdAt);
}

const ACTIVE: Run['status'][] = ['queued', 'running', 'waiting_network', 'blocked'];

export function Timeline({
  turns,
  settings,
  session,
  group,
  focusEntryId,
}: {
  turns: Turn[];
  settings: Settings;
  session: Session;
  group?: Group;
  focusEntryId?: string;
}) {
  const showDetails = session.showDetails ?? settings.showDetails;
  useEffect(() => {
    if (!focusEntryId) return;
    const el = document.getElementById(`entry-${focusEntryId}`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el?.classList.add('ring-2', 'ring-accent');
    const t = setTimeout(() => el?.classList.remove('ring-2', 'ring-accent'), 2400);
    return () => clearTimeout(t);
  }, [focusEntryId, turns.length]);

  return (
    <ol className="flex flex-col gap-5" aria-label="Session timeline">
      {turns.map((t) => (
        <TurnView key={t.id} turn={t} settings={settings} session={session} group={group} defaultOpen={showDetails} focusEntryId={focusEntryId} />
      ))}
    </ol>
  );
}

function TurnView({
  turn,
  settings,
  session,
  group,
  defaultOpen,
  focusEntryId,
}: {
  turn: Turn;
  settings: Settings;
  session: Session;
  group?: Group;
  defaultOpen: boolean;
  focusEntryId?: string;
}) {
  const focusInDetails = !!focusEntryId && turn.entries.some((e) => e.id === focusEntryId && e.visibility === 'detail');
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => setOpen(defaultOpen || focusInDetails), [defaultOpen, focusInDetails]);
  const sorted = useMemo(() => [...turn.runs].sort((a, b) => a.createdAt - b.createdAt), [turn.runs]);
  const active = sorted.filter((r) => ACTIVE.includes(r.status));
  const primary = turn.entries.filter((e) => e.visibility === 'primary');
  const details = turn.entries.filter((e) => e.visibility === 'detail');
  const hasSummary = sorted.length > 0 || details.length > 0;

  return (
    <li className="flex flex-col gap-2.5">
      {turn.anchor ? (
        turn.anchor.kind === 'recording' ? (
          <RecordingCard entry={turn.anchor} />
        ) : (
          <UserMessage entry={turn.anchor} />
        )
      ) : (
        <p className="text-[13px] text-faint italic">Source deleted</p>
      )}
      {hasSummary && <SummaryLine runs={sorted} details={details} open={open} onToggle={() => setOpen((o) => !o)} settings={settings} turnId={turn.id} />}
      {active.length > 0 && <StatusLine runs={active} settings={settings} />}
      {open && <Details entries={details} runs={sorted} settings={settings} />}
      {primary.map((e) => (
        <PrimaryEntry key={e.id} entry={e} settings={settings} session={session} group={group} runs={sorted} />
      ))}
    </li>
  );
}

function UserMessage({ entry }: { entry: Entry }) {
  return (
    <div id={`entry-${entry.id}`} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-accent-soft px-4 py-2.5 text-[15px] whitespace-pre-wrap">
      {entry.text}
    </div>
  );
}

function RecordingCard({ entry }: { entry: Entry }) {
  const recordingId = entry.meta?.recordingId as string | undefined;
  const duration = Number(entry.meta?.duration ?? 0);
  const recording = entry.status === 'running';
  const del = async () => {
    const derived = await derivedEntryIds(entry.sessionId, [entry.id]);
    if (derived.length === 0) {
      if (!confirmAction('Delete this recording? This cannot be undone.')) return;
      if (recordingId) releaseRecording(recordingId);
      await deleteEntry(entry.id);
      return;
    }
    const all = confirmAction(
      `Delete this recording and the ${derived.length} item${derived.length === 1 ? '' : 's'} made from it?\n\nChoose Cancel to keep the transcripts and responses.`,
    );
    if (!all && !confirmAction('Delete only the audio, keeping the transcripts and responses?')) return;
    if (recordingId) releaseRecording(recordingId);
    await deleteEntry(entry.id, { withDerived: all });
  };
  const items: MenuItem[] = [
    { label: 'Process…', icon: 'sliders', onSelect: () => openPanel({ kind: 'process', entryId: entry.id }) },
    { label: 'Listen with Inkling', icon: 'ear', onSelect: () => openPanel({ kind: 'process', entryId: entry.id, mode: 'audio' }) },
    {
      label: 'Rename',
      icon: 'pencil',
      onSelect: () => {
        const title = prompt('Recording name', entry.title ?? 'Recording');
        if (title !== null) void updateEntry(entry.id, { title: title.trim() || 'Recording' });
      },
    },
    { label: 'Delete', icon: 'trash', danger: true, onSelect: () => void del() },
  ];
  return (
    <div id={`entry-${entry.id}`} className="rounded-2xl border border-hairline bg-surface p-3 transition">
      <div className="flex items-center gap-3">
        {recording ? (
          <span className="grid size-11 place-items-center rounded-full bg-rec-soft text-rec">
            <Icon name="mic" />
          </span>
        ) : recordingId ? (
          <RecordingPlayer entryId={entry.id} recordingId={recordingId} duration={duration} />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{entry.title ?? 'Recording'}</p>
          <p className="text-[13px] text-muted">
            {recording ? 'Recording…' : formatTime(duration)} · {new Date(entry.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            {Boolean(entry.meta?.interrupted) && <span className="ml-2 rounded bg-warn-soft px-1.5 py-0.5 text-xs font-semibold text-warn">Interrupted — saved up to here</span>}
          </p>
        </div>
        {!recording && <Menu items={items} label="Recording actions" />}
      </div>
      {!recording && recordingId && <ProgressBar entryId={entry.id} duration={duration} />}
    </div>
  );
}

function ProgressBar({ entryId, duration }: { entryId: string; duration: number }) {
  const p = useStore(playback);
  if (p.entryId !== entryId) return null;
  const pct = duration ? Math.min(100, (p.time / duration) * 100) : 0;
  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-muted tabular-nums">
      <span>{formatTime(p.time)}</span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <span>{formatTime(duration)}</span>
    </div>
  );
}

function SummaryLine({
  runs,
  details,
  open,
  onToggle,
  settings,
  turnId,
}: {
  runs: Run[];
  details: Entry[];
  open: boolean;
  onToggle: () => void;
  settings: Settings;
  turnId: string;
}) {
  const parts: string[] = [];
  for (const r of runs) {
    if (r.status === 'done') parts.push(runVerb(r, settings));
    else if (r.status === 'failed') parts.push(`${runVerb(r, settings)} failed`);
    else if (r.status === 'cancelled') parts.push(`${runVerb(r, settings)} cancelled`);
  }
  const tools = details.filter((e) => e.kind === 'tool_call').length;
  if (tools) parts.push(`${tools} tool call${tools === 1 ? '' : 's'}`);
  const cost = runs.reduce((n, r) => n + (r.usage.cost ?? 0), 0);
  if (cost > 0) parts.push(formatCost(cost));
  if (parts.length === 0 && details.length === 0) return null;
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-8 items-center gap-1.5 rounded-md px-1.5 text-left text-[13px] text-muted hover:bg-surface-2 hover:text-text"
      >
        <Icon name={open ? 'down' : 'chevron'} size={14} />
        <span>{parts.join(' · ') || `${details.length} detail${details.length === 1 ? '' : 's'}`}</span>
      </button>
      <button
        onClick={() => openPanel({ kind: 'turn', turnId })}
        className="hidden min-h-8 rounded-md px-1.5 text-[13px] text-faint hover:bg-surface-2 hover:text-text desk:inline"
      >
        Inspect
      </button>
    </div>
  );
}

function StatusLine({ runs, settings }: { runs: Run[]; settings: Settings }) {
  const run = runs.find((r) => r.status === 'running') ?? runs[0];
  const [seg, setSeg] = useState<{ done: number; total: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const segs = await db.segments.where('runId').equals(run.id).toArray();
      if (alive) setSeg(segs.length > 1 ? { done: segs.filter((s) => s.status === 'done').length, total: segs.length } : null);
    };
    void tick();
    const id = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [run.id]);
  const label =
    run.status === 'waiting_network'
      ? 'Waiting for a connection'
      : run.status === 'blocked'
        ? 'Waiting for a failed step'
        : run.status === 'queued'
          ? `${runActivity(run, settings)} next`
          : `${runActivity(run, settings)}${seg ? ` · part ${Math.min(seg.done + 1, seg.total)} of ${seg.total}` : ''}`;
  return (
    <div className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-[13px] text-muted" role="status">
      {run.status === 'waiting_network' ? (
        <Icon name="wifiOff" size={16} />
      ) : (
        <span className="size-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-hidden />
      )}
      <span className="flex-1">
        {label}… <span className="text-faint">{modelName(run.model, settings)}</span>
      </span>
      <Button small variant="plain" onClick={() => void cancelRun(run.id)}>
        Cancel
      </Button>
    </div>
  );
}

function Details({ entries, runs, settings }: { entries: Entry[]; runs: Run[]; settings: Settings }) {
  return (
    <div className="animate-fade flex flex-col gap-2 border-l-2 border-hairline pl-3">
      {entries.map((e) => (
        <DetailEntry key={e.id} entry={e} settings={settings} />
      ))}
      {runs.map((r) => (
        <RunRow key={r.id} run={r} settings={settings} />
      ))}
    </div>
  );
}

function RunRow({ run, settings }: { run: Run; settings: Settings }) {
  const [show, setShow] = useState(false);
  return (
    <div className="rounded-lg bg-surface-2/60 px-3 py-2 text-[13px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold">{runVerb(run, settings)}</span>
        <span className="text-muted">{modelName(run.model, settings)}</span>
        <StatusBadge status={run.status} />
        <span className="text-faint">
          {run.trigger === 'auto' ? 'automatic' : run.trigger === 'tool' ? 'requested by model' : 'manual'}
          {run.usage.cost !== undefined ? ` · ${formatCost(run.usage.cost)}` : run.estimatedCost ? ` · est. ${formatCost(run.estimatedCost)}` : ''}
        </span>
        <span className="flex-1" />
        {(run.status === 'failed' || run.status === 'cancelled' || run.status === 'blocked') && (
          <Button small variant="plain" icon="retry" onClick={() => void retryRun(run.id)}>
            Retry
          </Button>
        )}
        {run.instructions && (
          <Button small variant="plain" onClick={() => setShow((s) => !s)}>
            {show ? 'Hide instructions' : 'Instructions'}
          </Button>
        )}
      </div>
      {run.error && <p className="mt-1 text-rec">{run.error}</p>}
      {show && <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-surface p-2 font-mono text-xs whitespace-pre-wrap text-muted">{run.instructions}</pre>}
    </div>
  );
}

export function StatusBadge({ status }: { status: Run['status'] }) {
  const map: Record<Run['status'], [string, string]> = {
    queued: ['Queued', 'bg-surface-3 text-muted'],
    running: ['Running', 'bg-accent-soft text-accent'],
    waiting_network: ['Offline', 'bg-warn-soft text-warn'],
    awaiting_approval: ['Needs approval', 'bg-warn-soft text-warn'],
    done: ['Done', 'bg-surface-3 text-muted'],
    failed: ['Failed', 'bg-rec-soft text-rec'],
    cancelled: ['Cancelled', 'bg-surface-3 text-faint'],
    blocked: ['Blocked', 'bg-warn-soft text-warn'],
  };
  const [label, cls] = map[status];
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${cls}`}>{label}</span>;
}

function DetailEntry({ entry, settings }: { entry: Entry; settings: Settings }) {
  const [expanded, setExpanded] = useState(false);
  if (entry.kind === 'tool_call') {
    return (
      <div id={`entry-${entry.id}`} className="rounded-lg bg-surface-2/60 px-3 py-2 text-[13px]">
        <button className="flex w-full items-center gap-2 text-left" onClick={() => setExpanded((x) => !x)} aria-expanded={expanded}>
          <Icon name="bolt" size={14} className="text-faint" />
          <span className="font-mono font-semibold">{entry.title}</span>
          <span className="truncate font-mono text-faint">{entry.text}</span>
          <span className="flex-1" />
          <Icon name={expanded ? 'down' : 'chevron'} size={14} className="text-faint" />
        </button>
        {expanded && (
          <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-surface p-2 font-mono text-xs whitespace-pre-wrap text-muted">
            {prettyJson(String(entry.meta?.result ?? '(waiting)'))}
          </pre>
        )}
      </div>
    );
  }
  const long = entry.text.length > 400;
  return (
    <div id={`entry-${entry.id}`} className="rounded-lg bg-surface-2/60 px-3 py-2 transition">
      <div className="mb-1 flex items-center gap-2 text-[13px]">
        <span className="font-semibold">{entry.title ?? entry.kind}</span>
        {entry.meta?.model ? <span className="text-faint">{modelName(String(entry.meta.model), settings)}</span> : null}
        {entry.kind === 'error' && <span className="text-faint">resolved</span>}
        <span className="flex-1" />
        <EntryMenu entry={entry} settings={settings} />
      </div>
      <div className={`${!expanded && long ? 'line-clamp-4' : ''} text-[14px] text-muted`}>
        {entry.timestamps && expanded ? <TimedTranscript entry={entry} /> : <Markdown text={entry.text} />}
      </div>
      {long && (
        <button className="mt-1 text-[13px] font-semibold text-accent" onClick={() => setExpanded((x) => !x)}>
          {expanded ? 'Show less' : entry.timestamps ? 'Show all with timestamps' : 'Show all'}
        </button>
      )}
      {!long && entry.timestamps && (
        <button className="mt-1 text-[13px] font-semibold text-accent" onClick={() => setExpanded((x) => !x)}>
          {expanded ? 'Hide timestamps' : 'Timestamps'}
        </button>
      )}
    </div>
  );
}

function prettyJson(s: string) {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

/** Transcript with clickable timestamps that play the original audio range. */
function TimedTranscript({ entry }: { entry: Entry }) {
  const src = entry.sourceRefs[0];
  const play = async (start: number, end: number) => {
    const rec = src && (await db.entries.get(src.entryId));
    const recordingId = rec?.meta?.recordingId as string | undefined;
    if (!rec || !recordingId) return toast('The original recording was deleted.', 'error');
    void playRecording(rec.id, recordingId, Number(rec.meta?.duration ?? 0), start, end);
  };
  return (
    <div className="flex flex-col gap-1">
      {entry.timestamps!.map((t, i) => (
        <p key={i} className="flex gap-2">
          <button className="shrink-0 font-mono text-xs leading-6 text-accent hover:underline" onClick={() => void play(t.start, t.end)} title="Play this part">
            {formatTime(t.start)}
          </button>
          <span>{t.text}</span>
        </p>
      ))}
    </div>
  );
}

function PrimaryEntry({ entry, settings, session, group, runs }: { entry: Entry; settings: Settings; session: Session; group?: Group; runs: Run[] }) {
  if (entry.kind === 'approval_request') return <ApprovalCard entry={entry} />;
  if (entry.kind === 'error') return <ErrorCard entry={entry} runs={runs} />;
  const run = runs.find((r) => r.id === entry.runId);
  const streaming = entry.status === 'running';
  return (
    <article id={`entry-${entry.id}`} className="animate-rise rounded-2xl border border-hairline bg-surface px-4 py-3 transition">
      <header className="mb-1.5 flex items-center gap-2 text-[13px]">
        <Icon name={entry.kind === 'inference' ? 'sparkle' : entry.kind === 'audio_notes' ? 'ear' : 'text'} size={16} className="text-accent" />
        <span className="shrink-0 font-semibold whitespace-nowrap">{entry.title ?? entry.kind}</span>
        <span className="min-w-0 truncate text-faint">
          {entry.meta?.model ? modelName(String(entry.meta.model), settings) : ''}
          {run?.usage.cost ? ` · ${formatCost(run.usage.cost)}` : ''}
        </span>
        <span className="flex-1" />
        {!streaming && entry.text && <SpeakButton entry={entry} settings={settings} session={session} group={group} />}
        <EntryMenu entry={entry} settings={settings} />
      </header>
      {entry.timestamps ? <TimedOrPlain entry={entry} /> : <Markdown text={entry.text || (streaming ? '…' : '')} className="text-[15px]" />}
      {entry.status === 'failed' && <p className="mt-2 text-[13px] text-rec">Stopped before finishing.</p>}
    </article>
  );
}

function TimedOrPlain({ entry }: { entry: Entry }) {
  const [timed, setTimed] = useState(false);
  return (
    <>
      {timed ? <TimedTranscript entry={entry} /> : <Markdown text={entry.text} className="text-[15px]" />}
      <button className="mt-1 text-[13px] font-semibold text-accent" onClick={() => setTimed((t) => !t)}>
        {timed ? 'Hide timestamps' : 'Timestamps'}
      </button>
    </>
  );
}

function SpeakButton({ entry, settings, session, group }: { entry: Entry; settings: Settings; session: Session; group?: Group }) {
  const [, force] = useState(0);
  useEffect(() => speechPlayer.subscribe(() => force((n) => n + 1)), []);
  const mine = speechPlayer.entryId === entry.id;
  const state = mine ? speechPlayer.state : 'idle';
  return (
    <IconButton
      icon={state === 'idle' ? 'speaker' : 'stop'}
      label={state === 'idle' ? 'Read aloud' : 'Stop reading'}
      size={18}
      className={state !== 'idle' ? 'text-accent' : ''}
      onClick={() => {
        if (state !== 'idle') return speechPlayer.stop();
        void speechPlayer.play(entry, resolveTts(settings, group, session)).catch((e) => toast(friendlyError(e), 'error'));
      }}
    />
  );
}

function EntryMenu({ entry, settings }: { entry: Entry; settings: Settings }) {
  const items: MenuItem[] = [
    {
      label: 'Copy text',
      icon: 'copy',
      onSelect: () => void navigator.clipboard.writeText(entry.text).then(() => toast('Copied')),
    },
  ];
  if (entry.kind === 'transcript' || entry.kind === 'audio_notes' || entry.kind === 'inference') {
    for (const p of settings.inferencePresets) {
      items.push({
        label: `${p.name} (${p.tier === 'big' ? 'Big' : 'Little'})`,
        icon: 'sparkle',
        onSelect: () => void inferOnEntries(entry.sessionId, p.id, [entry.id]),
      });
    }
  }
  const src = entry.sourceRefs[0];
  if (src) {
    items.push({
      label: 'Go to source',
      icon: 'link',
      onSelect: () => {
        const el = document.getElementById(`entry-${src.entryId}`);
        if (!el) return toast('The source was deleted.', 'error');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-accent');
        setTimeout(() => el.classList.remove('ring-2', 'ring-accent'), 2000);
      },
    });
  }
  items.push({
    label: 'Delete',
    icon: 'trash',
    danger: true,
    onSelect: () => {
      if (confirmAction('Delete this item?')) void deleteEntry(entry.id);
    },
  });
  return <Menu items={items} label="Entry actions" />;
}

function ApprovalCard({ entry }: { entry: Entry }) {
  const m = entry.meta ?? {};
  const waiting = entry.status === 'waiting';
  const decision = m.decision as string | undefined;
  if (!waiting) {
    return (
      <p className="text-[13px] text-faint">
        {m.reason === 'tool' ? 'Audio processing request' : 'Pipeline'} {decision === 'approved' ? 'approved' : 'declined'}
      </p>
    );
  }
  return (
    <div className="animate-rise rounded-2xl border border-warn/40 bg-warn-soft px-4 py-3" role="alert">
      <p className="mb-1 flex items-center gap-2 text-[14px] font-semibold text-warn">
        <Icon name="alert" size={16} />
        {m.reason === 'tool' ? 'The model asks to process audio again' : 'Approve this pipeline?'}
      </p>
      {m.reason === 'tool' ? (
        <dl className="mb-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[14px]">
          <dt className="text-muted">Model</dt>
          <dd>{modelName(String(m.model))}</dd>
          <dt className="text-muted">Audio</dt>
          <dd>
            {String(m.recordingTitle ?? 'Recording')}, {formatTime(Number(m.start ?? 0))}–{formatTime(Number(m.end ?? 0))}
          </dd>
          <dt className="text-muted">Asks for</dt>
          <dd>{entry.text}</dd>
          <dt className="text-muted">Estimated</dt>
          <dd>{formatCost(Number(m.estimate ?? 0)) || 'unknown'}</dd>
        </dl>
      ) : (
        <p className="mb-2 text-[14px]">{entry.text}</p>
      )}
      <div className="flex gap-2">
        <Button variant="primary" small onClick={() => void resolveApproval(entry.id, true)}>
          Approve
        </Button>
        <Button small onClick={() => void resolveApproval(entry.id, false)}>
          Decline
        </Button>
      </div>
    </div>
  );
}

function ErrorCard({ entry, runs }: { entry: Entry; runs: Run[] }) {
  const run = runs.find((r) => r.id === entry.meta?.runId);
  const kind = entry.meta?.errorKind as string | undefined;
  return (
    <div className="animate-rise rounded-2xl border border-rec/30 bg-rec-soft px-4 py-3" role="alert">
      <p className="mb-2 flex items-start gap-2 text-[14px] text-rec">
        <Icon name="alert" size={16} className="mt-0.5" />
        <span>{entry.text}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {run && run.status !== 'done' && (
          <Button small variant="primary" icon="retry" onClick={() => void retryRun(run.id)}>
            Retry
          </Button>
        )}
        {(kind === 'auth' || kind === 'credits') && (
          <Button small onClick={() => (location.hash = '#/settings/connection')}>
            Open settings
          </Button>
        )}
        <Button small variant="plain" onClick={() => void updateEntry(entry.id, { visibility: 'detail', status: 'done' })}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
