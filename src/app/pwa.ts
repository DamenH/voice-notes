import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const installState = {
  version: __APP_VERSION__,
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
    });
    installState.update = () => update(true);
  }
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
