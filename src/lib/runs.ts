import { db, getSettings } from './db';
import { newId, now } from './ids';
import { createEntry, updateEntry } from './library';
import { resolveInstructions, resolvePipeline } from './instructions';
import {
  TRANSCRIPT_TOKENS_PER_MINUTE,
  estimateChat,
  estimateTranscription,
  isKnown,
} from './openrouter/catalog';
import type { Entry, Group, Id, InferencePreset, PipelineConfig, Run, Session, Settings, SourceRef } from './types';
import { stepProblem } from './pipeline';
import type { AudioRequest } from './tools';
import { notifyScheduler, requestAbort } from './scheduler-signal';
import { INKLING, STT_DEFAULT } from './defaults';

interface Context {
  settings: Settings;
  session: Session;
  group: Group | undefined;
}

async function contextFor(sessionId: Id): Promise<Context> {
  const settings = await getSettings();
  const session = await db.sessions.get(sessionId);
  if (!session) throw new Error('Session not found');
  const group = await db.groups.get(session.groupId);
  return { settings, session, group };
}

function baseRun(ctx: Context, turnId: Id, partial: Partial<Run> & Pick<Run, 'kind' | 'mode' | 'model'>): Run {
  const t = now();
  return {
    id: newId('run'),
    sessionId: ctx.session.id,
    groupId: ctx.session.groupId,
    turnId,
    trigger: 'manual',
    settings: {},
    instructions: '',
    sourceRefs: [],
    dependsOn: [],
    status: 'queued',
    usage: {},
    outputEntryIds: [],
    createdAt: t,
    updatedAt: t,
    ...partial,
  };
}

export function presetById(settings: Settings, id: string): InferencePreset | undefined {
  return settings.inferencePresets.find((p) => p.id === id);
}

/** Rough per-run estimates from catalog prices and measured ratios (see docs/FINDINGS.md). */
export function estimateRun(run: Pick<Run, 'kind' | 'mode' | 'model'>, seconds: number, settings: Settings): number {
  const minutes = seconds / 60;
  const transcriptTokens = minutes * TRANSCRIPT_TOKENS_PER_MINUTE;
  if (run.kind === 'process') {
    if (run.mode === 'stt') return estimateTranscription(run.model, seconds);
    // Audio-aware: audio in + instructions; out ≈ transcript plus notes.
    return estimateChat(run.model, 400 + transcriptTokens, transcriptTokens * 2, seconds);
  }
  const preset = presetById(settings, run.mode);
  const out = preset?.chunked ? transcriptTokens : 800;
  return estimateChat(run.model, 600 + transcriptTokens * 2, out);
}

export interface PipelinePlan {
  runs: Run[];
  estimate: number;
  unknownPrices: boolean;
}

