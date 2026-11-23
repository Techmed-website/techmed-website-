/**
 * One TECHMED login across techmedng.com and kairo.techmedng.com.
 *
 * Supabase keeps the session in localStorage, which is private to one origin. This storage adapter keeps it in
 * cookies scoped to `.techmedng.com` instead, so signing in (or out) on either site applies to both. The same file
 * lives in both repos (techmed-website-/web/src/lib/sharedSession.ts and KAIRO/apps/kairo/src/lib/sharedSession.ts);
 * change them together.
 *
 *  - Only on *.techmedng.com the cookie is shared; on localhost / preview URLs it stays host-only.
 *  - Large sessions are split across several cookies (browsers cap one cookie at ~4 KB).
 *  - A session already in localStorage (signed in before this change) is moved into the cookie on first read, so
 *    nobody is signed out by the switch.
 *  - Not HttpOnly: supabase-js has to read it. It carries the same token localStorage did, nothing more.
 */
const SHARED_HOST = /(^|\.)techmedng\.com$/i;
const CHUNK = 1000; // raw characters per cookie; URL-encoded this stays well under 4 KB
const MAX_AGE = 60 * 60 * 24 * 400; // browsers cap cookie lifetime at ~400 days

const hasDom = () => typeof document !== 'undefined' && typeof location !== 'undefined';
const attrs = (maxAge: number) =>
  `; Path=/; Max-Age=${maxAge}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}` +
  (SHARED_HOST.test(location.hostname) ? '; Domain=.techmedng.com' : '');

function readCookie(name: string): string | null {
  for (const part of document.cookie ? document.cookie.split('; ') : []) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) {
      try { return decodeURIComponent(part.slice(i + 1)); } catch { return null; }
    }
  }
  return null;
}
const writeCookie = (name: string, value: string) => { document.cookie = `${name}=${encodeURIComponent(value)}${attrs(MAX_AGE)}`; };
const dropCookie = (name: string) => { document.cookie = `${name}=${attrs(0)}`; };

function readCookieChunks(key: string): string | null {
  const parts: string[] = [];
  for (let i = 0; ; i++) {
    const c = readCookie(`${key}.${i}`);
    if (c === null) break;
    parts.push(c);
  }
  return parts.length ? parts.join('') : null;
}
function dropCookieChunks(key: string, from = 0) {
  for (let i = from; readCookie(`${key}.${i}`) !== null; i++) dropCookie(`${key}.${i}`);
}

let seen: string | null | undefined; // user id this page last read or wrote; lets us tell the other site's change from ours
const idIn = (raw: string | null): string | null => {
  try { return (JSON.parse(raw ?? 'null') as { user?: { id?: string } } | null)?.user?.id ?? null; } catch { return null; }
};

export const sharedSessionStorage = {
  getItem(key: string): string | null {
    if (!hasDom()) return null;
    const shared = readCookieChunks(key);
    if (shared !== null) return shared;
    try { // signed in before the switch: carry the old localStorage session over
      const legacy = localStorage.getItem(key);
      if (legacy !== null) { this.setItem(key, legacy); return legacy; }
    } catch { /* storage blocked */ }
    return null;
  },
  setItem(key: string, value: string): void {
    if (!hasDom()) return;
    const n = Math.max(1, Math.ceil(value.length / CHUNK));
    for (let i = 0; i < n; i++) writeCookie(`${key}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    dropCookieChunks(key, n);
    if (!key.endsWith('-code-verifier')) seen = idIn(value);
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
  removeItem(key: string): void {
    if (!hasDom()) return;
    dropCookieChunks(key);
    if (!key.endsWith('-code-verifier')) seen = null;
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

/**
 * Cookies change silently when the other site signs in or out. When this tab comes back into view, compare the
 * stored session with what this page last saw and reload if they differ, so both sites agree.
 */
export function watchSharedSession(key: string): void {
  if (!hasDom()) return;
  if (seen === undefined) seen = idIn(sharedSessionStorage.getItem(key));
  const check = () => {
    if (document.visibilityState !== 'visible') return;
    const now = idIn(readCookieChunks(key));
    if (now !== seen) { seen = now; location.reload(); }
  };
  document.addEventListener('visibilitychange', check);
  window.addEventListener('focus', check);
}
