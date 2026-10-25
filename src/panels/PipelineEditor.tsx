import { useState } from 'react';
import { db, getSettings, updateSettings } from '../lib/db';
import { newId, now } from '../lib/ids';
import { pipelineSource, resolvePipeline } from '../lib/instructions';
import { pipelineCostPerMinute } from '../lib/pipelineInfo';
import { formatCost } from '../lib/openrouter/catalog';
import type { Group, PipelineConfig, ProcessMode, Session, Settings } from '../lib/types';
import { useCatalog } from '../app/hooks';
import { Button, Field, Segmented, Toggle, inputClass, toast } from '../ui/primitives';
import { ModelSelect } from './ModelSelect';

export type Scope = 'session' | 'group' | 'global';

/**
 * Edit what happens when a recording stops. Session edits override the group, which
 * overrides the global default.
 */
export function PipelineEditor({ settings, group, session, initialScope }: { settings: Settings; group?: Group; session?: Session; initialScope?: Scope }) {
  useCatalog();
  const [scope, setScope] = useState<Scope>(initialScope ?? (session ? 'session' : group ? 'group' : 'global'));
  const config =
    scope === 'session' ? resolvePipeline(settings, group, session) : scope === 'group' ? (group?.pipeline ?? settings.pipeline) : settings.pipeline;
  const overridden = scope === 'session' ? !!session?.pipeline : scope === 'group' ? !!group?.pipeline : true;
  const source = pipelineSource(group, session);

  const save = async (next: PipelineConfig) => {
    if (scope === 'session' && session) await db.sessions.update(session.id, { pipeline: next, updatedAt: now() });
    else if (scope === 'group' && group) await db.groups.update(group.id, { pipeline: next, updatedAt: now() });
    else await updateSettings({ pipeline: next });
  };
  // Edits are read-modify-write against the database, so quick successive changes never use a stale copy.
  const edit = async (change: (c: PipelineConfig) => PipelineConfig) => {
    const s2 = await getSettings();
    const g = group ? await db.groups.get(group.id) : undefined;
    const ses = session ? await db.sessions.get(session.id) : undefined;
    const fresh = scope === 'session' ? resolvePipeline(s2, g, ses) : scope === 'group' ? (g?.pipeline ?? s2.pipeline) : s2.pipeline;
    await save(change(fresh));
  };
  const reset = async () => {
    if (scope === 'session' && session) await db.sessions.update(session.id, { pipeline: null });
    if (scope === 'group' && group) await db.groups.update(group.id, { pipeline: null });
  };
  const setProcess = (patch: Partial<PipelineConfig['process']>) => void edit((c) => ({ ...c, process: { ...c.process, ...patch } }));
  const setInfer = (patch: Partial<PipelineConfig['infer']>) => void edit((c) => ({ ...c, infer: { ...c.infer, ...patch } }));
  const { perMinute, unknown } = pipelineCostPerMinute(config, settings);
  const preset = settings.inferencePresets.find((p) => p.id === config.infer.preset);
  const matching = settings.pipelinePresets.find((p) => JSON.stringify(p.config) === JSON.stringify(config));

  const saveAsPreset = async () => {
    const name = prompt('Name this pipeline');
    if (!name?.trim()) return;
    await updateSettings({ pipelinePresets: [...settings.pipelinePresets, { id: newId('pp'), name: name.trim(), config }] });
    toast(`Saved “${name.trim()}”`);
  };

  const scopes = [
    ...(session ? [{ value: 'session' as Scope, label: 'This session' }] : []),
    ...(group ? [{ value: 'group' as Scope, label: 'Group' }] : []),
    { value: 'global' as Scope, label: 'Default' },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        {scopes.length > 1 && <Segmented label="Applies to" value={scope} onChange={setScope} options={scopes} />}
        <p className="text-[13px] text-muted">
          {scope === 'session' && !overridden && `Using the ${source === 'group' ? 'group' : 'default'} pipeline. Changes here apply to this session only.`}
          {scope === 'session' && overridden && 'This session has its own pipeline.'}
          {scope === 'group' && (overridden ? 'New sessions in this group use this pipeline.' : 'Using the default pipeline. Changes apply to all sessions in this group without their own.')}
          {scope === 'global' && 'Used by groups and sessions that do not set their own.'}
        </p>
      </div>

      <div>
        <p className="mb-2 text-[13px] font-semibold text-muted">Presets</p>
        <div className="flex flex-wrap gap-2">
          {settings.pipelinePresets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => void save(p.config)}
              aria-pressed={matching?.id === p.id}
              className={`min-h-9 rounded-full border px-3 text-[13px] font-semibold transition ${
                matching?.id === p.id ? 'border-accent bg-accent-soft text-accent' : 'border-border text-muted hover:text-text'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h3 className="text-[15px] font-bold">1. Process the audio</h3>
        <Segmented<ProcessMode>
          label="Processing mode"
          value={config.process.mode}
          onChange={(mode) => setProcess({ mode })}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'stt', label: 'Transcribe' },
            { value: 'audio', label: 'Inkling' },
            { value: 'combined', label: 'Both' },
          ]}
        />
        {config.process.mode === 'audio' || config.process.mode === 'combined' ? (
          <p className="rounded-lg bg-accent-soft px-3 py-2 text-[13px] text-text">
            <strong>Inkling hears the audio itself</strong>, so it can notice pronunciation, stress, pauses, hesitation and emphasis — not just the words. Ideal for language practice.
          </p>
        ) : null}
        {(config.process.mode === 'stt' || config.process.mode === 'combined') && (
          <ModelSelect label="Transcription model" kind="transcription" value={config.process.sttModel} options={settings.sttOptions} onChange={(sttModel) => setProcess({ sttModel })} />
        )}
        {(config.process.mode === 'audio' || config.process.mode === 'combined') && (
          <ModelSelect label="Audio-aware model" kind="chat" requireAudio value={config.process.audioModel} options={settings.audioOptions} onChange={(audioModel) => setProcess({ audioModel })} />
        )}
        {config.process.mode === 'combined' && (
          <Toggle
            label="Give Inkling the transcript too"
            description="Helps with names and fast speech. Inkling is told to trust what it hears."
            checked={config.process.transcriptToAudioModel}
            onChange={(transcriptToAudioModel) => setProcess({ transcriptToAudioModel })}
          />
        )}
        {config.process.mode !== 'off' && (
          <Field label="Language" hint="Two-letter code such as en or es. Leave empty to detect automatically.">
            <input className={inputClass} value={config.process.language} maxLength={5} onChange={(e) => setProcess({ language: e.target.value.trim().toLowerCase() })} placeholder="auto" />
          </Field>
        )}
        {(config.process.mode === 'audio' || config.process.mode === 'combined') && (
          <Field label="What should Inkling listen for?" hint="Added after the global, group and session instructions.">
            <textarea className={`${inputClass} min-h-24`} value={config.process.instructions} onChange={(e) => setProcess({ instructions: e.target.value })} />
          </Field>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-[15px] font-bold">2. Then</h3>
        <select className={inputClass} value={config.infer.preset} disabled={config.process.mode === 'off'} onChange={(e) => setInfer({ preset: e.target.value })} aria-label="Inference step">
          <option value="off">Nothing — stop after processing</option>
          {settings.inferencePresets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.tier === 'big' ? 'Big' : 'Little'})
            </option>
          ))}
        </select>
        {preset && (
          <>
            <p className="text-[13px] text-muted">
              Uses the {preset.tier === 'big' ? 'Big' : 'Little'} model ({settings.models[preset.tier].split('/').pop()}). Change models in Settings.
            </p>
            <Field label="Extra instructions for this step">
              <textarea className={`${inputClass} min-h-20`} value={config.infer.instructions} onChange={(e) => setInfer({ instructions: e.target.value })} />
            </Field>
          </>
        )}
      </section>

      <div className="rounded-xl bg-surface-2 px-3 py-2.5 text-[13px]">
        <p>
          <strong>Estimated cost:</strong> {config.process.mode === 'off' ? 'free (nothing runs)' : unknown ? 'some prices unknown' : `about ${formatCost(perMinute)} per minute of audio`}
        </p>
        <p className="text-muted">
          Turning steps on approves them for automatic runs. Runs estimated above ${settings.costCeiling.toFixed(2)} wait for your approval.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button small icon="plus" onClick={() => void saveAsPreset()}>
          Save as preset
        </Button>
        {scope !== 'global' && overridden && (
          <Button small variant="plain" onClick={() => void reset()}>
            Use {scope === 'session' ? 'group' : 'default'} pipeline
          </Button>
        )}
      </div>
    </div>
  );
}
