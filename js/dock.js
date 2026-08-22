// The bookmark hotbar: a liquid-glass dock with macOS-style magnification,
// folder flyouts, and drag-to-reorder that writes back to real bookmarks.
import { $, el, hostOf, toast, clamp, openIncognito } from './util.js';
import { iconElement } from './icons.js';
import { activeFolder } from './spaces.js';
import { S } from './state.js';
import { attachSheen } from './theme.js';

const zone = () => $('#dock-zone');
const dock = () => $('#dock');
const itemsEl = () => $('#dock-items');
const flyout = () => $('#dock-flyout');
const popover = () => $('#dock-popover');

let nodes = [];      // bookmark nodes currently rendered
let dragId = null;

export async function initDock() {
  await renderDock();
  chrome.bookmarks.onCreated.addListener(renderDock);
  chrome.bookmarks.onRemoved.addListener(renderDock);
  chrome.bookmarks.onChanged.addListener(renderDock);
  chrome.bookmarks.onMoved.addListener(renderDock);

  // On the dock, not the item row: the row stops at the padding, so a cursor
  // approaching from the side would not arm anything until it was already
  // on top of an icon.
  dock().addEventListener('pointermove', onDockPointerMove);
  dock().addEventListener('pointerleave', onDockPointerLeave);
  dock().addEventListener('keydown', onDockKeydown);
  window.addEventListener('resize', invalidateDockAnim);

  // composedPath() rather than closest(e.target): a handler that re-renders its
  // own panel detaches the clicked node, and closest() on a detached node
  // reports "outside", which would close the panel that was just opened.
  document.addEventListener('click', e => {
    const path = e.composedPath?.() || [];
    const hit = sel => path.some(n => n?.nodeType === 1 && n.matches?.(sel));
    if (hit('.dock-item')) return;                       // the item's own handler decides
    if (!hit('#dock-flyout')) closeFlyout();
    if (!hit('#dock-popover')) closePopover();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeFlyout(); closePopover(); }
  });

  // Dropping a link from another tab (or any dragged URL) onto the dock adds it.
  dock().addEventListener('dragover', e => {
    if (dragId) return;                                   // internal reorder, not an add
    if (e.dataTransfer.types.some(t => t === 'text/uri-list' || t === 'text/plain')) {
      e.preventDefault();
      dock().classList.add('drop-add');
    }
  });
  dock().addEventListener('dragleave', () => dock().classList.remove('drop-add'));
  dock().addEventListener('drop', async e => {
    dock().classList.remove('drop-add');
    if (dragId) return;
    e.preventDefault();
    const raw = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '')
      .split('\n')[0].trim();
    if (raw) await addBookmark(raw);
  });

  applyDockSettings();
}

export function applyDockSettings() {
  zone().dataset.edge = S.dockEdge === 'top' ? 'top' : 'bottom';
  zone().dataset.hidden = S.dockAutohide ? 'true' : 'false';
  document.documentElement.dataset.dockHover = S.dockHover || 'magnify';
  // Sizes and spacing feed the cached base centres, so re-measure on change.
  invalidateDockAnim();
  resetItems();
}

async function readFolder(id) {
  try {
    const [node] = await chrome.bookmarks.getSubTree(id);
    return node?.children || [];
  } catch { return []; }
}

export async function renderDock() {
  const wrap = itemsEl();
  nodes = await readFolder(activeFolder());
  nodes = nodes.slice(0, S.dockMaxItems || 24);
  wrap.innerHTML = '';

  if (!nodes.length) {
    wrap.append(el('div', { class: 'muted', style: { fontSize: '12.5px', padding: '0 14px', alignSelf: 'center' } },
      'No bookmarks yet — click + to add one.'));
  }

  for (const n of nodes) wrap.append(buildItem(n));

  if (S.dockShowTopSites) {
    wrap.append(el('div', { class: 'dock-sep' }));
    const sites = await chrome.topSites.get();
    for (const s of sites.slice(0, 5)) {
      wrap.append(buildItem({ id: 'top:' + s.url, title: s.title, url: s.url }, true));
    }
  }

  wrap.append(el('div', { class: 'dock-sep' }));
  const addBtn = buildAction('+', 'Add bookmark', () => openBookmarkForm(addBtn));
  addBtn.classList.add('add');
  wrap.append(addBtn);
  wrap.append(buildAction('⚙', 'Settings', () => window.dispatchEvent(new Event('lgt:settings'))));
  attachSheen(dock());
  armDockKeyboard();             // the row was just rebuilt, so re-arm the tab stop
  invalidateDockAnim();          // item count/positions just changed
}

