import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, updateSettings } from '../lib/db';
import { now } from '../lib/ids';
import { resolveTts } from '../lib/instructions';
import { resolvePipeline } from '../lib/instructions';
import { processRecording } from '../lib/runs';
import { planPipeline } from '../lib/runs';
import { formatTime, parseTime } from '../lib/audio/pcm';
import { describePrice, catalogModel, formatCost, voicesFor } from '../lib/openrouter/catalog';
import { friendlyError } from '../lib/openrouter/client';
import { runVerb } from '../lib/pipelineInfo';
import { speechPlayer } from '../lib/tts';
import type { Entry, Group, InstructionSet, PipelineConfig, Session, Settings, TtsSettings } from '../lib/types';
import { INKLING, STT_DEFAULT } from '../lib/defaults';
import { clonePipeline, samePipeline, step } from '../lib/pipeline';
import { StepsEditor } from './StepsEditor';
import { useCatalog } from '../app/hooks';
import { closePanel, playRecording, type Panel } from '../app/stores';
import { Button, Field, Segmented, Toggle, inputClass, toast } from '../ui/primitives';
import { PipelineEditor, type Scope } from './PipelineEditor';
import { StatusBadge } from '../session/Timeline';

export function panelTitle(p: Panel) {
  return {
    pipeline: 'When recording stops',
    instructions: 'Instructions',
    voice: 'Read-aloud voice',
    turn: 'Details',
    process: p.kind === 'process' && p.mode === 'audio' ? 'Listen with Inkling' : 'Process recording',
  }[p.kind];
}

export function PanelBody({ panel, settings, session, group }: { panel: Panel; settings: Settings; session?: Session; group?: Group }) {
  switch (panel.kind) {
    case 'pipeline':
      return <PipelineEditor settings={settings} session={session} group={group} initialScope={panel.scope} />;
    case 'instructions':
      return <InstructionsEditor settings={settings} session={session} group={group} />;
    case 'voice':
      return <VoiceEditor settings={settings} session={session} group={group} />;
    case 'turn':
      return <TurnInspector turnId={panel.turnId} settings={settings} />;
    case 'process':
      return <ProcessPanel entryId={panel.entryId} initialMode={panel.mode} settings={settings} session={session} group={group} />;
  }
}

// ---------- Instructions ----------

export function InstructionsEditor({ settings, session, group, scopeOverride }: { settings: Settings; session?: Session; group?: Group; scopeOverride?: Scope }) {
  const [scope, setScope] = useState<Scope>(scopeOverride ?? (session ? 'session' : group ? 'group' : 'global'));
  const current: InstructionSet = scope === 'session' ? (session?.instructions ?? {}) : scope === 'group' ? (group?.instructions ?? {}) : settings.instructions;
  const save = async (patch: InstructionSet) => {
    const next = { ...current, ...patch };
    if (scope === 'session' && session) await db.sessions.update(session.id, { instructions: next, updatedAt: now() });
    else if (scope === 'group' && group) await db.groups.update(group.id, { instructions: next, updatedAt: now() });
    else await updateSettings({ instructions: { processing: next.processing ?? '', inference: next.inference ?? '' } });
  };
  const inherited = (chain: 'processing' | 'inference') =>
    [
      ['Default', settings.instructions[chain]],
      ...(scope === 'session' && group ? [[`Group “${group.name}”`, group.instructions[chain]]] : []),
    ].filter(([, t]) => t?.trim()) as [string, string][];
  const scopes = [
    ...(session ? [{ value: 'session' as Scope, label: 'This session' }] : []),
    ...(group ? [{ value: 'group' as Scope, label: 'Group' }] : []),
    { value: 'global' as Scope, label: 'Default' },
  ];
  return (
    <div className="flex flex-col gap-5">
      {!scopeOverride && scopes.length > 1 && <Segmented label="Applies to" value={scope} onChange={setScope} options={scopes} />}
      <p className="text-[13px] text-muted">
        Instructions combine from default → group → session → the individual run. More specific instructions win when they conflict, and each run saves the exact instructions it used.
      </p>
      {(['processing', 'inference'] as const).map((chain) => (
        <section key={chain} className="flex flex-col gap-2">
          <Field
            label={chain === 'processing' ? 'Audio processing (Inkling and other audio models)' : 'Assistance (cleanup, feedback, chat)'}
            hint={scope === 'global' ? undefined : 'Leave empty to inherit.'}
          >
            <textarea className={`${inputClass} min-h-28`} value={current[chain] ?? ''} onChange={(e) => void save({ [chain]: e.target.value })} />
          </Field>
          {scope !== 'global' && inherited(chain).length > 0 && (
            <details className="text-[13px] text-muted">
              <summary className="cursor-pointer">Inherited instructions</summary>
              {inherited(chain).map(([label, text]) => (
                <div key={label} className="mt-2">
                  <p className="font-semibold">{label}</p>
                  <p className="whitespace-pre-wrap">{text}</p>
                </div>
              ))}
            </details>
          )}
        </section>
      ))}
    </div>
  );
}

// ---------- Voice ----------

