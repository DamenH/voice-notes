import { newId } from './ids';
import type { PipelineConfig, PipelineStep, StepKind } from './types';

export const MAX_STEPS = 5;

/** The mode-based pipeline shape used before step lists (database v1–v2, old exports). */
interface LegacyPipeline {
  process: {
    mode: 'off' | 'stt' | 'audio' | 'combined';
    sttModel: string;
    audioModel: string;
    language?: string;
    transcriptToAudioModel?: boolean;
    instructions?: string;
  };
  infer: { preset: string; instructions?: string };
}

function isLegacy(p: unknown): p is LegacyPipeline {
  return !!p && typeof p === 'object' && 'process' in p && !('steps' in p);
}

/**
 * Convert the old shape to steps, keeping its behaviour: the same models and
 * instructions, the last step shown and earlier ones collapsed.
 */
export function fromLegacy(old: LegacyPipeline): PipelineConfig {
  const { process: p, infer } = old;
  const steps: PipelineStep[] = [];
  if (p.mode === 'stt' || p.mode === 'combined') steps.push(step('transcribe', { model: p.sttModel }));
  if (p.mode === 'audio' || p.mode === 'combined') {
    steps.push(step('listen', { model: p.audioModel, instructions: p.instructions ?? '', useTranscript: p.mode === 'combined' && p.transcriptToAudioModel !== false }));
  }
  if (steps.length && infer.preset !== 'off') {
    steps.push(step('assist', { preset: infer.preset, instructions: infer.instructions ?? '', input: steps.length > 1 ? 'all' : 'previous' }));
  }
  return { language: p.language ?? '', steps: withDefaultOutputs(steps) };
}

/** Accept either shape (old saved settings, old library imports) and return steps. */
export function normalizePipeline(p: PipelineConfig | LegacyPipeline | null | undefined): PipelineConfig | null {
  if (!p) return null;
  if (isLegacy(p)) return fromLegacy(p);
  return p as PipelineConfig;
}

export function step(kind: StepKind, patch: Partial<PipelineStep> = {}): PipelineStep {
  return {
    id: newId('st'),
    kind,
    instructions: '',
    output: 'collapse',
    // Audio-aware models write their own transcript unless asked to use an earlier one.
    ...(kind === 'listen' ? { useTranscript: false } : {}),
    ...(kind === 'assist' ? { input: 'previous' as const } : {}),
    ...patch,
  };
}

/** Last step shown, earlier steps collapsed. */
export function withDefaultOutputs(steps: PipelineStep[]): PipelineStep[] {
  return steps.map((s, i) => ({ ...s, output: i === steps.length - 1 ? 'show' : 'collapse' }));
}

/** Compare pipelines ignoring step ids, key order and unset fields (copies of a preset get fresh ids). */
export function samePipeline(a: PipelineConfig, b: PipelineConfig): boolean {
  const canon = (p: PipelineConfig) =>
    JSON.stringify({
      language: p.language,
      steps: p.steps.map(({ id: _id, ...rest }) =>
        Object.fromEntries(
          Object.entries(rest)
            .filter(([, v]) => v !== undefined)
            .sort(([x], [y]) => x.localeCompare(y)),
        ),
      ),
    });
  return canon(a) === canon(b);
}

/** A copy with fresh step ids, for applying a preset. */
export function clonePipeline(p: PipelineConfig): PipelineConfig {
  return { ...p, steps: p.steps.map((s) => ({ ...s, id: newId('st') })) };
}

/** Problems that would make a step do nothing; shown in the editor and skipped when planning. */
export function stepProblem(steps: PipelineStep[], index: number): string | null {
  const s = steps[index];
  if (s.kind === 'assist' && index === 0) return 'Needs an earlier step to work on.';
  if (s.kind === 'assist' && !s.preset) return 'Choose what this step does.';
  if (s.kind !== 'assist' && !s.model) return 'Choose a model.';
  return null;
}

export function hasTranscribeBefore(steps: PipelineStep[], index: number) {
  return steps.slice(0, index).some((s) => s.kind === 'transcribe');
}
