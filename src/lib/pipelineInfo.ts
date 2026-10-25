import { catalogModel, isKnown } from './openrouter/catalog';
import { estimateRun, presetById } from './runs';
import type { PipelineConfig, Run, Settings } from './types';

export function processLabel(mode: PipelineConfig['process']['mode']) {
  return { off: 'Save only', stt: 'Transcribe', audio: 'Inkling', combined: 'Transcribe + Inkling' }[mode];
}

/** Short step list for the pipeline control, e.g. ["Transcribe", "Clean up"]. */
export function pipelineSteps(config: PipelineConfig, settings: Settings): string[] {
  const steps = [processLabel(config.process.mode)];
  if (config.process.mode !== 'off' && config.infer.preset !== 'off') {
    steps.push(presetById(settings, config.infer.preset)?.name ?? config.infer.preset);
  }
  return steps;
}

/** Estimated USD per minute of audio for a pipeline, and whether any price was unknown. */
export function pipelineCostPerMinute(config: PipelineConfig, settings: Settings): { perMinute: number; unknown: boolean } {
  const runs: Pick<Run, 'kind' | 'mode' | 'model'>[] = [];
  const p = config.process;
  if (p.mode === 'stt' || p.mode === 'combined') runs.push({ kind: 'process', mode: 'stt', model: p.sttModel });
  if (p.mode === 'audio' || p.mode === 'combined') runs.push({ kind: 'process', mode: 'audio', model: p.audioModel });
  const preset = config.infer.preset === 'off' ? undefined : presetById(settings, config.infer.preset);
  if (preset && runs.length) runs.push({ kind: 'infer', mode: preset.id, model: settings.models[preset.tier] });
  return {
    perMinute: runs.reduce((n, r) => n + estimateRun(r, 60, settings), 0),
    unknown: runs.some((r) => !isKnown(r.model)),
  };
}

export function modelName(id: string, settings?: Settings) {
  const opt = settings && [...settings.littleOptions, ...settings.bigOptions, ...settings.sttOptions, ...settings.audioOptions].find((o) => o.id === id);
  return opt?.label ?? catalogModel(id)?.name.replace(/^[^:]+:\s*/, '') ?? id.split('/').pop() ?? id;
}

export function runVerb(run: Run, settings: Settings): string {
  if (run.kind === 'process') {
    if (run.mode === 'stt') return 'Transcribed';
    return run.model.includes('inkling') ? 'Inkling listened' : 'Audio notes';
  }
  if (run.mode === 'chat') return `${run.tier === 'big' ? 'Big' : 'Little'} replied`;
  const preset = presetById(settings, run.mode);
  if (preset?.id === 'cleanup') return 'Cleaned up';
  return preset?.name ?? run.mode;
}

export function runActivity(run: Run, settings: Settings): string {
  if (run.kind === 'process') {
    if (run.mode === 'stt') return 'Transcribing';
    return run.model.includes('inkling') ? 'Inkling is listening' : 'Listening';
  }
  if (run.mode === 'chat') return 'Thinking';
  const preset = presetById(settings, run.mode);
  return preset?.id === 'cleanup' ? 'Cleaning up' : `${preset?.name ?? 'Working'}`;
}
