import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { searchAll, searchGroup, type SearchHit } from '../lib/search';
import { navigate } from '../app/router';
import { useDesktop } from '../app/hooks';
import { IconButton, inputClass } from '../ui/primitives';
import { Icon } from '../ui/Icon';

const KIND_LABEL: Record<string, string> = {
  recording: 'Recording',
  user_message: 'Your message',
  transcript: 'Transcript',
  audio_notes: 'Audio notes',
  inference: 'Response',
  tool_call: 'Tool result',
};

export function SearchPage({ initial }: { initial?: string }) {
  const desktop = useDesktop();
  const [q, setQ] = useState(initial ?? '');
  const [groupId, setGroupId] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const groups = useLiveQuery(() => db.groups.orderBy('name').toArray(), []) ?? [];
  const sessions = useLiveQuery(() => db.sessions.toArray(), []) ?? [];
  const titles = new Map(sessions.map((s) => [s.id, s.title]));

  useEffect(() => {
    const t = setTimeout(() => {
      void (groupId ? searchGroup(groupId, q, 50) : searchAll(q)).then(setHits);
      history.replaceState(null, '', `#/search${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    }, 150);
    return () => clearTimeout(t);
  }, [q, groupId]);

  return (
    <div className={desktop ? 'mx-auto max-w-3xl px-6 pt-6' : 'pb-10'}>
      <div className={desktop ? 'mb-4' : 'sticky top-0 z-20 flex items-center gap-1 border-b border-hairline bg-bg/90 px-2 py-2 backdrop-blur-md'} style={desktop ? undefined : { paddingTop: 'calc(8px + var(--safe-top))' }}>
        {!desktop && <IconButton icon="back" label="Back" onClick={() => history.back()} />}
        <div className="flex flex-1 gap-2">
          <label className="relative flex-1">
            <span className="sr-only">Search</span>
            <Icon name="search" size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
            <input autoFocus className={`${inputClass} pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search transcripts, notes and responses" type="search" />
          </label>
          <select className={`${inputClass} w-auto max-w-40`} value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label="Group">
            <option value="">All groups</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className={desktop ? '' : 'px-4 pt-3'}>
        {q.trim() && hits.length === 0 && <p className="py-8 text-center text-muted">No matches.</p>}
        <ul className="flex flex-col gap-2">
          {hits.map((h) => (
            <li key={h.entryId}>
              <button
                onClick={() => navigate({ name: 'session', sessionId: h.sessionId, entryId: h.entryId })}
                className="w-full rounded-xl border border-hairline bg-surface px-4 py-3 text-left hover:bg-surface-2"
              >
                <span className="mb-0.5 flex gap-2 text-[13px] text-muted">
                  <span className="font-semibold text-accent">{KIND_LABEL[h.kind] ?? h.kind}</span>
                  <span className="truncate">{titles.get(h.sessionId)}</span>
                  <span className="ml-auto shrink-0">{new Date(h.createdAt).toLocaleDateString()}</span>
                </span>
                <span className="line-clamp-3 text-[15px]">{h.snippet}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
