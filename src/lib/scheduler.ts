import { db, getSettings } from './db';
import { now } from './ids';
import { createEntry } from './library';
import { OpenRouterError, friendlyError } from './openrouter/client';
import { executeProcessRun, RunPaused } from './processing';
import { executeInferRun } from './inference';
import { onSchedulerSignal } from './scheduler-signal';
import type { Run } from './types';

const MAX_CONCURRENT = 2;
const active = new Map<string, AbortController>();
let started = false;
let ticking = false;
let again = false;

export function abortRun(runId: string) {
  active.get(runId)?.abort();
}

export function isActive(runId: string) {
  return active.has(runId);
}

/**
 * Runs left mid-flight by a reload or crash. Processing segments that were being
 * requested might have been charged, so they are marked uncertain and the run fails
 * until the user explicitly retries. Interrupted inference is treated the same way.
 */
export async function recoverRuns() {
  const running = await db.runs.where('status').equals('running').toArray();
  for (const run of running) {
    if (active.has(run.id)) continue;
    const uncertain = await db.segments
      .where('runId')
      .equals(run.id)
      .filter((s) => s.status === 'requesting')
      .modify({ status: 'uncertain' });
    const paid = run.kind === 'infer' || uncertain > 0;
    await db.runs.update(run.id, {
      status: paid ? 'failed' : 'queued',
      error: paid ? 'Interrupted while a paid request was in progress; it may already have been charged. Retry to send it again.' : undefined,
      updatedAt: now(),
    });
  }
}

export function startScheduler() {
  if (started) return;
  started = true;
  onSchedulerSignal(() => void tick());
  window.addEventListener('online', () => void resumeWaiting());
  void recoverRuns().then(() => (navigator.onLine ? resumeWaiting() : tick()));
}

async function resumeWaiting() {
  await db.runs.where('status').equals('waiting_network').modify({ status: 'queued' });
  void tick();
}

async function tick() {
  if (ticking) {
    again = true;
    return;
  }
  ticking = true;
  try {
    do {
      again = false;
      await pickRuns();
    } while (again);
  } finally {
    ticking = false;
  }
}

async function pickRuns() {
  const queued = await db.runs.where('status').equals('queued').sortBy('createdAt');
  for (const run of queued) {
    if (active.size >= MAX_CONCURRENT) return;
    if (active.has(run.id)) continue;
    const deps = (await db.runs.bulkGet(run.dependsOn)).filter((d): d is Run => !!d);
    const failedDep = deps.find((d) => d.status === 'failed' || d.status === 'cancelled' || d.status === 'blocked');
    // A model waiting on its own processing request resumes either way and reports the outcome.
    if (failedDep && !run.pendingToolCallId) {
      await db.runs.update(run.id, { status: 'blocked', error: `Waiting for a failed step: ${failedDep.mode}`, updatedAt: now() });
      continue;
    }
    if (deps.some((d) => d.status !== 'done' && !(run.pendingToolCallId && (d.status === 'failed' || d.status === 'cancelled')))) continue;
    if (!navigator.onLine) {
      await db.runs.update(run.id, { status: 'waiting_network', updatedAt: now() });
      continue;
    }
    void execute(run);
  }
}

async function execute(run: Run) {
  const controller = new AbortController();
  active.set(run.id, controller);
  await db.runs.update(run.id, { status: 'running', startedAt: run.startedAt ?? now(), error: undefined, updatedAt: now() });
  try {
    const settings = await getSettings();
    if (run.kind === 'process') await executeProcessRun(run, settings.segmentSeconds, controller.signal);
    else await executeInferRun(run, settings, controller.signal);
    await db.runs.update(run.id, { status: 'done', finishedAt: now(), updatedAt: now() });
  } catch (e) {
    if (e instanceof RunPaused) {
      // Keep any status already set (e.g. awaiting_approval from a tool request).
      const current = await db.runs.get(run.id);
      if (current?.status === 'running') await db.runs.update(run.id, { status: e.status, updatedAt: now() });
    } else if (controller.signal.aborted || (e instanceof OpenRouterError && e.kind === 'cancelled')) {
      await db.runs.update(run.id, { status: 'cancelled', finishedAt: now(), updatedAt: now() });
      await markOutputs(run.id, 'cancelled');
    } else {
      const message = friendlyError(e);
      await db.runs.update(run.id, { status: 'failed', error: message, finishedAt: now(), updatedAt: now() });
      await markOutputs(run.id, 'failed');
      // Failures stay visible in the timeline until resolved.
      await createEntry({
        sessionId: run.sessionId,
        groupId: run.groupId,
        turnId: run.turnId,
        runId: run.id,
        kind: 'error',
        text: message,
        status: 'failed',
        visibility: 'primary',
        meta: { runId: run.id, errorKind: e instanceof OpenRouterError ? e.kind : 'other' },
      });
      // Steps that depend on this one wait until it is retried.
      await db.runs
        .filter((r) => r.dependsOn.includes(run.id) && r.status === 'queued' && !r.pendingToolCallId)
        .modify({ status: 'blocked', error: 'Waiting for a failed step' });
    }
  } finally {
    active.delete(run.id);
    void tick();
  }
}

async function markOutputs(runId: string, status: 'failed' | 'cancelled') {
  await db.entries
    .where('runId')
    .equals(runId)
    .filter((e) => e.status === 'running')
    .modify({ status });
}
