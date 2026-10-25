import { useEffect, useMemo, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { deleteSession, renameSession } from '../lib/library';
import { resolveTts } from '../lib/instructions';
import { speechPlayer } from '../lib/tts';
import { friendlyError } from '../lib/openrouter/client';
import type { Group, Session, Settings } from '../lib/types';
import { navigate } from '../app/router';
import { openPanel } from '../app/stores';
import { useApiKey, useDesktop, useOnline } from '../app/hooks';
import { Icon } from '../ui/Icon';
import { IconButton, Menu, confirmAction, toast } from '../ui/primitives';
import { Dock } from './Dock';
import { Timeline, buildTurns } from './Timeline';

export function SessionView({ sessionId, focusEntryId, settings }: { sessionId: string; focusEntryId?: string; settings: Settings }) {
  const session = useLiveQuery(() => db.sessions.get(sessionId), [sessionId]);
  const group = useLiveQuery(() => (session ? db.groups.get(session.groupId) : undefined), [session?.groupId]);
  const entries = useLiveQuery(() => db.entries.where('sessionId').equals(sessionId).sortBy('createdAt'), [sessionId]);
  const runs = useLiveQuery(() => db.runs.where('sessionId').equals(sessionId).toArray(), [sessionId]);
  const turns = useMemo(() => buildTurns(entries ?? [], runs ?? []), [entries, runs]);
  const desktop = useDesktop();
  const scroller = useRef<HTMLDivElement>(null);

  useAutoSpeak(session, group, settings, entries);

  // Keep the newest material in view as it arrives, unless the user scrolled up to read.
  const pinned = useRef(true);
  useEffect(() => {
    const el = desktop ? scroller.current : document.scrollingElement;
    if (!el || focusEntryId) return;
    if (pinned.current) el.scrollTop = el.scrollHeight;
  }, [entries, desktop, focusEntryId]);
  useEffect(() => {
    const el = desktop ? scroller.current : window;
    if (!el) return;
    const onScroll = () => {
      const s = desktop ? scroller.current! : document.scrollingElement!;
      pinned.current = s.scrollHeight - s.scrollTop - s.clientHeight < 120;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [desktop]);

  if (session === undefined && entries === undefined) return null;
  if (!session) {
    return (
      <div className="grid h-full place-items-center p-8 text-center text-muted">
        <div>
          <p className="mb-3">This session no longer exists.</p>
          <a href="#/" className="font-semibold text-accent">
            Go home
          </a>
        </div>
      </div>
    );
  }

  const header = <SessionHeader session={session} group={group} settings={settings} />;
  const body =
    turns.length === 0 ? (
      <EmptySession />
    ) : (
      <Timeline turns={turns} settings={settings} session={session} group={group} focusEntryId={focusEntryId} />
    );
  const dock = <Dock session={session} group={group} settings={settings} />;

  if (desktop) {
    return (
      <div className="flex h-full min-w-0 flex-col">
        <div className="border-b border-hairline px-6">{header}</div>
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-6 py-6 [container-type:inline-size]">
          <div className="mx-auto max-w-3xl">{body}</div>
        </div>
        <div className="px-6 pt-2 pb-4">
          <div className="mx-auto max-w-3xl">{dock}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="sticky top-0 z-20 border-b border-hairline bg-bg/90 px-2 backdrop-blur-md" style={{ paddingTop: 'var(--safe-top)' }}>
        {header}
      </div>
      <div className="flex-1 px-4 pt-4 pb-6">{body}</div>
      <div className="sticky bottom-0 z-20 border-t border-hairline bg-bg/95 px-3 pt-2 backdrop-blur-md" style={{ paddingBottom: 'calc(8px + var(--safe-bottom))' }}>
        {dock}
      </div>
    </div>
  );
}

function SessionHeader({ session, group, settings }: { session: Session; group?: Group; settings: Settings }) {
  const desktop = useDesktop();
  const online = useOnline();
  const key = useApiKey();
  const showDetails = session.showDetails ?? settings.showDetails;
  return (
    <header className="flex min-h-14 items-center gap-1">
      {!desktop && <IconButton icon="back" label="Back to group" onClick={() => navigate(group ? { name: 'group', groupId: group.id } : { name: 'home' })} />}
      <div className="min-w-0 flex-1 px-1">
        <h1 className="truncate text-[17px] font-bold desk:text-xl">{session.title}</h1>
        {group && (
          <a href={`#/g/${group.id}`} className="block truncate text-[13px] text-muted hover:text-text">
            {group.name}
          </a>
        )}
      </div>
      {!online && (
        <span className="flex items-center gap-1 rounded-full bg-warn-soft px-2 py-1 text-xs font-semibold text-warn" title="Recording and browsing work offline. Model steps wait for a connection.">
          <Icon name="wifiOff" size={14} /> Offline
        </span>
      )}
      {!key && (
        <a href="#/settings/connection" className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent">
          Connect
        </a>
      )}
      <IconButton icon="sliders" label="Instructions" onClick={() => openPanel({ kind: 'instructions' })} />
      <Menu
        label="Session options"
        items={[
          { label: showDetails ? 'Collapse processing details' : 'Show processing details', icon: 'panel', onSelect: () => void db.sessions.update(session.id, { showDetails: !showDetails }) },
          { label: 'Pipeline', icon: 'bolt', onSelect: () => openPanel({ kind: 'pipeline' }) },
          { label: 'Read-aloud voice', icon: 'speaker', onSelect: () => openPanel({ kind: 'voice' }) },
          {
            label: 'Rename',
            icon: 'pencil',
            onSelect: () => {
              const t = prompt('Session name', session.title);
              if (t?.trim()) void renameSession(session.id, t.trim());
            },
          },
          {
            label: 'Delete session',
            icon: 'trash',
            danger: true,
            onSelect: () => {
              if (!confirmAction(`Delete “${session.title}” and all its recordings? This cannot be undone.`)) return;
              void deleteSession(session.id).then(() => navigate(group ? { name: 'group', groupId: group.id } : { name: 'home' }));
            },
          },
        ]}
      />
    </header>
  );
}

function EmptySession() {
  return (
    <div className="mx-auto mt-[12vh] max-w-sm text-center text-muted">
      <div className="mx-auto mb-4 grid size-16 place-items-center rounded-full bg-accent-soft text-accent">
        <Icon name="mic" size={28} />
      </div>
      <p className="mb-1 text-[17px] font-semibold text-text">Think out loud</p>
      <p className="text-[15px]">Press the record button and talk. When you stop, the recording is processed automatically — change what happens with the pipeline below.</p>
    </div>
  );
}

/** Speak new responses aloud when the session (or its group/default) asks for it. */
function useAutoSpeak(session: Session | undefined, group: Group | undefined, settings: Settings, entries: { id: string; kind: string; status: string; createdAt: number }[] | undefined) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!entries || !session) return;
    const done = entries.filter((e) => e.kind === 'inference' && e.status === 'done');
    if (seen.current === null) {
      seen.current = new Set(done.map((e) => e.id));
      return;
    }
    const tts = resolveTts(settings, group, session);
    for (const e of done) {
      if (seen.current.has(e.id)) continue;
      seen.current.add(e.id);
      if (tts.autoSpeak) {
        void db.entries.get(e.id).then((full) => full && speechPlayer.play(full, tts).catch((err) => toast(friendlyError(err), 'error')));
      }
    }
  }, [entries, session, group, settings]);
}
