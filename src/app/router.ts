import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'group'; groupId: string }
  | { name: 'session'; sessionId: string; entryId?: string }
  | { name: 'settings'; section?: string }
  | { name: 'search'; q?: string };

export function parseHash(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query);
  if (parts[0] === 'g' && parts[1]) return { name: 'group', groupId: parts[1] };
  if (parts[0] === 's' && parts[1]) return { name: 'session', sessionId: parts[1], entryId: params.get('e') ?? undefined };
  if (parts[0] === 'settings') return { name: 'settings', section: parts[1] };
  if (parts[0] === 'search') return { name: 'search', q: params.get('q') ?? undefined };
  return { name: 'home' };
}

export function href(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/';
    case 'group':
      return `#/g/${route.groupId}`;
    case 'session':
      return `#/s/${route.sessionId}${route.entryId ? `?e=${route.entryId}` : ''}`;
    case 'settings':
      return `#/settings${route.section ? `/${route.section}` : ''}`;
    case 'search':
      return `#/search${route.q ? `?q=${encodeURIComponent(route.q)}` : ''}`;
  }
}

export function navigate(route: Route, { replace = false } = {}) {
  const next = href(route);
  if (replace) history.replaceState(null, '', next);
  else location.hash = next;
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

function subscribe(fn: () => void) {
  window.addEventListener('hashchange', fn);
  return () => window.removeEventListener('hashchange', fn);
}

let cachedHash = '';
let cachedRoute: Route = { name: 'home' };

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => {
    if (location.hash !== cachedHash) {
      cachedHash = location.hash;
      cachedRoute = parseHash(cachedHash);
    }
    return cachedRoute;
  });
}
