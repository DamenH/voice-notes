import { useEffect, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSettings } from '../lib/db';
import { defaultSettings } from '../lib/defaults';
import { recorder } from '../lib/audio/recorder';
import { getApiKey, onCredentialsChange } from '../lib/openrouter/auth';
import { loadCatalog, type CatalogModel } from '../lib/openrouter/catalog';
import type { Settings } from '../lib/types';

const fallback = defaultSettings();

export function useSettings(): Settings {
  return useLiveQuery(() => getSettings(), [], fallback);
}

export function useRecorder() {
  return useSyncExternalStore(
    (fn) => recorder.subscribe(fn),
    () => recorder.snapshot,
  );
}

export function useOnline() {
  return useSyncExternalStore(
    (fn) => {
      window.addEventListener('online', fn);
      window.addEventListener('offline', fn);
      return () => {
        window.removeEventListener('online', fn);
        window.removeEventListener('offline', fn);
      };
    },
    () => navigator.onLine,
  );
}

export function useApiKey() {
  return useSyncExternalStore(onCredentialsChange, getApiKey);
}

export function useMedia(query: string) {
  return useSyncExternalStore(
    (fn) => {
      const m = matchMedia(query);
      m.addEventListener('change', fn);
      return () => m.removeEventListener('change', fn);
    },
    () => matchMedia(query).matches,
  );
}

/** Desktop layout: wide screens, or short landscape phones (which use the rail). */
export function useDesktop() {
  return useMedia('(min-width: 900px), (orientation: landscape) and (max-height: 500px)');
}

let catalogCache: CatalogModel[] = [];
const catalogListeners = new Set<() => void>();

export function refreshCatalog(force = false) {
  return loadCatalog(force).then((m) => {
    catalogCache = m;
    catalogListeners.forEach((fn) => fn());
    return m;
  });
}

export function useCatalog(): CatalogModel[] {
  return useSyncExternalStore(
    (fn) => {
      catalogListeners.add(fn);
      return () => void catalogListeners.delete(fn);
    },
    () => catalogCache,
  );
}

export function useNow(intervalMs: number, active = true) {
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setT(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, active]);
  return t;
}

export { db };
