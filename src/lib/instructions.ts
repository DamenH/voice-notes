import { normalizePipeline } from './pipeline';
import type { Group, InstructionSet, PipelineConfig, Session, Settings, TtsSettings } from './types';

export type Chain = 'processing' | 'inference';

const LEVELS = [
  ['Global defaults', 'global'],
  ['Group instructions', 'group'],
  ['Session instructions', 'session'],
  ['Instructions for this run', 'run'],
] as const;

export interface InstructionSources {
  global: InstructionSet;
  group?: InstructionSet;
  session?: InstructionSet;
  run?: string;
}

/**
 * Resolve the effective instructions for one chain. Every non-empty level is kept,
 * in order, with an explicit note that later (more specific) levels win on conflict.
 * The result is what gets snapshotted on the run.
 */
export function resolveInstructions(chain: Chain, sources: InstructionSources): string {
  const parts: string[] = [];
  for (const [label, key] of LEVELS) {
    const text = key === 'run' ? sources.run : sources[key]?.[chain];
    if (text && text.trim()) parts.push(`## ${label}\n${text.trim()}`);
  }
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts.join('\n\n')}\n\nWhen these instructions conflict, follow the more specific (later) section.`;
}

export function resolvePipeline(settings: Settings, group?: Group | null, session?: Session | null): PipelineConfig {
  return normalizePipeline(session?.pipeline) ?? normalizePipeline(group?.pipeline) ?? settings.pipeline;
}

export function pipelineSource(group?: Group | null, session?: Session | null): 'session' | 'group' | 'global' {
  if (session?.pipeline) return 'session';
  if (group?.pipeline) return 'group';
  return 'global';
}

export function resolveTts(settings: Settings, group?: Group | null, session?: Session | null): TtsSettings {
  return { ...settings.tts, ...(group?.tts ?? {}), ...(session?.tts ?? {}) };
}