function buildItem(node, readOnly = false) {
  const isFolder = !node.url;
  const name = node.title || hostOf(node.url || '');
  const item = el('div', {
    class: 'dock-item' + (isFolder ? ' folder' : ''),
    title: name,
    draggable: !readOnly && !String(node.id).startsWith('top:'),
    dataset: { id: node.id },
    // The dock is a role="toolbar", so its items are buttons reached with the
    // arrow keys rather than Tab — one stop for the whole dock. tabindex is
    // roving: armDockKeyboard() gives exactly one item a 0.
    role: 'button',
    tabindex: '-1',
    'aria-label': isFolder ? `${name}, folder` : name,
  });

  item.append(el('div', { class: 'plate' }));
  if (isFolder) item.append(el('div', { class: 'glyph', text: '🗂' }), el('div', { class: 'dot' }));
  // 96: dock icons reach ~54 CSS px when magnified, so ~108 device px on a 2x
  // display. Anything smaller gets visibly upscaled.
  else item.append(iconElement(node.url, 96, node.title, 'glyph letter'));
  item.append(el('div', { class: 'label', text: node.title || hostOf(node.url || '') }));

  item.addEventListener('click', e => {
    if (isFolder) { e.stopPropagation(); openFlyout(node, item); return; }
    const url = httpOnly(node.url);
    if (!url) return toast('That bookmark isn’t a web address, so it can’t be opened here.');
    if (e.metaKey || e.ctrlKey || e.button === 1) chrome.tabs.create({ url, active: false });
    else location.href = url;
  });
  item.addEventListener('auxclick', e => {
    const url = httpOnly(node.url);
    if (e.button === 1 && url) { e.preventDefault(); chrome.tabs.create({ url, active: false }); }
  });
  item.addEventListener('contextmenu', e => {
    if (!node.url || readOnly || String(node.id).startsWith('top:')) return;
    e.preventDefault();
    openBookmarkForm(item, node);        // edit / copy / delete
  });

  // drag to reorder
  item.addEventListener('dragstart', e => {
    dragId = node.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', node.id);
  });
  item.addEventListener('dragover', e => {
    if (!dragId || dragId === node.id) return;
    e.preventDefault();
    item.classList.add('drop-target');
  });
  item.addEventListener('dragleave', () => item.classList.remove('drop-target'));
  item.addEventListener('drop', async e => {
    e.preventDefault();
    // Must not reach the dock's drop handler, which would read the dragged
    // bookmark id as if it were a dropped URL.
    e.stopPropagation();
    item.classList.remove('drop-target');
    if (!dragId || dragId === node.id) return;
    const index = nodes.findIndex(n => n.id === node.id);
    try {
      await chrome.bookmarks.move(dragId, { parentId: node.parentId, index });
      toast('Bookmark moved');
      await renderDock();
    } catch { toast('Could not move that bookmark'); }
  });
  // Cleared here rather than in drop: dragend always fires, drop may not.
  item.addEventListener('dragend', () => { dragId = null; });

  return item;
}

function buildAction(glyph, label, onclick) {
  const item = el('div', {
    class: 'dock-item', title: label, onclick,
    role: 'button', tabindex: '-1', 'aria-label': label,
  });
  item.append(el('div', { class: 'plate' }), el('div', { class: 'glyph', text: glyph }),
    el('div', { class: 'label', text: label }));
  return item;
}

/* ---------------- keyboard ----------------
   The dock is one Tab stop; arrows move within it, which is the toolbar
   pattern. Before this the items were plain divs with click handlers and no
   tabindex anywhere, so bookmarks could not be reached or activated from the
   keyboard at all — while the command palette was fully operable. */
