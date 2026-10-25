import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { createGroup, createSession, deleteGroup, renameGroup } from '../lib/library';
import type { Settings } from '../lib/types';
import { navigate } from '../app/router';
import { useDesktop, useRecorder } from '../app/hooks';
import { Icon } from '../ui/Icon';
import { Button, IconButton, Menu, confirmAction } from '../ui/primitives';
import { EditableTitle } from '../ui/EditableTitle';
import { PipelineEditor } from '../panels/PipelineEditor';
import { InstructionsEditor, VoiceEditor } from '../panels/Panels';
import { useState } from 'react';

const DEFAULT_GROUP = 'Notes';

/** Start recording right away: a new session in the most recent (or a default) group. */
export async function quickSession(groupId?: string) {
  let gid = groupId;
  if (!gid) {
    const recent = await db.sessions.orderBy('lastActivityAt').last();
    gid = recent?.groupId ?? (await db.groups.toCollection().first())?.id ?? (await createGroup(DEFAULT_GROUP)).id;
  }
  const s = await createSession(gid);
  navigate({ name: 'session', sessionId: s.id });
}

function TopBar({ title, back, actions, onRename }: { title: string; back?: () => void; actions?: React.ReactNode; onRename?: (t: string) => void }) {
  const desktop = useDesktop();
  return (
    <header
      className={desktop ? 'flex min-h-14 items-center gap-2 pt-6 pb-2' : 'sticky top-0 z-20 flex min-h-14 items-center gap-1 border-b border-hairline bg-bg/90 px-2 backdrop-blur-md'}
      style={desktop ? undefined : { paddingTop: 'var(--safe-top)' }}
    >
      {!desktop && back && <IconButton icon="back" label="Back" onClick={back} />}
      {onRename ? (
        <div className="min-w-0 flex-1">
          <EditableTitle value={title} label="Group name" onSave={onRename} className={desktop ? 'text-2xl' : 'text-[17px]'} />
        </div>
      ) : (
        <h1 className={`flex-1 truncate font-bold ${desktop ? 'text-2xl' : 'px-2 text-[17px]'}`}>{title}</h1>
      )}
      {actions}
    </header>
  );
}

export function HomePage() {
  const desktop = useDesktop();
  const groups = useLiveQuery(() => db.groups.orderBy('name').toArray(), []);
  const sessions = useLiveQuery(() => db.sessions.orderBy('lastActivityAt').reverse().toArray(), []) ?? [];
  const newGroup = async () => {
    const name = prompt('Name the group (e.g. a course, a project, a language)', '');
    if (!name?.trim()) return;
    const g = await createGroup(name.trim());
    navigate({ name: 'group', groupId: g.id });
  };
  if (groups === undefined) return null;
  return (
    <div className={desktop ? 'mx-auto max-w-3xl px-6' : 'pb-28'}>
      <TopBar
        title={desktop ? 'Voice Notes' : 'Groups'}
        actions={
          !desktop && (
            <>
              <IconButton icon="search" label="Search" onClick={() => navigate({ name: 'search' })} />
              <IconButton icon="gear" label="Settings" onClick={() => navigate({ name: 'settings' })} />
            </>
          )
        }
      />
      <div className={desktop ? 'flex flex-col gap-6 py-4' : 'flex flex-col gap-6 p-4'}>
        {groups.length === 0 ? (
          <div className="rounded-2xl border border-hairline bg-surface p-6 text-center">
            <div className="mx-auto mb-3 grid size-14 place-items-center rounded-full bg-accent-soft text-accent">
              <Icon name="mic" size={26} />
            </div>
            <p className="mb-1 text-[17px] font-semibold">Think, study and practise out loud</p>
            <p className="mb-4 text-[15px] text-muted">Record yourself; get a clean transcript, feedback on how you said it, and help working through ideas. Everything stays on this device.</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" icon="mic" onClick={() => void quickSession()}>
                Start a session
              </Button>
              <Button icon="plus" onClick={() => void newGroup()}>
                New group
              </Button>
            </div>
          </div>
        ) : (
          <>
            {desktop && (
              <div className="flex gap-2">
                <Button variant="primary" icon="mic" onClick={() => void quickSession()}>
                  New session
                </Button>
                <Button icon="plus" onClick={() => void newGroup()}>
                  New group
                </Button>
              </div>
            )}
            <section>
              <h2 className="mb-2 text-[13px] font-semibold tracking-wide text-muted uppercase">Groups</h2>
              <ul className="overflow-hidden rounded-2xl border border-hairline bg-surface">
                {groups.map((g) => {
                  const count = sessions.filter((s) => s.groupId === g.id).length;
                  return (
                    <li key={g.id} className="border-b border-hairline last:border-0">
                      <a href={`#/g/${g.id}`} className="flex min-h-14 items-center gap-3 px-4 hover:bg-surface-2">
                        <Icon name="folder" className="text-accent" />
                        <span className="flex-1 truncate text-[15px] font-semibold">{g.name}</span>
                        <span className="text-[13px] text-muted">
                          {count} session{count === 1 ? '' : 's'}
                        </span>
                        <Icon name="chevron" size={16} className="text-faint" />
                      </a>
                    </li>
                  );
                })}
              </ul>
              {!desktop && (
                <button onClick={() => void newGroup()} className="mt-2 flex min-h-11 items-center gap-2 px-2 text-[15px] font-semibold text-accent">
                  <Icon name="plus" size={18} /> New group
                </button>
              )}
            </section>
            {sessions.length > 0 && (
              <section>
                <h2 className="mb-2 text-[13px] font-semibold tracking-wide text-muted uppercase">Recent sessions</h2>
                <SessionList sessions={sessions.slice(0, 8)} groupNames={new Map(groups.map((g) => [g.id, g.name]))} />
              </section>
            )}
          </>
        )}
      </div>
      {!desktop && <QuickRecordFab />}
    </div>
  );
}

