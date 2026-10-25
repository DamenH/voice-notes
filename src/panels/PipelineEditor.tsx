import { useState } from 'react';
import { db, getSettings, updateSettings } from '../lib/db';
import { newId, now } from '../lib/ids';
import { pipelineSource, resolvePipeline } from '../lib/instructions';
import { clonePipeline, normalizePipeline, samePipeline } from '../lib/pipeline';
import { pipelineCostPerMinute } from '../lib/pipelineInfo';
import { formatCost } from '../lib/openrouter/catalog';
import type { Group, PipelineConfig, Session, Settings } from '../lib/types';
import { useCatalog } from '../app/hooks';
import { Button, Field, Segmented, inputClass, toast } from '../ui/primitives';
import { StepsEditor } from './StepsEditor';

export type Scope = 'session' | 'group' | 'global';

/**
 * Edit what happens when a recording stops. Session edits override the group, which
 * overrides the global default.
 */
export function PipelineEditor({ settings, group, session, initialScope }: { settings: Settings; group?: Group; session?: Session; initialScope?: Scope }) {
  useCatalog();
  const [scope, setScope] = useState<Scope>(initialScope ?? (session ? 'session' : group ? 'group' : 'global'));
  const config =
    scope === 'session'
      ? resolvePipeline(settings, group, session)
      : scope === 'group'
        ? (normalizePipeline(group?.pipeline) ?? settings.pipeline)
        : settings.pipeline;
  const overridden = scope === 'session' ? !!session?.pipeline : scope === 'group' ? !!group?.pipeline : true;
  const source = pipelineSource(group, session);

  const save = async (next: PipelineConfig) => {
    if (scope === 'session' && session) await db.sessions.update(session.id, { pipeline: next, updatedAt: now() });
    else if (scope === 'group' && group) await db.groups.update(group.id, { pipeline: next, updatedAt: now() });
    else await updateSettings({ pipeline: next });
  };
  // Edits are read-modify-write against the database, so quick successive changes never use a stale copy.
  const change = (fn: (c: PipelineConfig) => PipelineConfig) =>
    void (async () => {
      const s2 = await getSettings();
      const g = group ? await db.groups.get(group.id) : undefined;
      const ses = session ? await db.sessions.get(session.id) : undefined;
      const fresh = scope === 'session' ? resolvePipeline(s2, g, ses) : scope === 'group' ? (normalizePipeline(g?.pipeline) ?? s2.pipeline) : s2.pipeline;
      await save(fn(fresh));
    })();
  const reset = async () => {
    if (scope === 'session' && session) await db.sessions.update(session.id, { pipeline: null });
    if (scope === 'group' && group) await db.groups.update(group.id, { pipeline: null });
  };
  const { perMinute, unknown } = pipelineCostPerMinute(config, settings);
  const matching = settings.pipelinePresets.find((p) => samePipeline(p.config, config));

  const saveAsPreset = async () => {
    const name = prompt('Name this pipeline');
    if (!name?.trim()) return;
    await updateSettings({ pipelinePresets: [...settings.pipelinePresets, { id: newId('pp'), name: name.trim(), config }] });
    toast(`Saved “${name.trim()}”`);
  };
  const deletePreset = async (id: string) => {
    await updateSettings({ pipelinePresets: settings.pipelinePresets.filter((p) => p.id !== id) });
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
            <span key={p.id} className="inline-flex">
              <button
                type="button"
                // Presets set the steps; when the pipeline runs is kept.
                onClick={() => void save({ ...clonePipeline(p.config), trigger: config.trigger, batchPreset: config.batchPreset })}
                aria-pressed={matching?.id === p.id}
                className={`min-h-9 rounded-full border px-3 text-[13px] font-semibold transition ${
                  matching?.id === p.id ? 'border-accent bg-accent-soft text-accent' : 'border-border text-muted hover:text-text'
                } ${p.builtin ? '' : 'rounded-r-none border-r-0'}`}
              >
                {p.name}
              </button>
              {!p.builtin && (
                <button
                  type="button"
                  aria-label={`Delete preset ${p.name}`}
                  title="Delete preset"
                  onClick={() => void deletePreset(p.id)}
                  className="min-h-9 rounded-r-full border border-border px-2 text-[13px] text-faint hover:text-rec"
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-[15px] font-bold">Run</h3>
        <Segmented
          label="When the pipeline runs"
          value={config.trigger ?? 'stop'}
          onChange={(trigger) => change((c) => ({ ...c, trigger }))}
          options={[
            { value: 'stop', label: 'When recording stops' },
            { value: 'request', label: 'When I ask' },
          ]}
        />
        {config.trigger === 'request' ? (
          <>
            <p className="text-[13px] text-muted">Record as many takes as you like; they wait until you press “Process now”.</p>
            <Field label="After processing, also">
              <select className={inputClass} value={config.batchPreset ?? ''} onChange={(e) => {
                  // Read the value now: the save is asynchronous and the event target resets.
                  const batchPreset = e.target.value || null;
                  change((c) => ({ ...c, batchPreset }));
                }}>
                <option value="">Nothing</option>
                {settings.inferencePresets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} across all of them ({p.tier === 'big' ? 'Big' : 'Little'})
                  </option>
                ))}
              </select>
            </Field>
          </>
        ) : (
          <p className="text-[13px] text-muted">Each recording is processed as soon as you stop.</p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[15px] font-bold">Steps</h3>
        <StepsEditor config={config} change={change} settings={settings} />
      </section>

      <div className="rounded-xl bg-surface-2 px-3 py-2.5 text-[13px]">
        <p>
          <strong>Estimated cost:</strong> {config.steps.length === 0 ? 'free (nothing runs)' : unknown ? 'some prices unknown' : `about ${formatCost(perMinute)} per minute of audio`}
        </p>
        <p className="text-muted">
          Adding steps approves them for automatic runs. Runs estimated above ${settings.costCeiling.toFixed(2)} wait for your approval.
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
