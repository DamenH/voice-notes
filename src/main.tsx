import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './app/App';
import { refreshCatalog } from './app/hooks';
import { initPwa } from './app/pwa';
import { applyTheme } from './pages/SettingsPage';
import { handleOAuthCallback } from './lib/openrouter/auth';
import { recoverInterruptedRecordings } from './lib/audio/recorder';
import { startScheduler } from './lib/scheduler';
import { toast } from './ui/primitives';

async function boot() {
  applyTheme();
  initPwa();
  // Finish an OAuth redirect before rendering routes (it restores the previous location).
  const oauth = await handleOAuthCallback();
  await recoverInterruptedRecordings();
  startScheduler();
  void refreshCatalog();
  void navigator.storage?.persisted?.().then((p) => {
    // Ask once for persistent storage after the user has some data; installed apps usually get it.
    if (!p) void navigator.storage.persist?.();
  });
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  if (oauth === 'connected') toast('Connected to OpenRouter');
  else if (oauth) toast(oauth.error, 'error');
}

void boot();
