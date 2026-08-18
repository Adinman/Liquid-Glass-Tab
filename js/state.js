// Settings state: load, patch, persist, notify.
import { DEFAULTS, ENGINES } from './config.js';
import { store } from './util.js';
import { putBlob, WALLPAPER_IMAGE_KEY } from './media.js';

const KEY = 'settings';
const listeners = new Set();

export let S = structuredClone(DEFAULTS);

/* ---------------- persistence ----------------
   Writes are coalesced. Every control writes the whole settings object, and
   the sliders fire on a 40 ms debounce, so dragging one for three seconds used
   to issue ~75 separate chrome.storage.local.set calls — each one serialising
   and writing the entire object to disk. Measured, a write carrying a
   wallpaper cost 11.4 ms against 0.1 ms without one.

   S is updated synchronously, so reads never see stale data; only the trip to
   disk is deferred. MAX_WAIT stops a continuous stream of changes from
   deferring the write forever. */
const COALESCE_MS = 60;
const MAX_WAIT_MS = 600;

let flushTimer = 0;
let pendingSince = 0;
let pending = null;          // { promise, resolve } shared by every waiter

function persistSoon() {
  if (!pending) {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    pending = { promise, resolve };
    pendingSince = Date.now();
  }
  clearTimeout(flushTimer);
  const waited = Date.now() - pendingSince;
  flushTimer = setTimeout(flushNow, Math.max(0, Math.min(COALESCE_MS, MAX_WAIT_MS - waited)));
  return pending.promise;
}

/** Write immediately, and resolve anyone waiting on the coalesced write. */
export async function flushNow() {
  clearTimeout(flushTimer);
  flushTimer = 0;
  const waiter = pending;
  pending = null;
  try { await store.set(KEY, S); }
  finally { waiter?.resolve(); }
}

// A tab being hidden or torn down must not take an unwritten change with it.
if (typeof document !== 'undefined') {
  addEventListener('pagehide', () => { if (pending) flushNow(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && pending) flushNow();
  });
}

/* ---------------- load ---------------- */

/** Shallow-merge stored values over defaults so new versions pick up new keys. */
export async function loadSettings() {
  const saved = await store.get(KEY, {});
  // Sanitised on the way in as well as on import: stored settings may predate
  // the import validation below, so a file imported by an older build could
  // otherwise still be sitting in storage.
  S = sanitize({ ...structuredClone(DEFAULTS), ...saved });
  // widgets is a nested map; merge per-widget so new widgets appear
  S.widgets = { ...structuredClone(DEFAULTS.widgets), ...S.widgets };
  // 'enlarge' was folded into 'pop'; don't strand anyone who had it selected.
  if (S.dockHover === 'enlarge') S.dockHover = 'magnify';
  // 'city' was the wrong end of the privacy scale — it kept the most
  // identifying part. Anyone on it wanted less detail, not more.
  if (S.weatherPrivacy === 'city') S.weatherPrivacy = 'country';
  await dropRemovedKeys();
  await migrateWallpaperImage();
  return S;
}

/** Settings survive a spread over DEFAULTS even when the key no longer exists,
 *  so removing a feature leaves its data behind. That matters for `vtApiKey`
 *  in particular: it is a credential, and with the virus checker gone nothing
 *  redacts it any more, so it would start turning up in settings exports. */
async function dropRemovedKeys() {
  let changed = false;
  if ('vtApiKey' in S) { delete S.vtApiKey; changed = true; }
  if (S.widgets && 'virustotal' in S.widgets) { delete S.widgets.virustotal; changed = true; }
  if (changed) await flushNow();
}

/** Uploaded wallpapers used to live in the settings object as base64 data
 *  URLs. Move any leftover into IndexedDB and leave the marker behind. Runs
 *  once — afterwards `wallpaperCustom` is 'local' and this is a no-op. */
async function migrateWallpaperImage() {
  const cur = S.wallpaperCustom;
  if (typeof cur !== 'string' || !cur.startsWith('data:')) return;
  try {
    const blob = await (await fetch(cur)).blob();
    await putBlob(WALLPAPER_IMAGE_KEY, blob);
    S.wallpaperCustom = 'local';
    await flushNow();
  } catch {
    // Undecodable leftover: drop it rather than keep re-attempting the
    // migration, and every tab paying for the string, on every load.
    S.wallpaperCustom = '';
    await flushNow();
  }
}

/* ---------------- mutate ---------------- */

export function set(patch, { silent = false } = {}) {
  Object.assign(S, patch);
  const written = persistSoon();
  if (!silent) emit(Object.keys(patch));
  return written;
}

