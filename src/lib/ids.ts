export function newId(prefix = ''): string {
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  return prefix ? `${prefix}_${id}` : id;
}

let last = 0;

/** Strictly increasing timestamp (ms), so records created together keep a stable order. */
export function now(): number {
  last = Math.max(Date.now(), last + 1);
  return last;
}
