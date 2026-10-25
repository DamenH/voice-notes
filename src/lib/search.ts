import MiniSearch from 'minisearch';
import { db } from './db';
import type { Id, SearchRecord } from './types';

export interface SearchHit {
  entryId: Id;
  sessionId: Id;
  kind: SearchRecord['kind'];
  title: string;
  createdAt: number;
  snippet: string;
  score: number;
}

/** Search a group's material. The index is built from the persisted search records on demand. */
export async function searchGroup(groupId: Id, query: string, limit = 20): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const records = await db.searchRecords.where('groupId').equals(groupId).toArray();
  return searchRecords(records, q, limit);
}

export async function searchAll(query: string, limit = 50): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  return searchRecords(await db.searchRecords.toArray(), q, limit);
}

function searchRecords(records: SearchRecord[], q: string, limit: number): SearchHit[] {
  const index = new MiniSearch<SearchRecord>({
    fields: ['text', 'title'],
    storeFields: ['entryId', 'sessionId', 'kind', 'title', 'createdAt', 'text'],
    searchOptions: { prefix: true, fuzzy: 0.15, boost: { title: 2 }, combineWith: 'AND' },
  });
  index.addAll(records);
  let results = index.search(q);
  if (results.length === 0) results = index.search(q, { combineWith: 'OR' });
  return results.slice(0, limit).map((r) => ({
    entryId: r.entryId as string,
    sessionId: r.sessionId as string,
    kind: r.kind as SearchRecord['kind'],
    title: r.title as string,
    createdAt: r.createdAt as number,
    snippet: snippet(r.text as string, r.terms),
    score: r.score,
  }));
}

export function snippet(text: string, terms: string[], radius = 90): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t.toLowerCase());
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return text.slice(0, radius * 2).trim() + (text.length > radius * 2 ? '…' : '');
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}
