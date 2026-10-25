import { catalogModel, isKnown } from './openrouter/catalog';
import { estimateRun, presetById } from './runs';
import type { PipelineConfig, PipelineStep, Run, Settings } from './types';
import { stepProblem } from './pipeline';

export function stepLabel(step: PipelineStep, settings: Settings): string {
  if (step.kind === 'transcribe') return 'Transcribe';
  if (step.kind === 'listen') return step.model?.includes('inkling') ? 'Inkling' : 'Listen';
  return presetById(settings, step.preset ?? '')?.name ?? 'Assist';
}

/** Short step list for the pipeline control, e.g. ["Transcribe", "Clean up"]. */
export function pipelineSteps(config: PipelineConfig, settings: Settings): string[] {
  return config.steps.length ? config.steps.map((s) => stepLabel(s, settings)) : ['Save only'];
}

/** Estimated USD per minute of audio for a pipeline, and whether any price was unknown. */
export function pipelineCostPerMinute(config: PipelineConfig, settings: Settings): { perMinute: number; unknown: boolean } {
  const runs: Pick<Run, 'kind' | 'mode' | 'model'>[] = [];
  config.steps.forEach((s, i) => {
    if (stepProblem(config.steps, i)) return;
    if (s.kind === 'transcribe') runs.push({ kind: 'process', mode: 'stt', model: s.model! });
    else if (s.kind === 'listen') runs.push({ kind: 'process', mode: 'audio', model: s.model! });
    else {
      const preset = presetById(settings, s.preset!);
      if (preset) runs.push({ kind: 'infer', mode: preset.id, model: settings.models[preset.tier] });
    }
  });
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

/** Order a turn's outputs by the step (run) that produced them, not by when they finished. */
export function byStepOrder<T extends { runId?: string; createdAt: number }>(entries: T[], runs: { id: string; createdAt: number }[]): T[] {
  const order = new Map(runs.map((r) => [r.id, r.createdAt]));
  const key = (e: T) => (e.runId && order.has(e.runId) ? order.get(e.runId)! : e.createdAt);
  return [...entries].sort((a, b) => key(a) - key(b) || a.createdAt - b.createdAt);
}
