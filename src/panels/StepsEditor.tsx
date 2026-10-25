import { INKLING, STT_DEFAULT } from '../lib/defaults';
import { MAX_STEPS, hasTranscribeBefore, step, stepProblem, withDefaultOutputs } from '../lib/pipeline';
import { modelName, stepLabel } from '../lib/pipelineInfo';
import type { PipelineConfig, PipelineStep, Settings, StepKind } from '../lib/types';
import { Icon } from '../ui/Icon';
import { Field, IconButton, Menu, Segmented, Toggle, inputClass } from '../ui/primitives';
import { ModelSelect } from './ModelSelect';

export type Change = (change: (c: PipelineConfig) => PipelineConfig) => void;

const KIND_HELP: Record<StepKind, string> = {
  transcribe: 'Speech to text with timestamps.',
  listen: 'An audio-aware model hears the recording itself.',
  assist: 'A Little or Big model works on earlier outputs.',
};

/**
 * Edit a pipeline's steps. `change` receives an updater so callers can apply it to the
 * freshest stored copy (the pipeline editor) or to local state (the process panel).
 */
export function StepsEditor({ config, change, settings, extraListenField }: { config: PipelineConfig; change: Change; settings: Settings; extraListenField?: React.ReactNode }) {
  const steps = config.steps;
  const setStep = (id: string, patch: Partial<PipelineStep>) => change((c) => ({ ...c, steps: c.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const remove = (id: string) =>
    change((c) => {
      const next = c.steps.filter((s) => s.id !== id);
      // Removing the shown last step: show the new last step so something still appears.
      return { ...c, steps: next.length && !next.some((s) => s.output === 'show') ? withDefaultOutputs(next) : next };
    });
  const move = (id: string, by: -1 | 1) =>
    change((c) => {
      const i = c.steps.findIndex((s) => s.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= c.steps.length) return c;
      const next = [...c.steps];
      [next[i], next[j]] = [next[j], next[i]];
      return { ...c, steps: next };
    });
  const add = (kind: StepKind) =>
    change((c) => {
      const created =
        kind === 'transcribe'
          ? step('transcribe', { model: settings.sttOptions[0]?.id ?? STT_DEFAULT })
          : kind === 'listen'
            ? step('listen', { model: settings.audioOptions[0]?.id ?? INKLING })
            : step('assist', { preset: settings.inferencePresets[0]?.id ?? 'cleanup' });
      // A new last step is what you most likely want to see; earlier steps fold away.
      return { ...c, steps: [...c.steps.map((s) => ({ ...s, output: 'collapse' as const })), { ...created, output: 'show' as const }] };
    });
  const usesAudio = steps.some((s) => s.kind !== 'assist');

  return (
    <div className="flex flex-col gap-3">
      {steps.length === 0 && (
        <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-[14px] text-muted">
          Nothing runs automatically. Recordings are saved; process them from their menu.
        </p>
      )}
      <ol className="flex flex-col gap-3">
        {steps.map((s, i) => (
          <StepCard
            key={s.id}
            step={s}
            index={i}
            steps={steps}
            settings={settings}
            onChange={(patch) => setStep(s.id, patch)}
            onRemove={() => remove(s.id)}
            onMove={(by) => move(s.id, by)}
            extraListenField={extraListenField}
          />
        ))}
      </ol>
      {steps.length < MAX_STEPS ? (
        <AddStep onAdd={add} canAssist={steps.length > 0} />
      ) : (
        <p className="text-[13px] text-faint">Up to {MAX_STEPS} steps.</p>
      )}
      {usesAudio && (
        <Field label="Language" hint="Two-letter code such as en or es. Leave empty to detect automatically.">
          <input
            className={inputClass}
            value={config.language}
            maxLength={5}
            onChange={(e) => {
              const language = e.target.value.trim().toLowerCase();
              change((c) => ({ ...c, language }));
            }}
            placeholder="auto"
          />
        </Field>
      )}
    </div>
  );
}

function AddStep({ onAdd, canAssist }: { onAdd: (k: StepKind) => void; canAssist: boolean }) {
  return (
    <div>
      <Menu
        icon="plus"
        text="Add step"
        label="Add step"
        className="border border-dashed border-border text-muted hover:border-accent hover:text-accent"
        items={[
          { label: 'Transcribe', icon: 'text', onSelect: () => onAdd('transcribe') },
          { label: canAssist ? 'Assist' : 'Assist (add another step first)', icon: 'sparkle', onSelect: () => onAdd('assist'), disabled: !canAssist },
        ]}
      />
    </div>
  );
}

function StepCard({
  step: s,
  index,
  steps,
  settings,
  onChange,
  onRemove,
  onMove,
  extraListenField,
}: {
  step: PipelineStep;
  index: number;
  steps: PipelineStep[];
  settings: Settings;
  onChange: (patch: Partial<PipelineStep>) => void;
  onRemove: () => void;
  onMove: (by: -1 | 1) => void;
  extraListenField?: React.ReactNode;
}) {
  const problem = stepProblem(steps, index);
  const preset = s.kind === 'assist' ? settings.inferencePresets.find((p) => p.id === s.preset) : undefined;
  return (
    <li className="rounded-xl border border-hairline bg-surface" aria-label={`Step ${index + 1}: ${stepLabel(s, settings)}`}>
      <div className="flex items-center gap-1 border-b border-hairline py-1 pr-1 pl-3">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-bold text-accent">{index + 1}</span>
        <span className="ml-1 min-w-0 flex-1 truncate text-[14px] font-semibold">
          {s.kind === 'transcribe' ? 'Transcribe' : s.kind === 'listen' ? 'Listen' : 'Assist'}
          <span className="ml-1.5 font-normal text-faint">{s.kind === 'assist' ? (preset?.name ?? '') : s.model ? modelName(s.model, settings) : ''}</span>
        </span>
        <IconButton icon="up" label="Move step up" size={16} disabled={index === 0} onClick={() => onMove(-1)} className="disabled:opacity-30" />
        <IconButton icon="down" label="Move step down" size={16} disabled={index === steps.length - 1} onClick={() => onMove(1)} className="disabled:opacity-30" />
        <IconButton icon="close" label="Remove step" size={16} onClick={onRemove} />
      </div>
      <div className="flex flex-col gap-3 p-3">
        <p className="text-[13px] text-muted">{KIND_HELP[s.kind]}</p>
        {s.kind === 'transcribe' && (
          <>
            <ModelSelect label="Model" kind="transcription" value={s.model ?? ''} options={settings.sttOptions} onChange={(model) => onChange({ model })} />
            <Toggle
              label="Skip silence"
              description="Only the parts where you speak are sent, so long, mostly quiet recordings cost very little."
              checked={s.skipSilence !== false}
              onChange={(skipSilence) => onChange({ skipSilence })}
            />
          </>
        )}
        {s.kind === 'listen' && (
          <>
            {s.model?.includes('inkling') && (
              <p className="rounded-lg bg-accent-soft px-3 py-2 text-[13px]">
                <strong>Inkling hears the audio itself</strong> — pronunciation, stress, pauses and hesitation, not just the words.
              </p>
            )}
            <ModelSelect label="Model" kind="chat" requireAudio value={s.model ?? ''} options={settings.audioOptions} onChange={(model) => onChange({ model })} />
            {hasTranscribeBefore(steps, index) ? (
              <Toggle
                label="Give it the earlier transcript"
                description="Usually off: it writes its own transcript from what it hears. Turn on to help with names; it then gives only notes."
                checked={!!s.useTranscript}
                onChange={(useTranscript) => onChange({ useTranscript })}
              />
            ) : (
              <p className="text-[13px] text-faint">It writes its own transcript from what it hears.</p>
            )}
            <Field label="What should it listen for?" hint="Added after the default, group and session instructions.">
              <textarea className={`${inputClass} min-h-20`} value={s.instructions} onChange={(e) => onChange({ instructions: e.target.value })} />
            </Field>
            {extraListenField}
          </>
        )}
        {s.kind === 'assist' && (
          <>
            <Field label="Task">
              <select className={inputClass} value={s.preset ?? ''} onChange={(e) => onChange({ preset: e.target.value })}>
                {settings.inferencePresets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.tier === 'big' ? 'Big' : 'Little'} · {modelName(settings.models[p.tier], settings)})
                  </option>
                ))}
              </select>
            </Field>
            {index > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold text-muted">Works on</span>
                <Segmented
                  label="Input"
                  value={s.input ?? 'previous'}
                  onChange={(input) => onChange({ input })}
                  options={[
                    { value: 'previous', label: 'Previous step' },
                    { value: 'all', label: 'All earlier steps' },
                  ]}
                />
              </div>
            )}
            <Field label="Extra instructions for this step">
              <textarea className={`${inputClass} min-h-16`} value={s.instructions} onChange={(e) => onChange({ instructions: e.target.value })} />
            </Field>
          </>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-muted">In the session</span>
          <Segmented
            label="Output"
            value={s.output}
            onChange={(output) => onChange({ output })}
            options={[
              { value: 'show', label: 'Show' },
              { value: 'collapse', label: 'Collapse' },
            ]}
          />
        </div>
        {problem && (
          <p className="flex items-center gap-1.5 text-[13px] text-warn">
            <Icon name="alert" size={14} /> {problem} This step is skipped.
          </p>
        )}
      </div>
    </li>
  );
}
