import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { recorder } from '../lib/audio/recorder';
import { useDesktop, useMedia, useRecorder, useSettings } from './hooks';
import { useRoute } from './router';
import { closePanel, inspector, useStore } from './stores';
import { Sidebar } from './Sidebar';
import { useInstall, installState } from './pwa';
import { SessionView } from '../session/SessionView';
import { HomePage, GroupPage } from '../pages/Lists';
import { SearchPage } from '../pages/SearchPage';
import { SettingsPage } from '../pages/SettingsPage';
import { PanelBody, panelTitle } from '../panels/Panels';
import { Dialog, IconButton, Toasts, Button } from '../ui/primitives';
import { Icon } from '../ui/Icon';

export function App() {
  const route = useRoute();
  const settings = useSettings();
  const desktop = useDesktop();
  const rail = useMedia('(orientation: landscape) and (max-height: 500px)');
  const panel = useStore(inspector);
  const sessionId = route.name === 'session' ? route.sessionId : undefined;
  const session = useLiveQuery(() => (sessionId ? db.sessions.get(sessionId) : undefined), [sessionId]);
  const group = useLiveQuery(() => (session ? db.groups.get(session.groupId) : undefined), [session?.groupId]);

  // Panels belong to the session they were opened from.
  useEffect(() => closePanel(), [sessionId]);
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && recorder.onVisible();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.name, sessionId, route.name === 'group' ? route.groupId : '']);

  const page =
    route.name === 'session' ? (
      <SessionView key={route.sessionId} sessionId={route.sessionId} focusEntryId={route.entryId} settings={settings} />
    ) : route.name === 'group' ? (
      <GroupPage groupId={route.groupId} settings={settings} />
    ) : route.name === 'settings' ? (
      <SettingsPage section={route.section} settings={settings} />
    ) : route.name === 'search' ? (
      <SearchPage initial={route.q} />
    ) : (
      <HomePage />
    );

  const panelBody = panel && <PanelBody panel={panel} settings={settings} session={session ?? undefined} group={group ?? undefined} />;

  return (
    <>
      <div className="titlebar-drag" aria-hidden />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <RecordingBanner />
      <UpdateBanner />
      {desktop ? (
        <div className="flex h-dvh overflow-hidden">
          <Sidebar rail={rail} />
          <main id="main" tabIndex={-1} className={`wco-pad min-w-0 flex-1 outline-none ${route.name === 'session' ? 'h-full' : 'overflow-y-auto'}`}>
            {page}
          </main>
          {panel && (
            <aside aria-label={panelTitle(panel)} className="wco-pad animate-fade flex h-full w-[var(--inspector-width)] shrink-0 flex-col border-l border-hairline bg-surface" style={{ paddingRight: 'var(--safe-right)' }}>
              <div className="flex min-h-14 items-center gap-2 border-b border-hairline px-4">
                <h2 className="flex-1 text-[15px] font-bold">{panelTitle(panel)}</h2>
                <IconButton icon="close" label="Close panel" onClick={closePanel} className="-mr-2" />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{panelBody}</div>
            </aside>
          )}
        </div>
      ) : (
        <main id="main" tabIndex={-1} className="min-h-dvh outline-none" style={{ paddingLeft: 'var(--safe-left)', paddingRight: 'var(--safe-right)' }}>
          {page}
          {panel && (
            <Dialog title={panelTitle(panel)} onClose={closePanel}>
              {panelBody}
            </Dialog>
          )}
        </main>
      )}
      <Toasts />
    </>
  );
}

/** While recording, other screens show a bar that leads back to the recording session. */
function RecordingBanner() {
  const rec = useRecorder();
  const route = useRoute();
  if (rec.state === 'idle' || (route.name === 'session' && route.sessionId === rec.sessionId)) return null;
  return (
    <a
      href={`#/s/${rec.sessionId}`}
      className="fixed top-[calc(8px+var(--safe-top))] left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full bg-rec px-4 py-2 text-[14px] font-semibold text-white shadow-lg"
    >
      <span className="size-2 rounded-full bg-white" style={{ animation: 'pulse-rec 1.6s infinite' }} />
      Recording — return to session
    </a>
  );
}

function UpdateBanner() {
  const { updateReady } = useInstall();
  const rec = useRecorder();
  if (!updateReady) return null;
  return (
    <div className="fixed right-4 bottom-[calc(96px+var(--safe-bottom))] z-40 flex items-center gap-3 rounded-2xl border border-hairline bg-surface px-4 py-3 shadow-xl desk:bottom-6">
      <Icon name="download" size={18} className="text-accent" />
      <span className="text-[14px]">A new version is ready. Your data stays.</span>
      <Button small variant="primary" disabled={rec.state !== 'idle'} title={rec.state !== 'idle' ? 'Finish recording first' : undefined} onClick={() => void installState.update?.()}>
        Reload
      </Button>
    </div>
  );
}
