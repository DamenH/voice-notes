const listeners = new Set<() => void>();
let abortHandler: (runId: string) => void = () => {};

export function onSchedulerSignal(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Tell the scheduler that runs may be ready. */
export function notifyScheduler() {
  listeners.forEach((fn) => fn());
}

/** The scheduler registers how to abort an in-flight run (kept here to avoid an import cycle). */
export function setAbortHandler(fn: (runId: string) => void) {
  abortHandler = fn;
}

export function requestAbort(runId: string) {
  abortHandler(runId);
}
