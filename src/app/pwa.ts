import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const installState = {
  version: __APP_VERSION__,
  build: __BUILD_ID__,
  registration: null as ServiceWorkerRegistration | null,
  deferred: null as BeforeInstallPromptEvent | null,
  installed: typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches,
  updateReady: false,
  update: null as null | (() => Promise<void>),
};

const listeners = new Set<() => void>();
let snapshot = { canInstall: false, installed: installState.installed, updateReady: false };
function emit() {
  snapshot = { canInstall: !!installState.deferred, installed: installState.installed, updateReady: installState.updateReady };
  listeners.forEach((fn) => fn());
}

export function initPwa() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installState.deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    installState.deferred = null;
    installState.installed = true;
    emit();
  });
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    const update = registerSW({
      onNeedRefresh() {
        installState.updateReady = true;
        emit();
      },
      onRegisteredSW(_url, registration) {
        installState.registration = registration ?? null;
        // Look for a new version regularly and whenever the app comes back to the front.
        setInterval(() => void registration?.update(), 30 * 60 * 1000);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void registration?.update();
        });
      },
    });
    installState.update = () => update(true);
  }
}

/**
 * Ask the server for a newer version. Only the app code is replaced; the library,
 * settings and OpenRouter key live in IndexedDB/localStorage and are untouched.
 */
export async function checkForUpdates(): Promise<'available' | 'current' | 'unsupported'> {
  const reg = installState.registration;
  if (!reg) return 'unsupported';
  await reg.update();
  // A new worker may still be installing; give it a moment to reach "waiting".
  for (let i = 0; i < 20 && reg.installing && !reg.waiting; i++) await new Promise((r) => setTimeout(r, 250));
  if (reg.waiting) {
    installState.updateReady = true;
    emit();
    return 'available';
  }
  return 'current';
}

/** Activate a waiting update (or simply reload when there is none). */
export async function applyUpdate() {
  if (installState.updateReady && installState.update) await installState.update();
  else location.reload();
}

export async function promptInstall() {
  const d = installState.deferred;
  if (!d) return;
  await d.prompt();
  await d.userChoice;
  installState.deferred = null;
  emit();
}

export function useInstall() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => snapshot,
  );
}
