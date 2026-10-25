import 'fake-indexeddb/auto';
import { afterEach, beforeEach } from 'vitest';
import { VoiceNotesDB, useDatabase } from '../lib/db';

// Minimal browser globals for library code running under Node.
const g = globalThis as Record<string, unknown>;
if (typeof g.window === 'undefined') {
  g.window = { addEventListener() {}, removeEventListener() {} };
}
if (typeof g.location === 'undefined') {
  g.location = { origin: 'http://localhost:5173', pathname: '/', search: '', hash: '' };
}
const store = new Map<string, string>();
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });

let n = 0;
beforeEach(() => {
  useDatabase(new VoiceNotesDB(`test-${n++}`));
  store.clear();
});
afterEach(() => {
  (navigator as { onLine: boolean }).onLine = true;
});