function focusDockItem(items, i) {
  if (!items.length) return;
  const n = ((i % items.length) + items.length) % items.length;
  for (let k = 0; k < items.length; k++) items[k].tabIndex = k === n ? 0 : -1;
  items[n].focus();
}

/** Give exactly one item a real tab stop, so the dock is reachable. */
export function armDockKeyboard() {
  const items = dockItemEls();
  if (!items.length) return;
  if (!items.some(it => it.tabIndex === 0)) items[0].tabIndex = 0;
}

function onDockKeydown(e) {
  const items = dockItemEls();
  const i = items.indexOf(document.activeElement);
  if (i < 0) return;

  if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
    e.preventDefault();
    document.activeElement.click();
    return;
  }
  const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
  if (step !== undefined) { e.preventDefault(); focusDockItem(items, i + step); return; }
  if (e.key === 'Home') { e.preventDefault(); focusDockItem(items, 0); }
  else if (e.key === 'End') { e.preventDefault(); focusDockItem(items, items.length - 1); }
  else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
    // Same as right-click, so rename/delete/private are reachable too.
    e.preventDefault();
    document.activeElement.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  }
}

/* ============================ hover animation ============================
   Every effect is driven from one rAF loop rather than CSS :hover, for three
   reasons the CSS version got wrong:
     - :hover only ever matches the single item under the cursor, so nothing
       could ripple out to its neighbours the way a real dock does;
     - a CSS animation is cancelled the moment the pointer leaves, so sweeping
       quickly across the dock played nothing at all;
     - inline transforms from the magnify handler beat any CSS rule anyway.
   Here proximity drives the neighbours continuously, and one-shot effects run
   to completion on their own clock even after the cursor has moved on. */

const EASE_TAU = 155;          // ms; proximity glide. Higher = slower, smoother.

const EFFECTS = {
  magnify: { kind: 'prox', reach: 2.5 },
  lift:    { kind: 'prox', reach: 1.9, rise: 12, grow: 0.16 },
  // 'hold': the icon under the cursor springs up and STAYS up, dropping fast
  // once you leave. `discrete` is what keeps it from being magnify — the
  // target is all-or-nothing per icon rather than a smooth distance curve, so
  // it snaps from one icon to the next. Neighbours still get the old transient
  // pop wave (dur/stagger/spread) on top; they just don't hold.
  // omega 15 rad/s + zeta 0.55 => first peak at ~250ms with ~13% overshoot,
  // fully settled around 500ms. (Tuned in real units so the timing is
  // predictable rather than dependent on frame rate.)
  pop:     { kind: 'hold', discrete: true, omega: 15, zeta: 0.55,
             releaseTau: 95, overshoot: 0.3,
             dur: 560, stagger: 48, spread: 2, falloff: 2.2 },
  bounce:  { kind: 'shot', dur: 1200, stagger: 74, spread: 3, falloff: 1.35 },
  wiggle:  { kind: 'shot', dur: 1080, stagger: 66, spread: 2, falloff: 1.35 },
  // Steep falloff: neighbours wobble, but only just (≈27% and 3% amplitude).
  jelly:   { kind: 'shot', dur: 1050, stagger: 62, spread: 2, falloff: 3.2 },
  none:    { kind: 'none' },
};

const anim = {
  raf: 0, pointerX: null, base: [], st: [], last: 0, hovered: -1, dirty: true,
  items: [],      // cached element list; the loop must not re-query per frame
  order: [],      // indices sorted left-to-right, for the O(n) spread pass
  buf: null,      // reused per-frame scratch, so the loop allocates nothing
  pad: -1,        // last paddingInline written
  childCount: -1, // row child count when the cache was built
};

const dockItemEls = () => [...itemsEl().querySelectorAll('.dock-item')];