/** Build (but do not save) the runs a pipeline would create for a recording. */
export async function planPipeline(
  recording: Entry,
  config: PipelineConfig,
  opts: { trigger: Run['trigger']; range?: { start: number; end: number }; extraInstructions?: string } = { trigger: 'auto' },
): Promise<PipelinePlan> {
  const ctx = await contextFor(recording.sessionId);
  const duration = Number(recording.meta?.duration ?? 0);
  const range = opts.range ?? { start: 0, end: duration };
  const source: SourceRef = { entryId: recording.id, start: range.start, end: range.end };
  const common = { trigger: opts.trigger, sourceRefs: [source] };
  const runs: Run[] = [];
  // The run each step produced (undefined when a step is skipped as unusable).
  const byStep: (Run | undefined)[] = [];
  config.steps.forEach((step, i) => {
    let run: Run | undefined;
    const primary = step.output === 'show';
    if (stepProblem(config.steps, i)) {
      byStep.push(undefined);
      return;
    }
    if (step.kind === 'transcribe') {
      run = baseRun(ctx, recording.turnId, {
        ...common,
        kind: 'process',
        mode: 'stt',
        model: step.model!,
        settings: { language: config.language, primary, stepId: step.id },
      });
    } else if (step.kind === 'listen') {
      const transcriptRun = step.useTranscript
        ? [...byStep.slice(0, i)].reverse().find((r) => r?.kind === 'process' && r.mode === 'stt')
        : undefined;
      run = baseRun(ctx, recording.turnId, {
        ...common,
        kind: 'process',
        mode: 'audio',
        model: step.model!,
        settings: { language: config.language, withTranscript: !!transcriptRun, primary, stepId: step.id },
        instructions: resolveInstructions('processing', {
          global: ctx.settings.instructions,
          group: ctx.group?.instructions,
          session: ctx.session.instructions,
          run: [step.instructions, opts.extraInstructions].filter(Boolean).join('\n\n'),
        }),
        dependsOn: transcriptRun ? [transcriptRun.id] : [],
      });
    } else {
      const preset = presetById(ctx.settings, step.preset!);
      const earlier = byStep.slice(0, i).filter((r): r is Run => !!r);
      const inputs = step.input === 'all' ? earlier : earlier.slice(-1);
      if (preset && inputs.length) {
        run = baseRun(ctx, recording.turnId, {
          ...common,
          kind: 'infer',
          mode: preset.id,
          tier: preset.tier,
          model: ctx.settings.models[preset.tier],
          instructions: inferenceInstructions(ctx, preset, step.instructions),
          dependsOn: inputs.map((r) => r.id),
          settings: { presetName: preset.name, primary, input: step.input ?? 'previous', stepId: step.id },
        });
      }
    }
    byStep.push(run);
    if (run) runs.push(run);
  });
  let unknownPrices = false;
  for (const r of runs) {
    r.estimatedCost = estimateRun(r, range.end - range.start, ctx.settings);
    if (!isKnown(r.model)) unknownPrices = true;
  }
  return { runs, estimate: runs.reduce((n, r) => n + (r.estimatedCost ?? 0), 0), unknownPrices };
}

function inferenceInstructions(ctx: Context, preset: InferencePreset, stepInstructions?: string) {
  const chain = resolveInstructions('inference', {
    global: ctx.settings.instructions,
    group: ctx.group?.instructions,
    session: ctx.session.instructions,
    run: stepInstructions,
  });
  return `# Task: ${preset.name}\n${preset.prompt}${chain ? `\n\n${chain}` : ''}`;
}

/**
 * Save planned runs. Automatic pipelines estimated above the cost ceiling wait for
 * approval; everything else is queued for the scheduler.
 */
export async function submitPlan(plan: PipelinePlan, recording: Entry): Promise<{ awaitingApproval: boolean }> {
  if (plan.runs.length === 0) return { awaitingApproval: false };
  const settings = await getSettings();
  const needsApproval = plan.runs[0].trigger === 'auto' && plan.estimate > settings.costCeiling;
  const runs = plan.runs.map((r) => ({ ...r, status: needsApproval ? ('awaiting_approval' as const) : ('queued' as const) }));
  await db.runs.bulkAdd(runs);
  if (needsApproval) {
    await createEntry({
      sessionId: recording.sessionId,
      groupId: recording.groupId,
      turnId: recording.turnId,
      kind: 'approval_request',
      text: `This recording's pipeline is estimated at $${plan.estimate.toFixed(3)}, above your automatic limit of $${settings.costCeiling.toFixed(2)}.`,
      status: 'waiting',
      visibility: 'primary',
      sourceRefs: [{ entryId: recording.id }],
      meta: { runIds: runs.map((r) => r.id), estimate: plan.estimate, reason: 'ceiling' },
    });
  }
  notifyScheduler();
  return { awaitingApproval: needsApproval };
}

/** Run the session's pipeline on a just-finished recording. */
export async function runPipelineForRecording(recordingEntryId: Id) {
  const recording = await db.entries.get(recordingEntryId);
  if (!recording) return;
  const ctx = await contextFor(recording.sessionId);
  const config = resolvePipeline(ctx.settings, ctx.group, ctx.session);
  if (config.steps.length === 0) return;
  if (Number(recording.meta?.duration ?? 0) < 0.5) return;
  await submitPlan(await planPipeline(recording, config, { trigger: 'auto' }), recording);
}

