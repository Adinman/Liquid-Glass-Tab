// Settings state: load, patch, persist, notify.
import { DEFAULTS, WIDGET_SIZE, PHOTOS, CLIPS, ARCADE, bundled } from './config.js';
import { ACTIONS, isBindingShape } from './keys.js';
import { LOCALES } from './locales/index.js';
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
  // Before dropRemovedKeys, which is what deletes pongBest.
  migratePongBest(saved);
  migrateGame2Levels(saved);
  migrateGame3Modes(saved);
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
  // The interactive backgrounds are gone. Their settings would otherwise sit in
  // storage forever and turn up in every settings export.
  for (const k of ['fxScene', 'fxLights', 'fxSwitch', 'fxLightLift', 'pongBest',
                   'arcadeLevel']) {
    if (k in S) { delete S[k]; changed = true; }
  }
  if (changed) await flushNow();
}

/** Pong became Game 3, and its record moved into the arcade map. Somebody's
 *  all-time rally is the one thing that version had worth keeping, so it is
 *  carried across rather than dropped on the floor. Runs once — afterwards
 *  `pongBest` is gone and this is a no-op. */
function migratePongBest(saved) {
  const old = Number(saved?.pongBest);
  if (!Number.isFinite(old) || old <= 0) return;
  if (S.arcadeBest?.['game3.ai']) return;       // already carried, or beaten since
  S.arcadeBest = { ...(S.arcadeBest || {}), 'game3.ai': Math.min(1e6, old) };
}

/** Game 2's levels were briefly named after Game 1's — easy/medium/hard, which
 *  put the list in descending order of map size. They are small/medium/large
 *  now, and the two ends swap: the old "easy" was the biggest board and the old
 *  "hard" the smallest. Renaming the keys rather than letting sanitize drop
 *  them keeps anyone's records from evaporating over a rename.
 *
 *  Safe to delete once no stored settings can still carry the old ids. */
function migrateGame2Levels(saved) {
  const src = saved?.arcadeBest;
  if (!src || typeof src !== 'object') return;
  const moved = { 'game2.easy': 'game2.large', 'game2.hard': 'game2.small' };
  const out = { ...(S.arcadeBest || {}) };
  let changed = false;
  for (const [from, to] of Object.entries(moved)) {
    const v = Number(src[from]);
    if (!Number.isFinite(v) || v <= 0 || out[to]) continue;   // never overwrite a real one
    out[to] = Math.min(1e6, v);
    changed = true;
  }
  if (changed) S.arcadeBest = out;
  // The stored level itself may also name a retired id.
  const lvl = saved?.arcadeLevels?.game2;
  const swap = { easy: 'large', hard: 'small' }[lvl];
  if (swap) S.arcadeLevels = { ...(S.arcadeLevels || {}), game2: swap };
}

/** Game 3 gained a second opponent, so its record split in two: the bare
 *  `game3` key became `game3.ai`. Everything anyone has ever scored was against
 *  the computer, so it all belongs on that side of the split.
 *
 *  Safe to delete once no stored settings can still carry the bare key. */
