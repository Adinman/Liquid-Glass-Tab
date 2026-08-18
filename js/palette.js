// Ctrl/Cmd+K command palette: bookmarks, history, open tabs, and actions.
import { $, el, hostOf, clamp, debounce, toast, openIncognito } from './util.js';
import { iconElement } from './icons.js';
import { ENGINES } from './config.js';
import { S, set } from './state.js';
import { attachSheen } from './theme.js';

let results = [], sel = 0, open = false;

// Order matters: an empty query shows only the first six, so anything meant to
// be reachable without typing has to live near the top.
const COMMANDS = [
  { tag: 'cmd', icon: '⚙', title: 'Open settings', run: () => window.dispatchEvent(new Event('lgt:settings')) },
  { tag: 'cmd', icon: '◐', title: 'Open a private window', run: () => openIncognito() },
  { tag: 'cmd', icon: '✥', title: 'Toggle layout edit mode', run: () => window.dispatchEvent(new Event('lgt:edit')) },
  { tag: 'cmd', icon: '🎨', title: 'Cycle wallpaper', run: () => window.dispatchEvent(new Event('lgt:cycle-wallpaper')) },
  { tag: 'cmd', icon: '☀', title: 'Toggle light / dark', run: async () => {
      await set({ scheme: S.scheme === 'dark' ? 'light' : 'dark' }); } },
  { tag: 'cmd', icon: '🔄', title: 'Reload all widget data', run: () => window.dispatchEvent(new Event('lgt:reload')) },
  { tag: 'cmd', icon: '🗑', title: 'Clear cached weather / news', run: () => window.dispatchEvent(new Event('lgt:clearcache')) },
  { tag: 'cmd', icon: '🎧', title: 'Open Spotify web player', run: () => location.href = 'https://open.spotify.com' },
  { tag: 'cmd', icon: '⭐', title: 'Open bookmark manager', run: () => chrome.tabs.update({ url: 'chrome://bookmarks' }) },
  { tag: 'cmd', icon: '⬇', title: 'Open downloads', run: () => chrome.tabs.update({ url: 'chrome://downloads' }) },
  { tag: 'cmd', icon: '🧩', title: 'Open extensions', run: () => chrome.tabs.update({ url: 'chrome://extensions' }) },
  { tag: 'cmd', icon: '🕓', title: 'Open history', run: () => chrome.tabs.update({ url: 'chrome://history' }) },
];

