import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { createGroup, createSession } from '../lib/library';
import type { Group, Session } from '../lib/types';
import { useSessionActions } from '../session/SessionActions';
import { navigate, useRoute } from './router';
import { useRecorder } from './hooks';
import { Icon } from '../ui/Icon';
import { IconButton, Menu } from '../ui/primitives';

/** Desktop navigation: groups with their sessions. Collapses to an icon rail on short landscape screens. */
export function Sidebar({ rail }: { rail: boolean }) {
  const route = useRoute();
  const groups = useLiveQuery(() => db.groups.orderBy('name').toArray(), []) ?? [];
  const sessions = useLiveQuery(() => db.sessions.orderBy('lastActivityAt').reverse().toArray(), []) ?? [];
  const current = route.name === 'session' ? sessions.find((s) => s.id === route.sessionId) : undefined;
  const activeGroup = route.name === 'group' ? route.groupId : current?.groupId;

  const newGroup = async () => {
    const name = prompt('Name the group', 'New group');
    if (!name?.trim()) return;
    const g = await createGroup(name.trim());
    navigate({ name: 'group', groupId: g.id });
  };

  if (rail) {
    return (
      <nav aria-label="Main" className="wco-pad flex h-full w-[var(--rail-width)] flex-col items-center gap-1 border-r border-hairline py-2" style={{ paddingLeft: 'var(--safe-left)' }}>
        <RailLink href="#/" icon="folder" label="Groups" active={route.name === 'home' || route.name === 'group'} />
        <RailLink href="#/search" icon="search" label="Search" active={route.name === 'search'} />
        <span className="flex-1" />
        <RailLink href="#/settings" icon="gear" label="Settings" active={route.name === 'settings'} />
      </nav>
    );
  }

  return (
    <nav aria-label="Main" className="wco-pad flex h-full w-[var(--sidebar-width)] flex-col border-r border-hairline" style={{ paddingLeft: 'var(--safe-left)' }}>
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <span className="grid size-8 place-items-center rounded-lg bg-accent text-accent-text">
          <Icon name="mic" size={18} />
        </span>
        <a href="#/" className="flex-1 text-[16px] font-bold">
          Voice Notes
        </a>
        <IconButton icon="search" label="Search" onClick={() => navigate({ name: 'search' })} className={route.name === 'search' ? 'text-accent' : ''} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {groups.map((g) => (
          <GroupItem key={g.id} group={g} sessions={sessions.filter((s) => s.groupId === g.id)} open={g.id === activeGroup} activeSession={current?.id} />
        ))}
        <button onClick={() => void newGroup()} className="mt-1 flex min-h-9 w-full items-center gap-2 rounded-lg px-3 text-[14px] font-medium text-muted hover:bg-surface-2 hover:text-text">
          <Icon name="plus" size={16} /> New group
        </button>
      </div>
      <div className="border-t border-hairline p-2" style={{ paddingBottom: 'calc(8px + var(--safe-bottom))' }}>
        <a
          href="#/settings"
          aria-current={route.name === 'settings' ? 'page' : undefined}
          className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-[14px] font-semibold text-muted hover:bg-surface-2 hover:text-text aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent"
        >
          <Icon name="gear" size={18} /> Settings
        </a>
      </div>
    </nav>
  );
}

function RailLink({ href, icon, label, active }: { href: string; icon: 'folder' | 'search' | 'gear'; label: string; active: boolean }) {
  return (
    <a
      href={href}
      aria-current={active ? 'page' : undefined}
      className="flex w-14 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] font-semibold text-muted aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent"
    >
      <Icon name={icon} size={20} />
      {label}
    </a>
  );
}

function GroupItem({ group, sessions, open, activeSession }: { group: Group; sessions: Session[]; open: boolean; activeSession?: string }) {
  const [expanded, setExpanded] = useState(open);
  const rec = useRecorder();
  const show = expanded || open;
  const newSession = async () => {
    const s = await createSession(group.id);
    navigate({ name: 'session', sessionId: s.id });
  };
  return (
    <div className="mb-0.5">
      <div className="group flex items-center">
        <button onClick={() => setExpanded(!show)} aria-expanded={show} aria-label={`${show ? 'Collapse' : 'Expand'} ${group.name}`} className="grid size-8 place-items-center rounded text-faint hover:text-text">
          <Icon name={show ? 'down' : 'chevron'} size={14} />
        </button>
        <a href={`#/g/${group.id}`} className="min-h-9 flex-1 truncate rounded-lg px-1 py-2 text-[14px] font-semibold hover:text-accent">
          {group.name}
        </a>
        <button onClick={() => void newSession()} aria-label={`New session in ${group.name}`} title="New session" className="grid size-8 place-items-center rounded text-faint opacity-0 group-hover:opacity-100 hover:text-text focus:opacity-100">
          <Icon name="plus" size={16} />
        </button>
      </div>
      {show && (
        <ul className="ml-4 border-l border-hairline pl-2">
          {sessions.length === 0 && <li className="px-2 py-1 text-[13px] text-faint">No sessions yet</li>}
          {sessions.map((s) => (
            <SidebarSession key={s.id} session={s} active={s.id === activeSession} recording={rec.sessionId === s.id && rec.state !== 'idle'} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SidebarSession({ session: s, active, recording }: { session: Session; active: boolean; recording: boolean }) {
  const actions = useSessionActions(s);
  return (
    <li className="group/row relative flex items-center">
      <a
        href={`#/s/${s.id}`}
        aria-current={active ? 'page' : undefined}
        className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-lg py-1 pr-9 pl-2 text-[14px] text-muted hover:bg-surface-2 hover:text-text aria-[current=page]:bg-accent-soft aria-[current=page]:font-semibold aria-[current=page]:text-accent"
      >
        <span className="flex-1 truncate">{s.title}</span>
        {recording && <span className="size-2 rounded-full bg-rec" title="Recording" />}
      </a>
      <span className="absolute right-0 opacity-0 transition group-hover/row:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
        <Menu items={actions.items} label={`Actions for ${s.title}`} className="!size-8" />
      </span>
      {actions.dialog}
    </li>
  );
}