export function setWidget(id, patch) {
  S.widgets[id] = { ...(S.widgets[id] || {}), ...patch };
  const written = persistSoon();
  emit(['widgets']);
  return written;
}

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(keys) { for (const fn of listeners) fn(keys, S); }

export async function resetAll() {
  S = structuredClone(DEFAULTS);
  await flushNow();
  emit(['*']);
}

/* ---------------- backup ----------------
   Any credential listed here is withheld from an export and cannot be
   overwritten by an import. An export is a file people pass between machines,
   attach to bug reports and drop in shared folders, so a key in it leaks.

   The list is empty at the moment, and that is correct rather than an
   oversight: Spotify's tokens live under their own storage key and were never
   part of settings, and its client ID is public by design under PKCE. Add any
   future API key here. */
const SECRET_KEYS = [];

export function exportSettings() {
  const safe = { ...S };
  const withheld = [];
  for (const k of SECRET_KEYS) {
    if (safe[k]) { withheld.push(k); }
    delete safe[k];
  }
  return JSON.stringify({
    __liquidGlassTab: 1,
    exportedAt: new Date().toISOString(),
    ...(withheld.length ? { __withheld: withheld } : {}),
    settings: safe,
  }, null, 2);
}

const isHttpURL = u => {
  try { return /^https?:$/.test(new URL(String(u)).protocol); } catch { return false; }
};

/** A settings file is something people download, email, and copy between
 *  machines, so it is untrusted input. Most keys are harmless — a bad number
 *  just looks wrong — but two reach further than the UI: `feeds` becomes a
 *  network request, and `wallpaperCustom` becomes a CSS url(). Both are pinned
 *  to http(s) here rather than trusted and checked later. */
function sanitize(s) {
  if (Array.isArray(s.feeds)) {
    s.feeds = s.feeds
      .filter(f => f && typeof f === 'object' && isHttpURL(f.url))
      .map(f => ({
        id: String(f.id ?? 'c' + Date.now()),
        name: String(f.name ?? 'Feed').slice(0, 80),
        url: String(f.url),
        on: !!f.on,
      }));
  } else {
    s.feeds = structuredClone(DEFAULTS.feeds);
  }

  const wp = s.wallpaperCustom;
  if (typeof wp !== 'string' || !(wp === '' || wp === 'local' || wp.startsWith('data:') || isHttpURL(wp))) {
    s.wallpaperCustom = '';
  }
  // Same for the video, which becomes a <video src>.
  const vid = s.wallpaperVideo;
  if (typeof vid !== 'string' || !(vid === '' || vid === 'local' || isHttpURL(vid))) {
    s.wallpaperVideo = '';
  }

  if (!Array.isArray(s.spaces)) s.spaces = [];
  s.spaces = s.spaces
    .filter(x => x && typeof x === 'object' && x.id != null)
    // `tool` is dropped rather than carried: it only ever marked a virus-checker
    // homescreen, and removing that feature turns those back into ordinary ones.
    .map(x => ({
      id: String(x.id), name: String(x.name ?? 'Home').slice(0, 60),
      folderId: String(x.folderId ?? '1'),
    }));

  // Search engines are looked up as ENGINES[id].url with no guard at the call
  // sites, so an id that isn't in the table throws on every submit and leaves
  // the search bar permanently broken. Two ways to get one: an imported
  // settings file, and renaming an engine key in a future version while a
  // stored value still points at the old name — the same shape as the
  // dockHover and weatherPrivacy migrations above.
  if (!ENGINES[s.searchEngine]) s.searchEngine = DEFAULTS.searchEngine;
  // '' is meaningful here: it means "use whichever engine is normally selected".
  if (s.searchIncognitoEngine && !ENGINES[s.searchIncognitoEngine]) s.searchIncognitoEngine = '';

  if (typeof s.widgets !== 'object' || s.widgets === null) s.widgets = {};
  return s;
}

export async function importSettings(json) {
  const parsed = JSON.parse(json);
  const incoming = parsed.settings || parsed;
  if (typeof incoming !== 'object' || incoming === null) throw new Error('Not a settings file');
  // An import must not be able to overwrite a key it never carried — in
  // particular it must not blank out a credential it was never given.
  const keep = Object.fromEntries(SECRET_KEYS.map(k => [k, S[k]]));
  S = sanitize({ ...structuredClone(DEFAULTS), ...incoming, ...keep });
  S.widgets = { ...structuredClone(DEFAULTS.widgets), ...S.widgets };
  await migrateWallpaperImage();
  await flushNow();
  emit(['*']);
}