/** Cache untransformed centres so the loop never reads layout it just wrote. */
function measureBase() {
  const items = dockItemEls();
  for (const it of items) it.style.transform = '';
  dock().style.paddingInline = '';
  anim.pad = -1;
  anim.items = items;
  anim.childCount = itemsEl().children.length;
  anim.base = items.map(it => {
    const r = it.getBoundingClientRect();
    return r.left + r.width / 2;
  });
  anim.st = items.map((_, i) => anim.st[i] || { prox: 0, at: -1, amp: 0 });
  anim.st.length = items.length;

  // The spread pass below walks items in screen order. Deriving that once here
  // rather than assuming DOM order keeps it correct whatever the row contains.
  anim.order = items.map((_, i) => i).sort((a, b) => anim.base[a] - anim.base[b]);

  const n = items.length;
  anim.buf = {
    sx: new Float64Array(n), sy: new Float64Array(n),
    ty: new Float64Array(n), rot: new Float64Array(n),
    tx: new Float64Array(n), last: new Array(n).fill(''),
  };
  anim.dirty = false;
}

export function invalidateDockAnim() { anim.dirty = true; }

function startAnim() {
  if (!anim.raf) { anim.last = performance.now(); anim.raf = requestAnimationFrame(tick); }
}

function resetItems() {
  for (const it of dockItemEls()) it.style.transform = '';
  dock().style.paddingInline = '';
  anim.pad = -1;
  if (anim.buf) anim.buf.last.fill('');
}

/* Envelopes, all normalised to 0..1 in and out, all settling back to rest. */
const envBounce = p => Math.abs(Math.sin(Math.PI * p * 2)) * (1 - p) * (1 - p);
const envWiggle = p => Math.sin(Math.PI * 2 * p * 2.2) * (1 - p) * (1 - p);
const envJelly  = p => Math.cos(Math.PI * 2 * p * 1.8) * (1 - p) * (1 - p);
const envPop    = p => Math.sin(Math.PI * p);

/** The hover engine is a rAF loop, so no CSS media query can quiet it — it has
 *  to check for itself. Live rather than cached: the OS setting can change
 *  while a tab is open, and a new tab page can sit open for days. */
