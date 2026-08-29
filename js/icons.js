// Sharp site icons.
//
// Chrome's favicon API only returns what it cached while browsing — usually
// 16x16. Drawn at ~54px in the dock that's a 3x upscale: blurry, and the
// interpolation muddies the colour. So we optionally resolve a higher
// resolution icon and remember which source won for that domain.
//
// Measured across real sites, no single provider is best: Google returns
// 128px for youtube/wikipedia/figma but 18px for news.ycombinator.com, where
// DuckDuckGo returns 256px. So we probe both and keep the larger.

import { el, store, hostOf, faviconURL } from './util.js';

const CACHE_TTL = 30 * 864e5;      // 30 days
const inFlight = new Map();        // host -> Promise, dedupes concurrent probes

let mode = 'auto';                 // auto | chrome | sharp
export function setIconMode(m) { mode = m || 'auto'; }

// Order matters only for ties: the sort below is stable, so an equally sized
// icon from the site itself beats one from a third party.
// Measured sizes (2026-08): github 120/32/32, wikipedia 160/128/48,
// news.ycombinator 180/18/256, figma -/128/64, open.spotify -/48/32.
const providers = host => [
  `https://${host}/apple-touch-icon.png`,
  `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(host)}`,
  `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`,
];

/** Load an image just to learn its intrinsic size. Resolves null on failure. */
function measure(url) {
  return new Promise(resolve => {
    const probe = new Image();
    let done = false;
    let timer = 0;
    const finish = v => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    probe.onload = () => finish({ url, w: probe.naturalWidth || 0 });
    probe.onerror = () => finish(null);
    probe.src = url;
    // Cleared on the way out: an icon that answers immediately otherwise leaves
    // a 6s timer holding its closure, once per host looked up.
    timer = setTimeout(() => finish(null), 6000);
  });
}

/** Best available icon URL for a host, cached in local storage per domain. */
async function resolveSharp(host) {
  if (inFlight.has(host)) return inFlight.get(host);

  const job = (async () => {
    const key = 'icon:' + host;
    const hit = await store.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL) return hit.url || null;

    const found = (await Promise.all(providers(host).map(measure))).filter(Boolean);
    const best = found.sort((a, b) => b.w - a.w)[0] || null;
    await store.set(key, { url: best?.url || '', w: best?.w || 0, at: Date.now() });
    return best?.url || null;
  })();

  inFlight.set(host, job);
  try { return await job; } finally { inFlight.delete(host); }
}

/**
 * An <img> for a site icon.
 *  - paints immediately from Chrome's local favicon store (no network)
 *  - upgrades to a sharper source when Chrome's copy is too small
 *  - degrades to a lettered tile if everything fails
 * `displayPx` is the largest size it will be drawn at, in device pixels.
 */
export function iconElement(pageUrl, displayPx = 64, label = '', fallbackClass = 'glyph letter') {
  const want = Math.round(displayPx);
  const localSrc = faviconURL(pageUrl, Math.min(128, Math.max(32, want)));
  const img = el('img', { src: localSrc, alt: '', draggable: 'false' });
  let host = null;
  try { host = new URL(pageUrl).hostname; } catch { /* letter fallback covers it */ }

  const toLetter = () => {
    const name = (label || hostOf(pageUrl) || '?').trim();
    img.replaceWith(el('div', { class: fallbackClass, text: (name[0] || '?').toUpperCase() }));
  };

  async function upgrade() {
    if (!host || mode === 'chrome') return;
    const sharp = await resolveSharp(host);
    // Only swap if it beats what we're already showing.
    if (sharp && (img.dataset.sharp !== '1') && (!img.naturalWidth || sharp !== img.src)) {
      img.dataset.sharp = '1';
      img.src = sharp;
    }
  }

  img.addEventListener('load', () => {
    if (img.dataset.sharp === '1') return;            // already upgraded
    if (mode === 'sharp') { upgrade(); return; }
    if (mode === 'auto' && img.naturalWidth && img.naturalWidth < want) upgrade();
  });

  img.addEventListener('error', () => {
    if (img.dataset.sharp === '1') {                  // sharp source failed
      img.dataset.sharp = 'reverted';
      img.src = localSrc;
      return;
    }
    if (img.dataset.sharp === 'reverted' || !host) return toLetter();
    toLetter();
  });

  return img;
}