function migrateGame3Modes(saved) {
  const old = Number(saved?.arcadeBest?.game3);
  if (!Number.isFinite(old) || old <= 0) return;
  if (S.arcadeBest?.['game3.ai']) return;      // already carried, or beaten since
  S.arcadeBest = { ...(S.arcadeBest || {}), 'game3.ai': Math.min(1e6, old) };
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

/* ---------------- arcade scores ----------------
   One place, because the rule is easy to get wrong in three different ways.

   Read live, never snapshotted at the start of a game. A copy taken then goes
   stale and there is nothing to correct it, so a tab that opened a game while
   the record was 0 still believed that after another tab had set it to 30 — and
   a run of 1 beat its own stale copy and wrote 1 over the real record.

   Direction matters too: Game 1 scores a time, where lower is better, and the
   other two count upward. A single `>` would quietly refuse to record any
   Minesweeper win after the first. */
export const bestScore = id => {
  const n = Number(S.arcadeBest?.[id]);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Record a run. Returns true when it was a new record. */
export function recordScore(id, value, lowerIsBetter = false) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return false;
  const prev = bestScore(id);
  const better = prev === 0 || (lowerIsBetter ? v < prev : v > prev);
  if (!better) return false;
  // A fresh object rather than a mutation: `set` shallow-assigns, so patching
  // the existing one in place would leave S and the patch pointing at the same
  // object and defeat the change comparison other tabs do.
  set({ arcadeBest: { ...(S.arcadeBest || {}), [id]: v } });
  return true;
}

/** The level a game is set to, resolved live and always a real level. Games
 *  call this rather than reading S themselves, so "unknown id falls back to the
 *  middle one" is written once. */
export function levelFor(gameId) {
  const g = ARCADE.find(x => x.id === gameId);
  if (!g?.levels?.length) return null;
  const want = S.arcadeLevels?.[gameId];
  return g.levels.find(l => l.id === want)
    || g.levels[Math.floor(g.levels.length / 2)];
}

/** Store a game's level. A fresh object rather than a mutation, for the same
 *  reason recordScore builds one — `set` shallow-assigns, so patching in place
 *  would leave S and the patch pointing at the same object and defeat the
 *  change comparison other tabs do. */
export function setLevel(gameId, levelId) {
  const g = ARCADE.find(x => x.id === gameId);
  if (!g?.levels?.some(l => l.id === levelId)) return false;
  set({ arcadeLevels: { ...(S.arcadeLevels || {}), [gameId]: levelId } });
  return true;
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

/** A finite number inside [min,max], or the fallback.
 *
 *  Deliberately not just Number(v): null, '', false and [] all coerce to 0,
 *  which is finite, so a widget arriving with `size: null` would be clamped to
 *  the minimum — a 50% widget — rather than left at the default. Absent and
 *  malformed have to mean "use the default", not "use the smallest legal
 *  value". Only a real number or a non-blank numeric string counts. */
const inRange = (v, min, max, fallback) => {
  const n = typeof v === 'number' ? v
    : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Exported so the settings fields can test a pasted URL with the exact rule
 *  that decides whether it survives being stored. They used to disagree: the
 *  Video URL box accepted anything at all and the Image URL box accepted a
 *  scheme-less `example.com/clip.jpg`, and then this wiped both on the next
 *  load — so a typo looked accepted, showed nothing, and vanished on reload.
 *  One rule, used in both places, cannot drift apart again. */
export const isHttpURL = u => {
  try { return /^https?:$/.test(new URL(String(u)).protocol); } catch { return false; }
};

/** A settings file is something people download, email, and copy between
 *  machines, so it is untrusted input. Most keys are harmless — a bad number
 *  just looks wrong — but two reach further than the UI: `feeds` becomes a
 *  network request, and `wallpaperCustom` becomes a CSS url(). Both are pinned
 *  to http(s) here rather than trusted and checked later. */
function sanitize(s) {
  if (Array.isArray(s.feeds)) {
    // Ids have to be unique: the news cache is keyed by them, so two feeds
    // sharing one means each shows whatever the other fetched last. The old
    // fallback was `'c' + Date.now()`, which is the SAME value for every feed
    // in the array — a single import missing ids collapsed them all onto one
    // cache entry. An imported file can also simply repeat an id outright.
    const usedIds = new Set();
    s.feeds = s.feeds
      .filter(f => f && typeof f === 'object' && isHttpURL(f.url))
      .map((f, i) => {
        let id = String(f.id ?? `c${i}`);
        while (usedIds.has(id)) id += `_${i}`;
        usedIds.add(id);
        return {
          id,
          name: String(f.name ?? 'Feed').slice(0, 80),
          url: String(f.url),
          on: !!f.on,
        };
      });
  } else {
    s.feeds = structuredClone(DEFAULTS.feeds);
  }

  // `bg:<id>` is a packaged background. It is accepted only when the id is
  // actually in the registry: the id reaches a file path, so an unchecked one
  // is a path traversal dressed up as a settings value.
  const wp = s.wallpaperCustom;
  if (typeof wp !== 'string' || !(wp === '' || wp === 'local' || bundled(PHOTOS, wp)
      || wp.startsWith('data:') || isHttpURL(wp))) {
    s.wallpaperCustom = '';
  }
  // Same for the video, which becomes a <video src>.
  const vid = s.wallpaperVideo;
  if (typeof vid !== 'string' || !(vid === '' || vid === 'local' || bundled(CLIPS, vid)
      || isHttpURL(vid))) {
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

  // The language id reaches a dynamic import path, so it is checked against the
  // registry rather than trusted — an imported settings file must not be able
  // to name a module.
  if (s.language !== 'auto' && !LOCALES.some(l => l.id === s.language)) {
    s.language = 'auto';
  }

  s.lowPerf = !!s.lowPerf;

  // Bookmark shortcuts. An imported settings file is untrusted and this URL
  // becomes a navigation, so it is pinned to http(s) exactly as the wallpaper
  // and the feeds are. A binding that cannot be pressed is dropped rather than
  // kept, and duplicates are dropped rather than left to shadow each other —
  // whichever came first wins, which is also what the drawer shows.
  {
    const src = Array.isArray(s.bookmarkKeys) ? s.bookmarkKeys : [];
    const taken = new Set();
    const out = [];
    for (const b of src) {
      if (!b || typeof b !== 'object') continue;
      // The URL is the row. Without one there is nothing to open and nothing
      // to show, so that is the only thing worth refusing outright.
      if (!isHttpURL(b.url)) continue;
      // An empty key is legal and means "added, waiting for a key" — which is
      // what the drawer creates the moment you press Add, and what it shows as
      // —. Refusing it here deleted the row out from under anyone who added a
      // bookmark and then opened another tab before binding it.
      const key = isBindingShape(b.key) ? String(b.key) : '';
      // Only real bindings are deduped. Several rows can be waiting for a key
      // at once, and they are not duplicates of each other.
      if (key && taken.has(key)) continue;
      if (key) taken.add(key);
      out.push({
        key,
        url: String(b.url),
        title: String(b.title ?? '').slice(0, 90),
      });
      if (out.length >= 40) break;
    }
    s.bookmarkKeys = out;
  }

  // Shortcut overrides. Same closed-key-set treatment as the arcade records
  // above, and for the same reason: an imported settings file is untrusted, so
  // only ids that are really in ACTIONS survive and '__proto__' and friends
  // have nowhere to land. Values are checked for shape too — the string is
  // compared against live keypresses, and one that could never match is worse
  // than no override at all, because it silently unbinds the action.
  {
    const src = (s.keys && typeof s.keys === 'object' && !Array.isArray(s.keys)) ? s.keys : {};
    const out = {};
    for (const a of ACTIONS) {
      const v = src[a.id];
      // Only overrides are stored, so a value equal to the default is dropped
      // rather than frozen — otherwise changing a default in a later version
      // would leave everyone pinned to the old one.
      if (isBindingShape(v) && v !== a.def) out[a.id] = v;
    }
    s.keys = out;
  }

  // searchEngine, searchIncognito and searchIncognitoEngine used to be checked
  // here. They are gone rather than migrated: nothing reads them now, so an old
  // stored value or an imported settings file naming a dead engine is inert.

  // Widget entries are the third thing an import reaches past the UI: `size`
  // becomes a CSS zoom on the panel, so an unchecked value is either NaN (the
  // widget vanishes) or big enough to cover the screen — including the
  // settings button that would undo it. x/y are percentages of the viewport;
  // clampPanel would eventually drag a wild one back on screen, but there is
  // no reason to store it in the first place.
  // Anything but 'window' means fixed, so a junk import cannot invent a mode.
  if (s.widgetScaleMode !== 'window' && s.widgetScaleMode !== 'fixed') {
    s.widgetScaleMode = DEFAULTS.widgetScaleMode;
  }

  // Arcade records. Only ids that are actually in ARCADE survive — the map is
  // read with a bare lookup all over the settings drawer, and an imported
  // settings file is untrusted input, so '__proto__' and friends have no
  // business being in there. Values are clamped to something a real run could
  // produce rather than merely to "a number".
  {
    const src = (s.arcadeBest && typeof s.arcadeBest === 'object'
      && !Array.isArray(s.arcadeBest)) ? s.arcadeBest : {};
    const out = {};
    for (const g of ARCADE) {
      // A game with levels keeps one record per level under `id.level`, and
      // never a bare `id` — so the set of legal keys stays closed and an
      // imported file cannot invent one.
      const keys = g.levels ? g.levels.map(l => `${g.id}.${l.id}`) : [g.id];
      for (const k of keys) {
        const n = inRange(src[k], 0, 1e6, 0);
        if (n > 0) out[k] = n;
      }
    }
    s.arcadeBest = out;
  }
  {
    // Only games that have levels, and only levels they actually have. The map
    // is read with a bare lookup, and an imported settings file is untrusted.
    const src = (s.arcadeLevels && typeof s.arcadeLevels === 'object'
      && !Array.isArray(s.arcadeLevels)) ? s.arcadeLevels : {};
    const out = {};
    for (const g of ARCADE) {
      if (!g.levels?.length) continue;
      const want = src[g.id];
      if (g.levels.some(l => l.id === want)) out[g.id] = want;
    }
    s.arcadeLevels = out;
  }
  // The settings panel position reaches inline left/top/height. A ratio outside
  // 0..1, or a negative height, would park the panel off-screen with no way to
  // drag it back, so a bad one is dropped rather than clamped into something
  // that looks deliberate.
  const sp = s.settingsPos;
  if (sp && typeof sp === 'object' && !Array.isArray(sp)) {
    // No height requirement: the panel takes its height from the stylesheet
    // now, and entries written since then do not carry one at all. Demanding
    // it here would quietly wipe every position on load.
    // A pixel offset has no natural ceiling the way a fraction does, so
    // "finite" was the only test it ever got — and an imported file could park
    // the settings drawer at y: 900000, where it is off screen with no control
    // left to drag it back. The bound is deliberately generous: it is here to
    // reject nonsense, not to second-guess a large monitor.
    const sane = n => Number.isFinite(n) && Math.abs(n) <= 20000;
    const okX = Number.isFinite(sp.fx) ? (sp.fx >= 0 && sp.fx <= 1) : sane(sp.x);
    if (!okX || !sane(sp.y)) s.settingsPos = null;
  } else if (sp) {
    s.settingsPos = null;
  }

  if (typeof s.widgets !== 'object' || s.widgets === null) {
    s.widgets = {};
  } else {
    for (const [id, w] of Object.entries(s.widgets)) {
      if (!w || typeof w !== 'object' || Array.isArray(w)) { delete s.widgets[id]; continue; }
      const d = DEFAULTS.widgets[id] || {};
      s.widgets[id] = {
        on: !!w.on,
        x: inRange(w.x, 0, 100, d.x ?? 10),
        y: inRange(w.y, 0, 100, d.y ?? 10),
        size: inRange(w.size, WIDGET_SIZE.min, WIDGET_SIZE.max, WIDGET_SIZE.default),
        // The viewport a drag was made in. Absent means "never moved", which
        // resolves against CANON instead. A junk value would put the whole
        // anchored layout at the wrong scale, so it is bounded to sizes a real
        // window can be rather than merely to "a number".
        vw: inRange(w.vw, 240, 16384, 0) || undefined,
        vh: inRange(w.vh, 240, 16384, 0) || undefined,
        anchor: w.anchor === 'center' ? 'center' : null,
        placed: !!w.placed,
      };
    }
  }
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
  // The same two passes loadSettings runs, and for the same reason: a settings
  // file is a backup, so the one being imported is very often older than the
  // build importing it. Without these, importing a file written before the
  // arcade existed carried a Pong record that nothing would ever read again and
  // re-seeded every removed fx key into storage, where they would then turn up
  // in the next export and be passed on to whoever got that file.
  migratePongBest(incoming);
  migrateGame2Levels(incoming);
  migrateGame3Modes(incoming);
  await dropRemovedKeys();
  await migrateWallpaperImage();
  await flushNow();
  emit(['*']);
}