const reducedMotion = () =>
  matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function tick(now) {
  anim.raf = 0;
  const mode = reducedMotion() ? 'none' : (S.dockHover || 'magnify');
  const eff = EFFECTS[mode] || EFFECTS.magnify;

  if (mode === 'none') { resetItems(); return; }
  // At most one DOM query per frame, and only when something actually changed.
  // The row also holds separators, so this compares against the child count
  // recorded at measure time rather than against the .dock-item count — the
  // live collection's length is free, a fresh querySelectorAll is not.
  if (anim.dirty || anim.childCount !== itemsEl().children.length) measureBase();

  const items = anim.items;
  const n = items.length;
  if (!n) return;

  const dt = Math.min(64, now - anim.last);
  anim.last = now;
  const ease = 1 - Math.exp(-dt / EASE_TAU);

  // Scaled by the layout pass's fit factor, the same one the CSS applies to
  // --dock-size. Reading an inline custom property is a string lookup, not a
  // layout read, so it is safe in this per-frame loop — and taking it from
  // the DOM rather than caching it means it can never go stale on resize.
  const fit = parseFloat(document.documentElement.style.getPropertyValue('--fit')) || 1;
  const size = (S.dockSize || 56) * fit;
  const maxScale = S.dockMagnify || 1.55;
  const px = anim.pointerX;

  // Which item is the cursor over? Drives one-shot waves.
  let nearest = -1, nearestD = Infinity;
  if (px != null) {
    for (let i = 0; i < n; i++) {
      const d = Math.abs(px - anim.base[i]);
      if (d < nearestD) { nearestD = d; nearest = i; }
    }
    if (nearestD > size * 1.1) nearest = -1;
  }

  if (eff.spread != null && nearest >= 0 && nearest !== anim.hovered) {
    // For 'hold', skip k=0: the hovered icon's rise comes from its spring, and
    // adding a transient on top would make it pop twice.
    const from = eff.discrete ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const k = Math.abs(i - nearest);
      if (k > eff.spread || k < from) continue;
      const amp = Math.pow(1 - k / (eff.spread + 1), eff.falloff ?? 1.35);
      const st = anim.st[i];
      // Don't stomp an animation that's still near its peak, or a fast sweep
      // would leave every icon stuttering at the start of its curve.
      const running = st.at >= 0 && now - st.at < eff.dur;
      const progress = running ? (now - st.at) / eff.dur : 1;
      if (!running || progress > 0.45 || amp > st.amp) { st.at = now + k * eff.stagger; st.amp = amp; }
    }
  }
  anim.hovered = nearest;

  // --- per item: proximity + one-shot envelope
  const { sx, sy, ty, rot, tx, last } = anim.buf;
  let busy = false;

  for (let i = 0; i < n; i++) {
    const st = anim.st[i];
    let target = 0;
    if (px != null) {
      if (eff.discrete) {
        // All-or-nothing per icon. A smooth distance curve here is precisely
        // what made this indistinguishable from magnify.
        target = i === nearest ? 1 : 0;
      } else {
        const d = Math.abs(px - anim.base[i]);
        const reach = size * (eff.reach || 1.2);
        target = Math.pow(clamp(1 - d / reach, 0, 1), 1.7);
      }
    }
    if (eff.kind === 'hold') {
      // A real damped spring in seconds, not per-frame factors: omega sets how
      // long the rise takes, zeta how much it overshoots. The spring drives
      // BOTH directions while the icon is targeted — the previous version
      // flipped to the fast release path the moment it crossed the target,
      // which chopped the overshoot off with a visible snap.
      if (target > 0) {
        const dts = Math.min(0.032, dt / 1000);          // clamp for stability
        const w = eff.omega, z = eff.zeta;
        st.v = (st.v || 0) + (-2 * z * w * (st.v || 0) - w * w * (st.prox - target)) * dts;
        st.prox += st.v * dts;
        if (Math.abs(st.v) > 0.02) busy = true;
      } else {
        // Cursor is elsewhere: drop straight back, no bounce.
        st.v = 0;
        st.prox += (0 - st.prox) * (1 - Math.exp(-dt / eff.releaseTau));
      }
      st.prox = clamp(st.prox, 0, 1 + eff.overshoot);
    } else {
      st.prox += (target - st.prox) * ease;
    }
    if (st.prox > 0.002) busy = true;

    let s = 1, kx = 1, ky = 1, y = 0, r = 0;

    if (eff.kind === 'hold') {
      s = 1 + (maxScale - 1) * st.prox;
      // Neighbours: a transient swell that returns to rest — they don't hold.
      const p = st.at < 0 ? 1 : (now - st.at) / eff.dur;
      if (p >= 0 && p < 1) {
        busy = true;
        s += (maxScale - 1) * 0.5 * envPop(p) * st.amp;
      } else if (st.at >= 0 && p >= 1) {
        st.at = -1; st.amp = 0;
      }
    } else if (eff.kind === 'prox') {
      s = 1 + (maxScale - 1) * st.prox;
      if (mode === 'lift') { s = 1 + eff.grow * st.prox; y = -eff.rise * st.prox; }
    } else {
      s = 1 + (maxScale - 1) * 0.22 * st.prox;       // gentle follow under the wave
      const p = st.at < 0 ? 1 : (now - st.at) / eff.dur;
      if (p >= 0 && p < 1) {
        busy = true;
        const a = st.amp;
        if (mode === 'bounce') y = -envBounce(p) * size * 0.34 * a;
        else if (mode === 'wiggle') r = envWiggle(p) * 14 * a;
        else if (mode === 'jelly') { const e = envJelly(p) * 0.24 * a; kx = 1 + e; ky = 1 - e; }
      } else if (st.at >= 0 && p >= 1) {
        st.at = -1; st.amp = 0;
      }
    }
    sx[i] = s * kx; sy[i] = s * ky; ty[i] = y; rot[i] = r;
  }

  // --- spread: each growing icon pushes its neighbours outward.
  // Uses measured base centres, so separators and the +/gear buttons are fine.
  //
  // An item is pushed right by half the growth of everything to its left and
  // left by half the growth of everything to its right, so one pass in screen
  // order carrying a running total gives the same answer as comparing every
  // pair. (Checked against the pairwise version: identical to the bit, and
  // ~13x faster — it was the only O(n^2) step in the frame.)
  let total = 0;
  for (let i = 0; i < n; i++) {
    const g = size * (sx[i] - 1);
    if (g > 0) total += g;
  }
  let maxShift = 0, left = 0;
  for (const i of anim.order) {
    const g = size * (sx[i] - 1);
    const gi = g > 0 ? g : 0;
    const shift = 0.5 * left - 0.5 * (total - left - gi);
    tx[i] = shift;
    left += gi;
    const abs = shift < 0 ? -shift : shift;
    if (abs > maxShift) maxShift = abs;
  }

  // Writing a transform that is already set still costs a style invalidation,
  // and at rest most of the row is unchanged frame to frame.
  for (let i = 0; i < n; i++) {
    const t = `translate(${tx[i].toFixed(2)}px, ${ty[i].toFixed(2)}px) ` +
              `rotate(${rot[i].toFixed(2)}deg) scale(${sx[i].toFixed(3)}, ${sy[i].toFixed(3)})`;
    if (t !== last[i]) { items[i].style.transform = t; last[i] = t; }
  }
  // Grow the glass panel symmetrically so magnified icons stay inside it.
  // Padding is symmetric and the dock is centred, so item centres don't move.
  // This one drives layout, so it is worth not repeating either.
  const pad = +(12 + maxShift).toFixed(1);
  if (pad !== anim.pad) { dock().style.paddingInline = pad + 'px'; anim.pad = pad; }

  if (busy || px != null) anim.raf = requestAnimationFrame(tick);
  else { resetItems(); anim.hovered = -1; }
}

