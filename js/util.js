// Small shared helpers. No dependencies, no remote code.

/** Search, using whatever engine the user has set as their default in Chrome.
 *
 *  There is deliberately no way for this extension to override that or even to
 *  read it, and that is the whole point. A new tab page that also decides where
 *  your searches go is two products in one: the Web Store treats overriding the
 *  new tab and changing the search provider as separate purposes, and rejected
 *  1.3.0 for doing both. CGT used to carry its own table of six engines and
 *  navigate straight to the chosen one's results page, so someone whose Chrome
 *  was set to Kagi or Ecosia still landed on Google.
 *
 *  chrome.search.query is the sanctioned way to have a search box at all: hand
 *  Chrome the text and let Chrome route it. Engine choice did not disappear —
 *  it moved to Chrome's own settings, where it belonged. */
export async function webSearch(text, disposition = 'CURRENT_TAB') {
  const q = String(text ?? '').trim();
  if (!q) return false;
  try {
    // Throws synchronously if the API is missing, which is why the whole call
    // is inside the try rather than only the await.
    await chrome.search.query({ text: q, disposition });
    return true;
  } catch {
    toast('Could not run that search.');
    return false;
  }
}

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** el('div', {class:'x', onclick:fn, html:'…'}, child, child) */
export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid instanceof Node ? kid : document.createTextNode(kid));
  }
  return n;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const pad2   = n => String(n).padStart(2, '0');
export const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function debounce(fn, ms = 250) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ---------------- storage ---------------- */
export const store = {
  async get(key, fallback = null) {
    const r = await chrome.storage.local.get(key);
    return key in r ? r[key] : fallback;
  },
  async set(key, val) { await chrome.storage.local.set({ [key]: val }); },
  async getMany(keys) { return chrome.storage.local.get(keys); },
  async remove(key) { await chrome.storage.local.remove(key); },
};

/* ---------------- cached network ----------------
   Every remote read goes through here so a widget never blocks on the
   network twice for the same data, and stale data still renders on a
   failed refresh. Returns {data, stale, error}. */
export async function cachedFetch(key, url, opts = {}) {
  const { ttl = 15 * 60e3, parse = 'json', init, transform } = opts;
  const cacheKey = 'cache:' + key;
  const now = Date.now();
  const cached = await store.get(cacheKey);

  if (cached && now - cached.at < ttl) return { data: cached.data, stale: false };

  try {
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let data = parse === 'json' ? await res.json() : await res.text();
    if (transform) data = transform(data);
    await store.set(cacheKey, { at: now, data });
    return { data, stale: false };
  } catch (err) {
    if (cached) return { data: cached.data, stale: true, error: err };
    return { data: null, stale: true, error: err };
  }
}

export async function dropCache(prefix = '') {
  const all = await chrome.storage.local.get(null);
  const kill = Object.keys(all).filter(k => k.startsWith('cache:' + prefix));
  if (kill.length) await chrome.storage.local.remove(kill);
}

/* ---------------- formatting ---------------- */
export function relTime(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function msToClock(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(t / 60), s = t % 60;
  return `${m}:${pad2(s)}`;
}

export function faviconURL(pageUrl, size = 64) {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl);
  u.searchParams.set('size', String(size));
  return u.toString();
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

// Site icons live in js/icons.js — see iconElement().

/* ---------------- misc ---------------- */
export function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------------- incognito ----------------
   Opens a URL in a private window. Chromium calls it different things —
   Incognito in Chrome, InPrivate in Edge, Private in Brave and Opera — but it
   is the same API in all of them, so this works everywhere the extension runs.

   No extension can launch a *different* browser: there is no API for starting
   another application, and browsers deliberately don't offer one.

   Two ways this legitimately fails, and neither should throw at the caller:
   an enterprise policy can disable incognito entirely, and the user can have
   incognito turned off for the browser. Both surface as a rejected promise or
   a lastError, so they are reported as a toast rather than a console trace. */
export async function openIncognito(url) {
  // No URL opens an empty private window; anything else has to be http(s),
  // for the same reason the dock and palette refuse other schemes.
  let safe = null;
  if (url != null) {
    try { safe = /^https?:$/.test(new URL(url).protocol) ? url : null; } catch { safe = null; }
    if (!safe) { toast('That isn’t a web address, so it can’t be opened.'); return false; }
  }

  try {
    await chrome.windows.create({ ...(safe ? { url: safe } : {}), incognito: true, focused: true });
    return true;
  } catch (e) {
    const msg = String(e?.message || e);
    toast(/disabled|not allowed|incognito/i.test(msg)
      ? 'Private browsing is turned off in this browser.'
      : 'Could not open a private window.');
    return false;
  }
}

/** Hat-and-glasses glyph, as inline SVG rather than an emoji: it has to take
 *  `currentColor` so it can dim at rest and light up in the accent colour when
 *  the toggle is armed, which a colour emoji cannot do. */
export function incognitoIcon(size = 15) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of [
    'M2.5 12.5h19',                          // brim
    'M6 12.5c.4-3.4 1.2-5.5 2.8-5.5h6.4c1.6 0 2.4 2.1 2.8 5.5',   // crown
    'M9.4 17.2h5.2',                         // bridge
  ]) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  for (const cx of [6.6, 17.4]) {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', String(cx));
    c.setAttribute('cy', '17.2');
    c.setAttribute('r', '2.8');
    svg.append(c);
  }
  return svg;
}

/** Deterministic 0..1 noise — used by the simulated visualiser so the same
 *  moment of the same track always looks the same. */
export function hashNoise(x) {
  const s = Math.sin(x * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function smoothNoise(x) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return hashNoise(i) * (1 - u) + hashNoise(i + 1) * u;
}
