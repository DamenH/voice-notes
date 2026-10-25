import { bytesToBase64 } from '../audio/pcm';

/**
 * Credential policy: the OpenRouter key lives in localStorage under its own key, separate
 * from the library (IndexedDB) and never included in exports. It persists until the user
 * disconnects. OAuth-issued keys can also be revoked from the OpenRouter dashboard.
 */
const KEY = 'vn.openrouter.key';
const SOURCE = 'vn.openrouter.source';
const VERIFIER = 'vn.oauth.verifier';
const RETURN_TO = 'vn.oauth.return';
const STATE = 'vn.oauth.state';

export const OPENROUTER_ORIGIN = 'https://openrouter.ai';

type Listener = () => void;
const listeners = new Set<Listener>();

export function onCredentialsChange(fn: Listener) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

function safeGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

export function getApiKey(): string | null {
  return safeGet(KEY);
}

export function getKeySource(): 'oauth' | 'manual' | null {
  return safeGet(SOURCE) as 'oauth' | 'manual' | null;
}

export function setApiKey(key: string, source: 'oauth' | 'manual') {
  localStorage.setItem(KEY, key.trim());
  localStorage.setItem(SOURCE, source);
  listeners.forEach((fn) => fn());
}

export function disconnect() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(SOURCE);
  listeners.forEach((fn) => fn());
}

function base64url(bytes: Uint8Array) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomVerifier(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(48)));
}

export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function callbackUrl(loc: Location = location): string {
  return `${loc.origin}${loc.pathname}`;
}

export async function buildAuthUrl(verifier: string, callback: string, state: string): Promise<string> {
  const params = new URLSearchParams({
    callback_url: callback,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
    state,
    key_label: 'Voice Notes',
  });
  return `${OPENROUTER_ORIGIN}/auth?${params}`;
}

/** Start OAuth. Local work is already persisted in IndexedDB, so leaving the page is safe. */
export async function startOAuth() {
  const verifier = randomVerifier();
  const state = randomVerifier().slice(0, 24);
  // localStorage (not sessionStorage): an installed app may receive the callback in a new window.
  localStorage.setItem(VERIFIER, verifier);
  localStorage.setItem(STATE, state);
  localStorage.setItem(RETURN_TO, location.hash);
  location.assign(await buildAuthUrl(verifier, callbackUrl(), state));
}

/**
 * If this load is an OAuth callback (?code=...), exchange the code for a key and clean the URL.
 * Returns 'connected', an error message, or null when there was no callback.
 */
export async function handleOAuthCallback(): Promise<'connected' | { error: string } | null> {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (!code) return null;
  const verifier = localStorage.getItem(VERIFIER);
  const expectedState = localStorage.getItem(STATE);
  const returnTo = localStorage.getItem(RETURN_TO) ?? '';
  history.replaceState(null, '', `${location.pathname}${returnTo || location.hash}`);
  localStorage.removeItem(VERIFIER);
  localStorage.removeItem(STATE);
  localStorage.removeItem(RETURN_TO);
  if (!verifier || !expectedState || params.get('state') !== expectedState) {
    return { error: 'The sign-in could not be verified (it may have been started in another browser). Please try again.' };
  }
  try {
    const res = await fetch(`${OPENROUTER_ORIGIN}/api/v1/auth/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
    });
    if (!res.ok) return { error: `OpenRouter rejected the sign-in (${res.status}). Please try again.` };
    const { key } = (await res.json()) as { key?: string };
    if (!key) return { error: 'OpenRouter did not return a key.' };
    setApiKey(key, 'oauth');
    return 'connected';
  } catch {
    return { error: 'Could not reach OpenRouter to finish signing in. Check your connection and try again.' };
  }
}