function onDockPointerMove(e) { anim.pointerX = e.clientX; startAnim(); }
function onDockPointerLeave() { anim.pointerX = null; startAnim(); }

/* ---------- folder flyout ---------- */
async function openFlyout(node, anchor) {
  closePopover();
  const fly = flyout();
  const kids = await readFolder(node.id);
  if (!kids.length) { toast('That folder is empty'); return; }

  fly.innerHTML = '';
  for (const k of kids.slice(0, 40)) {
    fly.append(el('a', {
      class: 'fly-item', href: httpOnly(k.url) || '#', title: k.title,
      onclick: e => { if (!k.url) { e.preventDefault(); openFlyout(k, anchor); } },
    },
      k.url ? iconElement(k.url, 32, k.title, 'letter fly-letter') : el('div', { class: 'glyph', text: '🗂' }),
      el('span', { text: k.title || hostOf(k.url || '') })));
  }
  fly.hidden = false;
  attachSheen(fly);
  positionNear(fly, anchor);
}

export function closeFlyout() { flyout().hidden = true; }
export function closePopover() { popover().hidden = true; }

/** Shared placement for the flyout and the add/edit popover. */
function positionNear(node, anchor) {
  const zr = zone().getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  node.style.left = '0px';
  const w = node.offsetWidth;
  node.style.left = clamp(a.left + a.width / 2 - w / 2 - zr.left, 12,
    Math.max(12, zr.width - w - 12)) + 'px';
  if (S.dockEdge === 'top') { node.style.bottom = 'auto'; node.style.top = 'calc(100% + 10px)'; }
  else { node.style.top = 'auto'; node.style.bottom = 'calc(100% + 10px)'; }
}

/** Bookmarks can be bookmarklets. Navigating this page — which runs at the
 *  extension's own origin — to a javascript: URL is not something to allow,
 *  even though the MV3 script-src CSP would also refuse it. */
const httpOnly = url => {
  try { return /^https?:$/.test(new URL(url).protocol) ? url : null; }
  catch { return null; }
};

/** Accepts bare hosts ("github.com") as well as full URLs. */
function normalizeURL(raw) {
  let url = String(raw).trim();
  if (!url) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = 'https://' + url;
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.toString() : null;
  } catch { return null; }
}