export function VoiceEditor({ settings, session, group, scopeOverride }: { settings: Settings; session?: Session; group?: Group; scopeOverride?: Scope }) {
  const catalog = useCatalog();
  const [scope, setScope] = useState<Scope>(scopeOverride ?? (session ? 'session' : group ? 'group' : 'global'));
  const effective = resolveTts(settings, scope === 'global' ? undefined : group, scope === 'session' ? session : undefined);
  const save = async (patch: Partial<TtsSettings>) => {
    if (scope === 'session' && session) await db.sessions.update(session.id, { tts: { ...(session.tts ?? {}), ...patch } });
    else if (scope === 'group' && group) await db.groups.update(group.id, { tts: { ...(group.tts ?? {}), ...patch } });
    else await updateSettings({ tts: { ...settings.tts, ...patch } });
  };
  const speechModels = catalog.filter((m) => m.kind === 'speech').sort((a, b) => Number(b.id.startsWith('elevenlabs/')) - Number(a.id.startsWith('elevenlabs/')));
  const voices = voicesFor(effective.model);
  const scopes = [
    ...(session ? [{ value: 'session' as Scope, label: 'This session' }] : []),
    ...(group ? [{ value: 'group' as Scope, label: 'Group' }] : []),
    { value: 'global' as Scope, label: 'Default' },
  ];
  const sample = async () => {
    const entry = { id: 'voice-sample', text: 'Hello! This is how responses will sound when read aloud.' } as Entry;
    try {
      await speechPlayer.play(entry, effective);
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };
  return (
    <div className="flex flex-col gap-4">
      {!scopeOverride && scopes.length > 1 && <Segmented label="Applies to" value={scope} onChange={setScope} options={scopes} />}
      <Field label="Speech model" hint={describePrice(catalogModel(effective.model))}>
        <select className={inputClass} value={effective.model} onChange={(e) => void save({ model: e.target.value, voice: voicesFor(e.target.value)[0] ?? effective.voice })}>
          {!speechModels.some((m) => m.id === effective.model) && <option value={effective.model}>{effective.model}</option>}
          {speechModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Voice">
        <select className={inputClass} value={effective.voice} onChange={(e) => void save({ voice: e.target.value })}>
          {!voices.includes(effective.voice) && <option value={effective.voice}>{effective.voice}</option>}
          {voices.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <Toggle
        label="Read responses aloud automatically"
        description="New responses are spoken as soon as they finish — for hands-free practice."
        checked={effective.autoSpeak}
        onChange={(autoSpeak) => void save({ autoSpeak })}
      />
      <div>
        <Button small icon="speaker" onClick={() => void sample()}>
          Play a sample
        </Button>
      </div>
      <p className="text-[13px] text-muted">Spoken audio is cached on this device, so replaying is free and works offline. Clear the cache in Settings → Storage.</p>
    </div>
  );
}

// ---------- Turn inspector ----------

function TurnInspector({ turnId, settings }: { turnId: string; settings: Settings }) {
  const runs = useLiveQuery(() => db.runs.where('turnId').equals(turnId).sortBy('createdAt'), [turnId]) ?? [];
  const entries = useLiveQuery(() => db.entries.where('turnId').equals(turnId).sortBy('createdAt'), [turnId]) ?? [];
  const total = runs.reduce((n, r) => n + (r.usage.cost ?? 0), 0);
  return (
    <div className="flex flex-col gap-4 text-[14px]">
      <p className="text-muted">
        {runs.length} run{runs.length === 1 ? '' : 's'} · {entries.length} entr{entries.length === 1 ? 'y' : 'ies'} · total {formatCost(total) || '$0'}
      </p>
      {runs.map((r) => (
        <section key={r.id} className="rounded-xl border border-hairline p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <strong>{runVerb(r, settings)}</strong>
            <StatusBadge status={r.status} />
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
            <dt className="text-muted">Model</dt>
            <dd className="break-all">{r.model}</dd>
            <dt className="text-muted">Trigger</dt>
            <dd>{r.trigger}</dd>
            {r.sourceRefs.map((s, i) => (
              <span key={i} className="contents">
                <dt className="text-muted">Source</dt>
                <dd className="break-all">
                  {s.entryId}
                  {s.start !== undefined ? ` · ${formatTime(s.start)}–${formatTime(s.end ?? 0)}` : ''}
                </dd>
              </span>
            ))}
            {r.dependsOn.length > 0 && (
              <>
                <dt className="text-muted">After</dt>
                <dd>{r.dependsOn.map((d) => runVerb(runs.find((x) => x.id === d) ?? r, settings)).join(', ')}</dd>
              </>
            )}
            <dt className="text-muted">Cost</dt>
            <dd>
              {r.usage.cost !== undefined ? formatCost(r.usage.cost) : '—'}
              {r.estimatedCost !== undefined ? ` (estimated ${formatCost(r.estimatedCost)})` : ''}
            </dd>
            {r.usage.promptTokens !== undefined && (
              <>
                <dt className="text-muted">Tokens</dt>
                <dd>
                  {r.usage.promptTokens} in · {r.usage.completionTokens ?? 0} out
                </dd>
              </>
            )}
            {r.usage.seconds !== undefined && (
              <>
                <dt className="text-muted">Audio</dt>
                <dd>{formatTime(r.usage.seconds)}</dd>
              </>
            )}
            {r.error && (
              <>
                <dt className="text-muted">Error</dt>
                <dd className="text-rec">{r.error}</dd>
              </>
            )}
          </dl>
          {r.instructions && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[13px] font-semibold text-accent">Instructions snapshot</summary>
              <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-surface-2 p-2 font-mono text-xs whitespace-pre-wrap">{r.instructions}</pre>
            </details>
          )}
          <Segments runId={r.id} />
        </section>
      ))}
    </div>
  );
}

function Segments({ runId }: { runId: string }) {
  const segs = useLiveQuery(() => db.segments.where('runId').equals(runId).sortBy('index'), [runId]) ?? [];
  if (segs.length < 2) return null;
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-[13px] font-semibold text-accent">{segs.length} segments</summary>
      <ul className="mt-1 flex flex-col gap-1 text-[13px]">
        {segs.map((s) => (
          <li key={s.id} className="flex gap-2">
            <span className="font-mono text-xs">
              {formatTime(s.start)}–{formatTime(s.end)}
            </span>
            <span className={s.status === 'done' ? 'text-muted' : s.status === 'pending' ? 'text-faint' : 'text-rec'}>{s.status}</span>
            {s.usage?.cost !== undefined && <span className="text-faint">{formatCost(s.usage.cost)}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

// ---------- Manual processing ----------

function ProcessPanel({
  entryId,
  initialMode,
  settings,
  session,
  group,
}: {
  entryId: string;
  initialMode?: 'audio' | 'stt' | 'combined';
  settings: Settings;
  session?: Session;
  group?: Group;
}) {
  useCatalog();
  const entry = useLiveQuery(() => db.entries.get(entryId), [entryId]);
  // A local copy of the session's pipeline: editing it here never changes the session.
  const [config, setConfig] = useState<PipelineConfig>(() => {
    const base = resolvePipeline(settings, group, session);
    if (initialMode === 'audio') {
      const model = base.steps.find((s) => s.kind === 'listen')?.model ?? settings.audioOptions[0]?.id ?? INKLING;
      return { language: base.language, steps: [step('listen', { model, output: 'show', useTranscript: false })] };
    }
    if (base.steps.length === 0) return { language: base.language, steps: [step('transcribe', { model: settings.sttOptions[0]?.id ?? STT_DEFAULT, output: 'show' })] };
    return clonePipeline(base);
  });
  const duration = Number(entry?.meta?.duration ?? 0);
  const [start, setStart] = useState('0:00');
  const [end, setEnd] = useState('');
  const [estimate, setEstimate] = useState<number | null>(null);
  const range = useMemo(() => {
    const s = parseTime(start) ?? 0;
    const e = end ? (parseTime(end) ?? duration) : duration;
    return { start: Math.max(0, Math.min(s, duration)), end: Math.max(0, Math.min(e, duration)) };
  }, [start, end, duration]);
  useEffect(() => {
    if (entry) void planPipeline(entry, config, { trigger: 'manual', range }).then((p) => setEstimate(p.unknownPrices ? null : p.estimate));
  }, [entry, config, range]);
  if (!entry) return <p className="text-muted">This recording was deleted.</p>;
  const valid = range.end - range.start >= 0.5 && config.steps.length > 0;
  const run = async () => {
    try {
      await processRecording(entry.id, config, { range });
      closePanel();
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };
  const recordingId = entry.meta?.recordingId as string;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {settings.pipelinePresets
          .filter((p) => p.config.steps.length > 0)
          .map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setConfig(clonePipeline(p.config))}
              aria-pressed={samePipeline(p.config, config)}
              className={`min-h-9 rounded-full border px-3 text-[13px] font-semibold transition ${
                samePipeline(p.config, config) ? 'border-accent bg-accent-soft text-accent' : 'border-border text-muted hover:text-text'
              }`}
            >
              {p.name}
            </button>
          ))}
      </div>
      <StepsEditor config={config} change={(fn) => setConfig(fn)} settings={settings} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="From">
          <input className={inputClass} value={start} onChange={(e) => setStart(e.target.value)} inputMode="numeric" placeholder="0:00" />
        </Field>
        <Field label="To">
          <input className={inputClass} value={end} onChange={(e) => setEnd(e.target.value)} inputMode="numeric" placeholder={formatTime(duration)} />
        </Field>
      </div>
      <div>
        <Button small icon="play" onClick={() => void playRecording(entry.id, recordingId, duration, range.start, range.end)} disabled={range.end - range.start < 0.5}>
          Preview {formatTime(range.start)}–{formatTime(range.end)}
        </Button>
      </div>
      <p className="text-[13px] text-muted">
        Estimated {estimate === null ? 'cost unknown' : formatCost(estimate)} · earlier results are kept · the session's pipeline is not changed.
      </p>
      <Button variant="primary" onClick={() => void run()} disabled={!valid}>
        Start processing
      </Button>
    </div>
  );
}