/** Manual processing of a recording or range with explicit settings (explicit action = approval). */
export async function processRecording(
  recordingEntryId: Id,
  config: PipelineConfig,
  opts: { range?: { start: number; end: number }; extraInstructions?: string } = {},
) {
  const recording = await db.entries.get(recordingEntryId);
  if (!recording) throw new Error('Recording not found');
  const plan = await planPipeline(recording, config, { trigger: 'manual', ...opts });
  await submitPlan(plan, recording);
  return plan;
}

/** Run an inference preset over specific entries (e.g. "Clean up" on a transcript). */
export async function inferOnEntries(sessionId: Id, presetId: string, sourceIds: Id[], tier?: 'little' | 'big') {
  const ctx = await contextFor(sessionId);
  const preset = presetById(ctx.settings, presetId);
  if (!preset) throw new Error('Unknown preset');
  const first = await db.entries.get(sourceIds[0]);
  const t = tier ?? preset.tier;
  const run = baseRun(ctx, first?.turnId ?? newId('turn'), {
    kind: 'infer',
    mode: preset.id,
    tier: t,
    model: ctx.settings.models[t],
    instructions: inferenceInstructions(ctx, preset),
    sourceRefs: sourceIds.map((entryId) => ({ entryId })),
    settings: { presetName: preset.name },
  });
  await db.runs.add(run);
  notifyScheduler();
  return run;
}

/** A chat message from the user. The response uses session context and (for Big) tools. */
export async function sendMessage(sessionId: Id, text: string, tier: 'little' | 'big') {
  const ctx = await contextFor(sessionId);
  const message = await createEntry({
    sessionId,
    groupId: ctx.session.groupId,
    kind: 'user_message',
    text,
    status: 'done',
    visibility: 'primary',
  });
  const chain = resolveInstructions('inference', {
    global: ctx.settings.instructions,
    group: ctx.group?.instructions,
    session: ctx.session.instructions,
  });
  const run = baseRun(ctx, message.turnId, {
    kind: 'infer',
    mode: 'chat',
    tier,
    model: ctx.settings.models[tier],
    instructions: chain,
    request: text,
    sourceRefs: [{ entryId: message.id }],
    settings: { tools: true },
  });
  await db.runs.add(run);
  notifyScheduler();
  return { message, run };
}

/** Approve or decline an approval request (cost ceiling or a model's audio processing request). */
export async function resolveApproval(entryId: Id, approve: boolean) {
  const entry = await db.entries.get(entryId);
  if (!entry || entry.kind !== 'approval_request' || entry.status !== 'waiting') return;
  const runIds = (entry.meta?.runIds as Id[]) ?? [];
  const parentRunId = entry.meta?.parentRunId as Id | undefined;
  await db.transaction('rw', db.runs, db.entries, db.searchRecords, async () => {
    for (const id of runIds) {
      await db.runs.update(id, { status: approve ? 'queued' : 'cancelled', updatedAt: now() });
    }
    if (parentRunId) {
      // The model's run resumes either way: with the processing result, or with the refusal.
      if (approve) await db.runs.update(parentRunId, { status: 'queued', dependsOn: runIds, updatedAt: now() });
      else await db.runs.update(parentRunId, { status: 'queued', settings: { ...((await db.runs.get(parentRunId))?.settings ?? {}), declined: true }, updatedAt: now() });
    }
    await updateEntry(entryId, { status: 'done', meta: { ...entry.meta, decision: approve ? 'approved' : 'declined' } });
  });
  notifyScheduler();
}