/** Create a bookmark in whichever folder feeds the dock. */
export async function addBookmark(rawUrl, title) {
  const url = normalizeURL(rawUrl);
  if (!url) { toast('That doesn’t look like a valid URL'); return false; }
  try {
    await chrome.bookmarks.create({
      parentId: activeFolder(),
      title: (title || '').trim() || hostOf(url),
      url,
    });
    toast('Added to the dock');
    await renderDock();
    return true;
  } catch (e) {
    toast('Could not add that bookmark: ' + e.message);
    return false;
  }
}

/**
 * The add/edit sheet. With no `existing` node it adds — including a one-click
 * list of your open tabs, which is the fastest way to fill an empty dock.
 */
async function openBookmarkForm(anchor, existing = null) {
  closeFlyout();
  const p = popover();
  const editing = !!existing;
  p.innerHTML = '';
  p.hidden = false;

  const err = el('div', { class: 'dp-err', hidden: true });
  const urlI = el('input', { class: 'dp-field', type: 'text', spellcheck: 'false',
    placeholder: 'example.com', value: existing?.url || '' });
  const nameI = el('input', { class: 'dp-field', type: 'text',
    placeholder: 'Name (optional)', value: existing?.title || '' });

  const fail = m => { err.textContent = m; err.hidden = false; };

  async function save() {
    const url = normalizeURL(urlI.value);
    if (!url) return fail('Enter a valid address, e.g. github.com');
    const title = nameI.value.trim() || hostOf(url);
    try {
      if (editing) {
        await chrome.bookmarks.update(existing.id, { title, url });
        toast('Bookmark updated');
      } else {
        await chrome.bookmarks.create({ parentId: activeFolder(), title, url });
        toast('Added to the dock');
      }
      closePopover();
      await renderDock();
    } catch (e) { fail(e.message); }
  }

  const onEnter = e => { if (e.key === 'Enter') { e.preventDefault(); save(); } };
  urlI.addEventListener('keydown', onEnter);
  nameI.addEventListener('keydown', onEnter);

  const buttons = [el('button', { class: 'btn', text: 'Cancel', onclick: closePopover })];
  if (editing) {
    buttons.unshift(el('button', {
      class: 'btn danger', text: 'Delete',
      onclick: async () => {
        try { await chrome.bookmarks.remove(existing.id); toast('Bookmark removed'); }
        catch (e) { toast('Could not remove: ' + e.message); }
        closePopover();
        await renderDock();
      },
    }));
    buttons.unshift(el('button', {
      class: 'btn', text: 'Copy link',
      onclick: () => navigator.clipboard.writeText(existing.url).then(() => toast('Link copied')),
    }));
    buttons.unshift(el('button', {
      class: 'btn', text: 'Private',
      title: 'Open in a private window',
      onclick: () => { openIncognito(httpOnly(existing.url)); closePopover(); },
    }));
  }
  buttons.push(el('button', { class: 'btn primary', text: editing ? 'Save' : 'Add', onclick: save }));

  p.append(
    el('div', { class: 'dp-title', text: editing ? 'Edit bookmark' : 'Add bookmark' }),
    err, urlI, nameI,
    el('div', { class: 'dp-row' }, ...buttons),
  );

  // Quick-add from the tabs you already have open.
  if (!editing) {
    const list = el('div', { class: 'dp-tabs scroll' });
    p.append(el('div', { class: 'dp-sep', text: 'Or add an open tab' }), list);
    try {
      const open = (await chrome.tabs.query({}))
        .filter(t => /^https?:/.test(t.url || ''))
        .filter((t, i, a) => a.findIndex(x => x.url === t.url) === i)
        .slice(0, 12);
      if (!open.length) list.append(el('div', { class: 'muted', style: { fontSize: '12px' }, text: 'No open tabs.' }));
      for (const t of open) {
        list.append(el('div', {
          class: 'dp-tab', title: t.url,
          onclick: async () => { if (await addBookmark(t.url, t.title)) closePopover(); },
        }, iconElement(t.url, 32, t.title, 'letter dp-letter'), el('span', { text: t.title || hostOf(t.url) })));
      }
    } catch {
      list.append(el('div', { class: 'muted', style: { fontSize: '12px' }, text: 'Open tabs unavailable.' }));
    }
  }

  attachSheen(p);
  positionNear(p, anchor);
  urlI.focus();
}
