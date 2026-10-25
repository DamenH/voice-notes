import { useEffect, useRef, useState } from 'react';
import { recorder } from '../lib/audio/recorder';
import { formatTime } from '../lib/audio/pcm';
import { runPipelineForRecording, sendMessage } from '../lib/runs';
import { pipelineSource, resolvePipeline } from '../lib/instructions';
import { pipelineCostPerMinute, pipelineSteps } from '../lib/pipelineInfo';
import { formatCost } from '../lib/openrouter/catalog';
import { friendlyError } from '../lib/openrouter/client';
import type { Group, Session, Settings, Tier } from '../lib/types';
import { useApiKey, useCatalog, useOnline, useRecorder } from '../app/hooks';
import { openPanel } from '../app/stores';
import { Icon } from '../ui/Icon';
import { Segmented, toast } from '../ui/primitives';

export function Dock({ session, group, settings }: { session: Session; group?: Group; settings: Settings }) {
  const rec = useRecorder();
  const busyElsewhere = rec.state !== 'idle' && rec.sessionId !== session.id;
  const recordingHere = rec.state !== 'idle' && rec.sessionId === session.id;

  return (
    <div className="flex flex-col gap-2">
      {rec.warning && recordingHere && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn" role="alert">
          {rec.warning}
        </p>
      )}
      {recordingHere ? (
        <RecordingBar />
      ) : (
        <div className="flex items-end gap-2">
          <Composer session={session} disabled={false} />
          <RecordButton session={session} disabled={busyElsewhere} />
        </div>
      )}
      <PipelineChip session={session} group={group} settings={settings} />
    </div>
  );
}

function RecordButton({ session, disabled }: { session: Session; disabled: boolean }) {
  const start = async () => {
    try {
      await recorder.start(session.id, session.groupId);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <button
      type="button"
      onClick={() => void start()}
      disabled={disabled}
      aria-label="Start recording"
      title={disabled ? 'Already recording in another session' : 'Start recording'}
      className="grid size-14 shrink-0 place-items-center rounded-full bg-rec text-white shadow-md transition hover:brightness-110 active:scale-95 disabled:opacity-40"
    >
      <Icon name="mic" size={24} />
    </button>
  );
}

function RecordingBar() {
  const rec = useRecorder();
  const paused = rec.state === 'paused';
  const stopping = rec.state === 'stopping' || rec.state === 'starting';
  const stop = async () => {
    const result = await recorder.stop();
    // Persisted first; then the session's pipeline runs automatically.
    if (result) await runPipelineForRecording(result.entryId).catch((e) => toast(friendlyError(e), 'error'));
  };
  // Space or Escape stops recording on desktop.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement).closest('input, textarea')) void stop();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-rec/30 bg-rec-soft px-3 py-2" role="group" aria-label="Recording">
      <button
        type="button"
        onClick={() => (paused ? recorder.resume() : recorder.pause())}
        disabled={stopping}
        aria-label={paused ? 'Resume recording' : 'Pause recording'}
        className="grid size-11 place-items-center rounded-full bg-surface text-text transition hover:bg-surface-2"
      >
        <Icon name={paused ? 'mic' : 'pause'} size={20} strokeWidth={2.2} />
      </button>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[15px] font-semibold tabular-nums">
          {!paused && <span className="size-2.5 rounded-full bg-rec" style={{ animation: 'pulse-rec 1.6s infinite' }} />}
          {formatTime(rec.elapsed)}
          <span className="text-[13px] font-normal text-muted">{paused ? 'Paused' : stopping ? 'Saving…' : 'Recording · saved as you go'}</span>
        </p>
        <Level level={paused ? 0 : rec.level} />
      </div>
      <button
        type="button"
        onClick={() => void stop()}
        disabled={stopping}
        aria-label="Stop recording"
        className="grid size-14 place-items-center rounded-full bg-rec text-white shadow-md transition hover:brightness-110 active:scale-95 disabled:opacity-60"
        style={{ animation: paused ? undefined : 'pulse-rec 2s infinite' }}
      >
        <Icon name="stop" size={22} />
      </button>
    </div>
  );
}

function Level({ level }: { level: number }) {
  const bars = 24;
  const lit = Math.round(Math.min(1, Math.sqrt(level) * 1.4) * bars);
  return (
    <div className="mt-1 flex h-3 items-end gap-[2px]" aria-hidden>
      {Array.from({ length: bars }, (_, i) => (
        <span key={i} className={`w-1 rounded-sm transition-all ${i < lit ? 'bg-rec' : 'bg-rec/20'}`} style={{ height: `${30 + ((i * 37) % 70)}%` }} />
      ))}
    </div>
  );
}

function PipelineChip({ session, group, settings }: { session: Session; group?: Group; settings: Settings }) {
  useCatalog();
  const config = resolvePipeline(settings, group, session);
  const steps = pipelineSteps(config, settings);
  const { perMinute, unknown } = pipelineCostPerMinute(config, settings);
  const source = pipelineSource(group, session);
  return (
    <button
      type="button"
      onClick={() => openPanel({ kind: 'pipeline' })}
      className="flex min-h-9 items-center gap-1.5 self-start rounded-full px-2.5 text-[13px] text-muted transition hover:bg-surface-2 hover:text-text"
      aria-label={`On stop: ${steps.join(', then ')}. Change pipeline`}
    >
      <Icon name="bolt" size={14} className="text-accent" />
      <span className="font-semibold text-text">Stop</span>
      {steps.map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <Icon name="chevron" size={12} className="text-faint" />
          {s}
        </span>
      ))}
      {config.process.mode !== 'off' && (
        <span className="text-faint">· {unknown ? 'price unknown' : `~${formatCost(perMinute)}/min`}</span>
      )}
      {source !== 'session' && <span className="hidden text-faint sm:inline">· {source === 'group' ? 'group default' : 'default'}</span>}
    </button>
  );
}

function Composer({ session, disabled }: { session: Session; disabled: boolean }) {
  const [text, setText] = useState('');
  const [tier, setTier] = useState<Tier>('little');
  const online = useOnline();
  const key = useApiKey();
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    if (!key) return toast('Connect OpenRouter in Settings to ask for help.', 'error');
    setText('');
    try {
      await sendMessage(session.id, t, tier);
    } catch (e) {
      toast(friendlyError(e), 'error');
      setText(t);
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col rounded-2xl border border-border bg-surface focus-within:border-accent">
      <textarea
        ref={ref}
        rows={1}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer: fine)').matches) {
            e.preventDefault();
            void send();
          }
        }}
        placeholder={online ? 'Ask about this session…' : 'Offline — messages send when you reconnect'}
        aria-label="Message"
        className="max-h-[200px] min-h-11 resize-none bg-transparent px-3.5 pt-3 pb-1 text-[15px] placeholder:text-faint focus:outline-none"
      />
      <div className="flex items-center gap-2 px-2 pb-2">
        <Segmented
          label="Model size"
          value={tier}
          onChange={setTier}
          options={[
            { value: 'little', label: 'Little' },
            { value: 'big', label: 'Big' },
          ]}
        />
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void send()}
          disabled={!text.trim()}
          aria-label="Send"
          className="grid size-9 place-items-center rounded-full bg-accent text-accent-text transition disabled:opacity-30"
        >
          <Icon name="send" size={18} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
}