export function initPalette() {
  const overlay = $('#palette-overlay');
  const input = $('#palette-input');
  const list = $('#palette-results');
  attachSheen($('#palette'));

  overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
  input.addEventListener('input', () => search(input.value));
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); activate(results[sel], e.ctrlKey || e.metaKey); }
    else if (e.key === 'Escape') close();
  });

  window.addEventListener('lgt:palette', () => (open ? close() : show()));

  function show() {
    open = true;
    overlay.hidden = false;
    input.value = '';
    search('');
    input.focus();
  }
  function close() { open = false; overlay.hidden = true; }

  const search = debounce(async q => {
    q = q.trim();
    const out = [];

    if (!q) {
      out.push(...COMMANDS.slice(0, 6));
    } else {
      const lower = q.toLowerCase();
      out.push(...COMMANDS.filter(c => c.title.toLowerCase().includes(lower)).slice(0, 4));

      const [bms, tabs, hist] = await Promise.all([
        chrome.bookmarks.search({ query: q }).catch(() => []),
        chrome.tabs.query({}).catch(() => []),
        chrome.history.search({ text: q, maxResults: 8 }).catch(() => []),
      ]);

      out.push(...tabs.filter(t => (t.title + t.url).toLowerCase().includes(lower)).slice(0, 4)
        .map(t => ({ tag: 'tab', title: t.title || t.url, url: t.url, tabId: t.id, windowId: t.windowId })));
      out.push(...bms.filter(b => b.url).slice(0, 6)
        .map(b => ({ tag: 'bookmark', title: b.title || hostOf(b.url), url: b.url })));
      out.push(...hist.filter(h => h.url).slice(0, 6)
        .map(h => ({ tag: 'history', title: h.title || hostOf(h.url), url: h.url })));

      const engineId = ENGINES[S.searchIncognitoEngine] ? S.searchIncognitoEngine : S.searchEngine;
      out.push({
        tag: 'search', icon: '⌕',
        title: `Search ${ENGINES[S.searchEngine].name} for “${q}”`,
        url: ENGINES[S.searchEngine].url.replace('%s', encodeURIComponent(q)),
      });
      out.push({
        tag: 'private', icon: '◐',
        title: `Search ${ENGINES[engineId].name} for “${q}” privately`,
        url: ENGINES[engineId].url.replace('%s', encodeURIComponent(q)),
        incognito: true,
      });
    }

    results = out;
    sel = 0;
    paint();
  }, 110);

  // Rebuilding the list is separate from moving the selection. They used to be
  // the same function, so every mouseenter tore down and rebuilt every row —
  // including a fresh iconElement per row, meaning a new <img> and a new
  // favicon request. Sweeping the cursor down a 20-row list rebuilt it 20
  // times and created 400 images. Measured, the two paths differ by ~100x.
  let nodes = [];

  function paint() {
    list.innerHTML = '';
    nodes = [];
    if (!results.length) {
      list.append(el('div', { class: 'p-item muted', text: 'No matches' }));
      return;
    }
    results.forEach((r, i) => {
      const node = el('div', {
        class: 'p-item',
        onmousedown: e => { e.preventDefault(); activate(r, e.ctrlKey || e.metaKey); },
        onmouseenter: () => select(i),
      },
        r.url && !r.icon ? iconElement(r.url, 32, r.title, 'pi letter') : el('div', { class: 'pi', text: r.icon || '›' }),
        el('div', { class: 'pt', text: r.title }),
        r.url ? el('div', { class: 'pu', text: hostOf(r.url) }) : '',
        el('div', { class: 'tag', text: r.tag }));
      nodes.push(node);
      list.append(node);
    });
    applySelection(true);
  }

  /** Move the highlight. Touches two class lists and nothing else. */
  function select(i) {
    if (i === sel) return;
    sel = i;
    applySelection(false);
  }

  function applySelection(fromPaint) {
    for (let i = 0; i < nodes.length; i++) nodes[i].classList.toggle('sel', i === sel);
    // Only chase the selection into view for keyboard moves; doing it on hover
    // would yank the list out from under the cursor.
    if (!fromPaint) return;
    nodes[sel]?.scrollIntoView({ block: 'nearest' });
  }

  function move(delta) {
    if (!nodes.length) return;
    sel = clamp(sel + delta, 0, results.length - 1);
    applySelection(false);
    nodes[sel]?.scrollIntoView({ block: 'nearest' });
  }

  /** Bookmarks and history can hold `javascript:` bookmarklets and `data:`
   *  URLs. This page runs at the extension's own origin with access to the
   *  bookmarks, history and tabs APIs, so navigating it to one of those is not
   *  something to allow — the dock has always guarded this, and the palette
   *  reaches exactly the same URLs. */
  const httpOnly = url => {
    try { return /^https?:$/.test(new URL(url).protocol) ? url : null; }
    catch { return null; }
  };

  /** `privately` is set by Ctrl/Cmd+Enter, so any bookmark, history entry or
   *  search in the list can be opened in a private window without leaving the
   *  keyboard. Commands and "switch to tab" ignore it — there is nothing to
   *  open privately in either case. */
  async function activate(r, privately = false) {
    if (!r) return;
    close();
    if (r.run) return r.run();
    if (r.tag === 'tab') {
      await chrome.tabs.update(r.tabId, { active: true });
      await chrome.windows.update(r.windowId, { focused: true });
      return;
    }
    if (!r.url) return;
    const safe = httpOnly(r.url);
    if (!safe) return toast('That entry isn’t a web address, so it can’t be opened here.');
    if (privately || r.incognito) { openIncognito(safe); return; }
    location.href = safe;
  }
}