function SessionList({ sessions, groupNames }: { sessions: { id: string; title: string; groupId: string; lastActivityAt: number }[]; groupNames?: Map<string, string> }) {
  const rec = useRecorder();
  return (
    <ul className="overflow-hidden rounded-2xl border border-hairline bg-surface">
      {sessions.map((s) => (
        <li key={s.id} className="border-b border-hairline last:border-0">
          <a href={`#/s/${s.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-surface-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium">{s.title}</span>
              <span className="block truncate text-[13px] text-muted">
                {groupNames ? `${groupNames.get(s.groupId) ?? ''} · ` : ''}
                {new Date(s.lastActivityAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </span>
            </span>
            {rec.sessionId === s.id && rec.state !== 'idle' && <span className="size-2.5 rounded-full bg-rec" title="Recording" />}
            <Icon name="chevron" size={16} className="text-faint" />
          </a>
        </li>
      ))}
    </ul>
  );
}

function QuickRecordFab({ groupId }: { groupId?: string }) {
  return (
    <button
      onClick={() => void quickSession(groupId)}
      aria-label="New session and record"
      className="fixed right-5 z-30 grid size-16 place-items-center rounded-full bg-rec text-white shadow-lg transition active:scale-95"
      style={{ bottom: 'calc(20px + var(--safe-bottom))' }}
    >
      <Icon name="mic" size={28} />
    </button>
  );
}

export function GroupPage({ groupId, settings }: { groupId: string; settings: Settings }) {
  const desktop = useDesktop();
  const group = useLiveQuery(() => db.groups.get(groupId), [groupId]);
  const sessions = useLiveQuery(() => db.sessions.where('groupId').equals(groupId).reverse().sortBy('lastActivityAt'), [groupId]);
  const [tab, setTab] = useState<'sessions' | 'pipeline' | 'instructions' | 'voice'>('sessions');
  if (group === undefined || sessions === undefined) return null;
  if (!group) {
    return (
      <div className="p-8 text-center text-muted">
        This group no longer exists. <a href="#/" className="font-semibold text-accent">Go home</a>
      </div>
    );
  }
  const tabs = [
    ['sessions', 'Sessions'],
    ['pipeline', 'Pipeline'],
    ['instructions', 'Instructions'],
    ['voice', 'Voice'],
  ] as const;
  return (
    <div className={desktop ? 'mx-auto max-w-3xl px-6 pb-10' : 'pb-28'}>
      <TopBar
        title={group.name}
        onRename={(n) => void renameGroup(group.id, n)}
        back={() => navigate({ name: 'home' })}
        actions={
          <Menu
            label="Group options"
            items={[
              {
                label: 'Rename',
                icon: 'pencil',
                onSelect: () => {
                  const n = prompt('Group name', group.name);
                  if (n?.trim()) void renameGroup(group.id, n.trim());
                },
              },
              {
                label: 'Delete group',
                icon: 'trash',
                danger: true,
                onSelect: () => {
                  if (confirmAction(`Delete “${group.name}”, its ${sessions.length} sessions and all their recordings? This cannot be undone.`)) {
                    void deleteGroup(group.id).then(() => navigate({ name: 'home' }));
                  }
                },
              },
            ]}
          />
        }
      />
      <div className={desktop ? 'py-2' : 'px-4 pt-3'}>
        <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-hairline">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`min-h-10 border-b-2 px-3 text-[14px] font-semibold whitespace-nowrap ${tab === id ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-text'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'sessions' && (
          <div className="flex flex-col gap-3">
            {desktop && (
              <div>
                <Button variant="primary" icon="plus" onClick={() => void quickSession(group.id)}>
                  New session
                </Button>
              </div>
            )}
            {sessions.length === 0 ? <p className="py-6 text-center text-muted">No sessions yet. Start one to record.</p> : <SessionList sessions={sessions} />}
          </div>
        )}
        {tab === 'pipeline' && <PipelineEditor settings={settings} group={group} initialScope="group" />}
        {tab === 'instructions' && <InstructionsEditor settings={settings} group={group} scopeOverride="group" />}
        {tab === 'voice' && <VoiceEditor settings={settings} group={group} scopeOverride="group" />}
      </div>
      {!desktop && <QuickRecordFab groupId={group.id} />}
    </div>
  );
}
