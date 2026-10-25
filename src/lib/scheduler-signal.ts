const listeners = new Set<() => void>();

export function onSchedulerSignal(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Tell the scheduler that runs may be ready. */
export function notifyScheduler() {
  listeners.forEach((fn) => fn());
}