/** Retry a failed run. Explicitly re-sends any request whose outcome was uncertain. */
export async function retryRun(runId: Id) {
  await db.transaction('rw', db.runs, db.segments, db.entries, async () => {
    const run = await db.runs.get(runId);
    if (!run || !['failed', 'cancelled', 'blocked'].includes(run.status)) return;
    // Earlier failures of this run are resolved by retrying; keep them in the details.
    await db.entries
      .where('runId')
      .equals(runId)
      .filter((e) => e.kind === 'error' && e.status === 'failed')
      .modify({ status: 'done', visibility: 'detail' });
    await db.segments
      .where('runId')
      .equals(runId)
      .filter((s) => s.status === 'failed' || s.status === 'uncertain' || s.status === 'requesting')
      .modify({ status: 'pending' });
    await db.runs.update(runId, { status: 'queued', error: undefined, updatedAt: now() });
    await unblockDependents(runId);
  });
  notifyScheduler();
}

async function unblockDependents(runId: Id) {
  const dependents = await db.runs.filter((r) => r.dependsOn.includes(runId) && (r.status === 'blocked' || r.status === 'cancelled')).toArray();
  for (const d of dependents) {
    await db.runs.update(d.id, { status: 'queued', updatedAt: now() });
    await unblockDependents(d.id);
  }
}

export async function cancelRun(runId: Id) {
  requestAbort(runId);
  await db.transaction('rw', db.runs, async () => {
    const cancel = async (id: Id) => {
      const r = await db.runs.get(id);
      if (!r || ['done', 'cancelled', 'failed'].includes(r.status)) return;
      await db.runs.update(id, { status: 'cancelled', updatedAt: now(), finishedAt: now() });
      for (const d of await db.runs.filter((x) => x.dependsOn.includes(id)).toArray()) await cancel(d.id);
    };
    await cancel(runId);
  });
}

/** A model asked for paid audio processing: create the run and an approval request, and pause the model's run. */
export async function requestToolProcessing(parent: Run, req: AudioRequest, toolCallId: string) {
  const ctx = await contextFor(parent.sessionId);
  const recording = await db.entries.get(req.recordingEntryId);
  if (!recording) throw new Error('Recording not found');
  const duration = Number(recording.meta?.duration ?? 0);
  const start = req.start ?? 0;
  const end = req.end ?? duration;
  const config = resolvePipeline(ctx.settings, ctx.group, ctx.session);
  // Use the session's own choice of model for that kind of step, if it has one.
  const model =
    req.mode === 'audio'
      ? (config.steps.find((s) => s.kind === 'listen')?.model ?? ctx.settings.audioOptions[0]?.id ?? INKLING)
      : (config.steps.find((s) => s.kind === 'transcribe')?.model ?? ctx.settings.sttOptions[0]?.id ?? STT_DEFAULT);
  const run = baseRun(ctx, parent.turnId, {
    kind: 'process',
    mode: req.mode,
    model,
    trigger: 'tool',
    status: 'awaiting_approval',
    sourceRefs: [{ entryId: recording.id, start, end }],
    settings: { language: config.language, primary: false, parentRunId: parent.id },
    instructions:
      req.mode === 'audio'
        ? resolveInstructions('processing', {
            global: ctx.settings.instructions,
            group: ctx.group?.instructions,
            session: ctx.session.instructions,
            run: req.instructions,
          })
        : '',
  });
  run.estimatedCost = estimateRun(run, end - start, ctx.settings);
  await db.runs.add(run);
  await db.runs.update(parent.id, { status: 'awaiting_approval', pendingToolCallId: toolCallId, updatedAt: now() });
  await createEntry({
    sessionId: parent.sessionId,
    groupId: parent.groupId,
    turnId: parent.turnId,
    runId: parent.id,
    kind: 'approval_request',
    text: req.instructions,
    status: 'waiting',
    visibility: 'primary',
    sourceRefs: [{ entryId: recording.id, start, end }],
    meta: {
      runIds: [run.id],
      parentRunId: parent.id,
      estimate: run.estimatedCost,
      reason: 'tool',
      model,
      mode: req.mode,
      start,
      end,
      recordingTitle: recording.title,
    },
  });
}
