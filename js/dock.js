// The bookmark hotbar: a liquid-glass dock with macOS-style magnification,
// folder flyouts, and pick-up-and-drop reordering that writes back to real
// bookmarks.
import { $, el, hostOf, toast, clamp, debounce, openIncognito } from './util.js';
import { iconElement } from './icons.js';
import { activeFolder } from './spaces.js';
import { S } from './state.js';
import { attachSheen } from './theme.js';

/* ---------- orientation ----------
   The dock can sit on any of the four edges. Everything below that used to
   assume "a horizontal row along the bottom" is written against a main axis
   and an outward direction instead, so left and right are the same code with
   the axes swapped rather than a second implementation.

   `main` is the axis the icons are laid out along; `out` points away from the
   edge the dock is docked to, which is the direction a lifting or bouncing
   icon travels. */
const EDGES = {
  bottom: { vertical: false, outX: 0, outY: -1 },
  top:    { vertical: false, outX: 0, outY: 1 },
  left:   { vertical: true,  outX: 1, outY: 0 },
  right:  { vertical: true,  outX: -1, outY: 0 },
};

const edgeOf = () => EDGES[S.dockEdge] ? S.dockEdge : 'bottom';
const geom = () => EDGES[edgeOf()];
const isVertical = () => geom().vertical;

const zone = () => $('#dock-zone');
const dock = () => $('#dock');
const itemsEl = () => $('#dock-items');
const flyout = () => $('#dock-flyout');
const popover = () => $('#dock-popover');

let nodes = [];      // bookmark nodes currently rendered

export async function initDock() {
  await renderDock();
  // Coalesced rather than wired straight to renderDock. Each of these fires
  // once per bookmark, and a bulk import fires hundreds in a row — every one
  // of which would otherwise re-read the whole folder and rebuild every icon
  // in the dock. One rebuild after the last change is the same result for a
  // fraction of the work, and a frame's delay on a single add is invisible.
  const scheduleRender = debounce(() => { renderDock(); }, 60);
  chrome.bookmarks.onCreated.addListener(scheduleRender);
  chrome.bookmarks.onRemoved.addListener(scheduleRender);
  chrome.bookmarks.onChanged.addListener(scheduleRender);
  chrome.bookmarks.onMoved.addListener(scheduleRender);

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
    if (e.dataTransfer.types.some(t => t === 'text/uri-list' || t === 'text/plain')) {
      e.preventDefault();
      dock().classList.add('drop-add');
    }
  });
  dock().addEventListener('dragleave', () => dock().classList.remove('drop-add'));
  dock().addEventListener('drop', async e => {
    dock().classList.remove('drop-add');
    e.preventDefault();
    const raw = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '')
      .split('\n')[0].trim();
    if (raw) await addBookmark(raw);
  });

  // Letting go of a dragged icon is a pointerup over that icon, and the browser
  // follows every one of those with a click. Capture phase, so it is stopped
  // before anything downstream reads it as "open this bookmark". Narrowed to
  // clicks on the dock so that a drop cannot eat one meant for the page.
  window.addEventListener('click', e => {
    if (!justDragged()) return;
    const path = e.composedPath?.() || [];
    if (!path.some(n => n?.nodeType === 1 && n.matches?.('.dock-item'))) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  applyDockSettings();
}

export function applyDockSettings() {
  const edge = edgeOf();
  zone().dataset.edge = edge;
  // Also on the root, for rules that cannot reach the dock from where they are
  // — the toast lifts clear of a bottom dock and must not for the other three.
  document.documentElement.dataset.dockEdge = edge;
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
  // Captured before the row is torn down, so focus can be handed back to the
  // same position afterwards rather than falling to <body>.
  const focusedAt = dockItemEls().indexOf(document.activeElement);
  // A rebuild during a drag pulls the dragged icon out of the document. Pointer
  // capture is then released implicitly, so the pointerup never reaches the
  // handler that would end the drag — it lands on a freshly built element whose
  // own handler rejects it by identity. drag.active would stay true for the life
  // of the tab: every later drag refused, and the magnify loop dead, because
  // both startAnim and tick bail on that flag.
  //
  // Bookmarks change under us for ordinary reasons — another window, a sync, an
  // import — so this is not a corner case. Deferring is right rather than
  // dropping: whatever changed still needs drawing once the drag is done.
  if (drag.active) { drag.pendingRender = true; return; }
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
  // Hidden by choice, not taken away: the shortcut and the command palette
  // both still open settings, so this tidies the dock rather than locking
  // anyone out of it.
  if (S.showSettingsBtn) {
    wrap.append(buildAction('⚙', 'Settings', () => window.dispatchEvent(new Event('lgt:settings'))));
  }
  attachSheen(dock());
  armDockKeyboard(focusedAt);    // the row was just rebuilt, so re-arm the tab stop
  invalidateDockAnim();          // item count/positions just changed
}

function buildItem(node, readOnly = false) {
  const isFolder = !node.url;
  const name = node.title || hostOf(node.url || '');
  const item = el('div', {
    class: 'dock-item' + (isFolder ? ' folder' : ''),
    title: name,
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
    // Belt and braces with the window-level guard in initDock, and not
    // redundant: a committed drop re-renders the row, which detaches the icon
    // the pointer was released over. A click dispatched at a node that is no
    // longer in the document runs that node's own listeners and then stops —
    // it never reaches window, so only this one is in a position to refuse it.
    if (justDragged()) return;
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
    // Mid-drag the press is holding an icon, not asking about it.
    if (drag.active) { e.preventDefault(); return; }
    if (!node.url || readOnly || String(node.id).startsWith('top:')) return;
    e.preventDefault();
    openBookmarkForm(item, node);        // edit / copy / delete
  });

  // Top sites are not bookmarks and have nowhere to be moved to.
  if (!readOnly && !String(node.id).startsWith('top:')) armReorder(item, node);

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
export function armDockKeyboard(refocusIndex = -1) {
  const items = dockItemEls();
  if (!items.length) return;
  if (!items.some(it => it.tabIndex === 0)) items[0].tabIndex = 0;
  // A rebuild throws away the element that had focus, and focus then falls to
  // <body> — so for anyone driving the dock from the keyboard, any bookmark
  // change anywhere in the browser silently ends their navigation. Putting it
  // back on the same position keeps the row usable; the index is clamped
  // because the row may have got shorter.
  if (refocusIndex < 0) return;
  const at = items[Math.min(refocusIndex, items.length - 1)];
  if (at) { for (const it of items) it.tabIndex = it === at ? 0 : -1; at.focus(); }
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
  // Both axes, whichever way the dock is turned. Accepting all four rather
  // than only the pair that matches the current edge costs nothing and means
  // the keys never stop working because the dock moved.
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 }[e.key];
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
  raf: 0, pointerMain: null, base: [], st: [], last: 0, hovered: -1, dirty: true,
  items: [],      // cached element list; the loop must not re-query per frame
  order: [],      // indices in screen order along the main axis
  buf: null,      // reused per-frame scratch, so the loop allocates nothing
  pad: -1,        // last paddingInline written
  childCount: -1, // row child count when the cache was built
};

const dockItemEls = () => [...itemsEl().querySelectorAll('.dock-item')];

/** Cache untransformed centres so the loop never reads layout it just wrote. */
function measureBase() {
  const items = dockItemEls();
  const vert = isVertical();
  for (const it of items) it.style.transform = '';
  clearPad();
  anim.items = items;
  anim.childCount = itemsEl().children.length;
  // The centre along whichever axis the dock runs. Everything downstream —
  // proximity, ordering, the spread pass — is one-dimensional in this number.
  anim.base = items.map(it => {
    const r = it.getBoundingClientRect();
    return vert ? r.top + r.height / 2 : r.left + r.width / 2;
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
  // A drag owns .dock-item transforms until it ends; two writers would fight
  // over them a frame at a time.
  if (drag.active) return;
  if (!anim.raf) { anim.last = performance.now(); anim.raf = requestAnimationFrame(tick); }
}

/** The dock grows along its own axis to keep magnified icons inside the glass,
 *  so which padding that is depends on the edge. Both are cleared, because the
 *  edge may have changed since the last write. */
function clearPad() {
  dock().style.paddingInline = '';
  dock().style.paddingBlock = '';
  anim.pad = -1;
}

function resetItems() {
  for (const it of dockItemEls()) it.style.transform = '';
  clearPad();
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
  if (drag.active) return;                 // see startAnim
  // Low performance mode lands here rather than on the attribute alone: this
  // is a rAF loop writing a transform to every icon every frame, and 'none' is
  // the branch that stops scheduling the next one.
  const mode = (reducedMotion() || S.lowPerf) ? 'none' : (S.dockHover || 'magnify');
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
  const px = anim.pointerMain;
  const vert = isVertical();
  const edge = geom();

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
      if (mode === 'lift') { s = 1 + eff.grow * st.prox; y = eff.rise * st.prox; }
    } else {
      s = 1 + (maxScale - 1) * 0.22 * st.prox;       // gentle follow under the wave
      const p = st.at < 0 ? 1 : (now - st.at) / eff.dur;
      if (p >= 0 && p < 1) {
        busy = true;
        const a = st.amp;
        if (mode === 'bounce') y = envBounce(p) * size * 0.34 * a;
        else if (mode === 'wiggle') r = envWiggle(p) * 14 * a;
        else if (mode === 'jelly') {
          // Squash along the dock's own axis and stretch across it, so the
          // wobble reads the same way whichever edge the dock is on.
          const e = envJelly(p) * 0.24 * a;
          if (vert) { ky = 1 + e; kx = 1 - e; } else { kx = 1 + e; ky = 1 - e; }
        }
      } else if (st.at >= 0 && p >= 1) {
        st.at = -1; st.amp = 0;
      }
    }
    // `y` is now distance along `out` — away from the edge — not screen Y.
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
  // Two contributions, on axes that depend on the edge: the spread runs along
  // the dock, and the lift/bounce runs outward from it. On a bottom dock those
  // are X and -Y, which is what this used to hardcode.
  const { outX, outY } = edge;
  for (let i = 0; i < n; i++) {
    const dx = (vert ? 0 : tx[i]) + outX * ty[i];
    const dy = (vert ? tx[i] : 0) + outY * ty[i];
    const t = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) ` +
              `rotate(${rot[i].toFixed(2)}deg) scale(${sx[i].toFixed(3)}, ${sy[i].toFixed(3)})`;
    if (t !== last[i]) { items[i].style.transform = t; last[i] = t; }
  }
  // Grow the glass panel symmetrically so magnified icons stay inside it.
  // Padding is symmetric and the dock is centred, so item centres don't move.
  // This one drives layout, so it is worth not repeating either — and it has to
  // grow along the dock's own axis, which is the block axis when it is vertical.
  const pad = +(12 + maxShift).toFixed(1);
  if (pad !== anim.pad) {
    dock().style[vert ? 'paddingBlock' : 'paddingInline'] = pad + 'px';
    anim.pad = pad;
  }

  // Three states, not two. `busy` means something is still easing, so keep
  // going. Once everything has settled the loop has nothing left to compute:
  // with the pointer still over the dock it must stop scheduling but KEEP the
  // magnified transforms, and only once the pointer leaves may it reset them.
  // Resting a cursor on the dock used to hold a 60fps loop open indefinitely
  // writing the same values, which on a laptop is the fan coming on for nothing.
  if (busy) anim.raf = requestAnimationFrame(tick);
  else if (px == null) { resetItems(); anim.hovered = -1; }
}

function onDockPointerMove(e) {
  if (drag.active) return;
  // The coordinate along the dock's own axis; the other one is irrelevant to
  // proximity, which is what makes the whole loop one-dimensional.
  anim.pointerMain = mainAxis(e);
  startAnim();
}
function onDockPointerLeave() { anim.pointerMain = null; startAnim(); }

/* ---------------- drag to reorder ----------------
   Pointer-driven rather than HTML5 drag-and-drop, which is what this replaces.
   Three things went wrong with the native API, and all three are the same
   shape: it only ever reports which element the pointer is over.

   That means a drop can only mean "before this icon". There was no way to reach
   the position after the last one — dropping on it put you in front of it — so
   the one place you could not ask for was the end of the row, which is where
   most people want a bookmark they just added.

   It also means no preview. A dashed outline said which icon you were over, not
   where the icon in your hand would land, so reordering was a guess followed by
   a check.

   And its drag image is a snapshot taken at dragstart. The icon under the
   cursor is always mid-magnification at that moment, so what you dragged around
   was a frozen half-scaled icon that then stayed that size.

   Pointer events fix all three, and cover the vertical edges and touch without a
   second implementation — which matters now that the dock has four edges. */

const DRAG_SLOP = 5;      // px of travel before a press counts as a drag
const DRAG_LIFT = 10;     // px the held icon rises away from the dock's edge

const drag = {
  active: false,          // past the slop, and owning transforms
  id: null, parentId: null, el: null, pointerId: -1,
  from: -1,               // where the held icon started
  slot: -1,               // where it would land if dropped now
  items: [], base: [],    // the reorderable icons, and their resting centres
  flow: 1,                // +1 if the row runs the way the axis counts up
  start: 0,               // pointer position along the main axis at the press
  endedAt: 0,             // when the last drop happened; see justDragged
  pendingRender: false,   // a bookmark change arrived mid-drag; draw it after
};

// A drop is followed by a click that must not count. This is a timestamp rather
// than a flag because two guards read it — one on window, one on the item — and
// whichever ran first would clear a flag out from under the other. The window is
// short enough that a click the user actually meant cannot fall inside it: it
// would have to be a second press and release within a third of a second, and a
// press resets this anyway.
const DRAG_CLICK_MS = 350;
const justDragged = () => drag.endedAt > 0 && performance.now() - drag.endedAt < DRAG_CLICK_MS;

const mainAxis = e => (isVertical() ? e.clientY : e.clientX);

/** A translation along the dock's own axis, whichever one that is. */
const along = d => `translate(${isVertical() ? 0 : d}px, ${isVertical() ? d : 0}px)`;

function armReorder(item, node) {
  item.addEventListener('pointerdown', e => {
    if (e.button !== 0 || drag.active) return;
    // Not a drag yet. A press that never travels is still a click, and one
    // click opening a bookmark is the whole point of the dock.
    drag.id = node.id;
    drag.parentId = node.parentId || activeFolder();
    drag.el = item;
    drag.start = mainAxis(e);
    drag.endedAt = 0;
    // Captured from the press rather than from the threshold: without it the
    // pointer can leave a 48px icon between two moves and the drag is dropped.
    try { item.setPointerCapture(e.pointerId); } catch {}
    drag.pointerId = e.pointerId;
  });

  item.addEventListener('pointermove', e => {
    if (drag.el !== item || e.pointerId !== drag.pointerId) return;
    const at = mainAxis(e);
    if (!drag.active) {
      if (Math.abs(at - drag.start) < DRAG_SLOP) return;
      if (!beginDrag()) { drag.el = null; return; }
    }
    moveDrag(at);
  });

  const up = ok => e => {
    if (drag.el !== item || e.pointerId !== drag.pointerId) return;
    endDrag(ok);
  };
  item.addEventListener('pointerup', up(true));
  item.addEventListener('pointercancel', up(false));
  // The browser releases capture on its own if the element leaves the document,
  // and then neither of the two above will ever fire on it. Without this the
  // drag would have no way to end. Guarded on drag.active because releasing
  // capture deliberately, at the end of a normal drop, fires this too.
  item.addEventListener('lostpointercapture', () => {
    if (drag.active && drag.el === item) endDrag(false);
  });
}

function beginDrag() {
  const row = itemsEl();
  const from = nodes.findIndex(n => n.id === drag.id);
  const items = nodes.map(n => row.querySelector(`.dock-item[data-id="${CSS.escape(n.id)}"]`));
  // A row that changed under the press, or a single icon: nothing to reorder.
  if (from < 0 || items.length < 2 || items.some(x => !x)) return false;

  // Clearing first is not tidying. The magnify loop leaves scale and offset on
  // whatever the pointer passed over on its way here, and measuring that would
  // put every resting centre somewhere the icon does not rest.
  resetItems();
  const vert = isVertical();
  drag.base = items.map(it => {
    const r = it.getBoundingClientRect();
    return vert ? r.top + r.height / 2 : r.left + r.width / 2;
  });
  // Right-to-left lays a horizontal dock out backwards, so the first bookmark
  // has the largest x. Everything below asks "is this one earlier in the row",
  // which is the opposite comparison in that case.
  drag.flow = drag.base[drag.base.length - 1] >= drag.base[0] ? 1 : -1;
  drag.items = items;
  drag.from = drag.slot = from;
  drag.active = true;
  zone().dataset.dragging = 'true';
  drag.el.classList.add('dragging');
  return true;
}

function moveDrag(at) {
  const d = at - drag.start;
  const g = geom();
  const x = (g.vertical ? 0 : d) + g.outX * DRAG_LIFT;
  const y = (g.vertical ? d : 0) + g.outY * DRAG_LIFT;
  drag.el.style.transform = `translate(${x}px, ${y}px) scale(1.12)`;

  // Where it would land: how many of the others it has been carried past. That
  // counts gaps rather than hit-testing icons, which is what makes both ends of
  // the row reachable — past the last centre is simply one slot further on.
  const c = drag.base[drag.from] + d;
  let slot = 0;
  for (let i = 0; i < drag.base.length; i++) {
    if (i !== drag.from && drag.flow * (drag.base[i] - c) < 0) slot++;
  }
  if (slot === drag.slot) return;
  drag.slot = slot;
  layoutGap();
}

/** Put every other icon where it would sit if the drop happened now, so the gap
 *  under the cursor is the answer rather than a guess about it. */
function layoutGap() {
  for (let i = 0; i < drag.items.length; i++) {
    if (i === drag.from) continue;
    const j = i < drag.from ? i : i - 1;       // its index among the others
    const to = j < drag.slot ? j : j + 1;      // ...and the slot that leaves it
    const d = drag.base[to] - drag.base[i];
    drag.items[i].style.transform = d ? along(d) : '';
  }
}

async function endDrag(commit) {
  const { el: item, active, slot, from, id, parentId, pointerId } = drag;
  // Cleared BEFORE the capture is released, not after. Releasing fires
  // lostpointercapture, which is now listened for — the spec queues that as a
  // task, but if it ever arrived synchronously this function would re-enter
  // itself. Clearing first makes the listener's `drag.el === item` guard false
  // either way, so the ordering is not something to depend on.
  drag.pointerId = -1;
  drag.el = null;
  drag.id = null;
  if (item && pointerId >= 0) {
    try { item.releasePointerCapture(pointerId); } catch {}
  }
  if (!active) return;                        // a plain click; nothing was moved
  drag.active = false;
  drag.endedAt = performance.now();
  item.classList.remove('dragging');          // ...which hands it the transition

  const landed = commit && slot !== from;
  // Into the gap, not back home. The write to the bookmarks API takes a moment
  // to come back, and without this the icon returns to where it started and
  // then jumps to its new place once it does.
  item.style.transform = landed ? along(drag.base[slot] - drag.base[from]) : '';
  if (!landed) for (const it of drag.items) it.style.transform = '';

  if (landed) {
    try {
      // The index is into the row as it stands now, the icon being moved
      // included: chrome.bookmarks.move compensates for its own removal itself.
      // So this is the gap it was dropped into, counted before anything moves,
      // and it is allowed to be one past the last icon.
      await chrome.bookmarks.move(id, { parentId, index: slot >= from ? slot + 1 : slot });
    } catch { toast('Could not move that bookmark'); }
    // onMoved rebuilds too, but only after its debounce, and until then the row
    // is holding a layout that describes an order it no longer has.
    await renderDock();
  }

  // The icons that did not move are gliding home; ending the drag now would cut
  // that off, because the transition only exists while the attribute does.
  // Held the whole row of icons, which after a commit are detached nodes the
  // module then kept alive until the next drag.
  drag.items = [];
  drag.base = [];

  // A bookmark change that arrived mid-drag was deferred rather than dropped.
  if (drag.pendingRender) { drag.pendingRender = false; if (!landed) await renderDock(); }

  // The icons that did not move are gliding home; ending the drag now would cut
  // that off, because the transition only exists while the attribute does.
  setTimeout(() => {
    if (drag.active) return;                  // another drag already started
    delete zone().dataset.dragging;
    resetItems();
    invalidateDockAnim();
  }, landed ? 0 : 200);
}

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

/** Shared placement for the flyout and the add/edit popover.
 *
 *  Everything is written in pixels relative to the zone rather than with a
 *  `calc(100% + 10px)` offset. The percentage worked only because a horizontal
 *  zone is exactly as tall as the dock; a vertical zone spans the whole
 *  viewport, so 100% of it is most of the screen and the panel landed nowhere
 *  near the icon it belongs to. */
function positionNear(node, anchor) {
  const zr = zone().getBoundingClientRect();
  const dr = dock().getBoundingClientRect();
  const a = anchor.getBoundingClientRect();

  // Cleared first: the edge may have changed since this node was last placed,
  // and a stale `bottom` fights a fresh `top`.
  node.style.left = node.style.right = node.style.top = node.style.bottom = 'auto';
  node.style.left = '0px';
  node.style.top = '0px';
  const w = node.offsetWidth;
  const h = node.offsetHeight;
  const GAP = 10;

  if (isVertical()) {
    // Centred on the icon along the dock, and just clear of the dock across it.
    node.style.top = clamp(a.top + a.height / 2 - h / 2 - zr.top, 12,
      Math.max(12, zr.height - h - 12)) + 'px';
    node.style.left = (S.dockEdge === 'left'
      ? dr.right - zr.left + GAP
      : dr.left - zr.left - w - GAP) + 'px';
  } else {
    node.style.left = clamp(a.left + a.width / 2 - w / 2 - zr.left, 12,
      Math.max(12, zr.width - w - 12)) + 'px';
    node.style.top = (S.dockEdge === 'top'
      ? dr.bottom - zr.top + GAP
      : dr.top - zr.top - h - GAP) + 'px';
  }
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

/* ---------- bulk import ----------
   One import, two ways in: a bookmarks file exported from a browser, or a
   pasted list of links. Both end up as the same {url, title} array so there is
   only one piece of code that actually creates anything. */

/** A ceiling on one import. A browser export can hold tens of thousands of
 *  links, and a dock folder with that many in it stops being a dock and starts
 *  being a reason every render is slow. Anything over this is reported rather
 *  than silently dropped. */
export const IMPORT_CAP = 2000;

/** Pull the links out of a Netscape bookmark file — the format Chrome, Firefox,
 *  Safari and Edge all export, and the only thing anyone means by "my
 *  bookmarks file".
 *
 *  Parsed with DOMParser rather than a regex, because the format is loose in
 *  practice — unclosed <DT>, stray <p>, attributes in any order — which is
 *  exactly the case an HTML parser handles and a pattern does not. DOMParser
 *  does not run scripts, and the parsed document is never attached to this one:
 *  only `href` and `textContent` are read out of it, so nothing from a file
 *  somebody downloaded reaches the page as markup.
 *
 *  The folder structure is deliberately flattened. The dock is a row of icons,
 *  and rebuilding a nested tree inside it would produce a dock made mostly of
 *  folders. Chrome's own bookmark manager already imports these files with the
 *  hierarchy intact, for anyone who wants that instead. */
export function parseBookmarksFile(html) {
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  const out = [];
  for (const a of doc.querySelectorAll('a[href]')) {
    // normalizeURL rejects anything that is not http(s), which is what drops
    // the bookmarklets, `place:` queries and chrome:// entries these files are
    // usually full of.
    const url = normalizeURL(a.getAttribute('href'));
    if (!url) continue;
    out.push({ url, title: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300) });
  }
  return out;
}

/** One link per line. Bare hosts are fine — normalizeURL adds the scheme, the
 *  same as typing one into the add-bookmark box. Returns the valid entries and
 *  a count of the lines that were not links, so the caller can say so rather
 *  than quietly importing four of someone's six lines. */
export function parseLinkList(text) {
  const entries = [];
  let invalid = 0;
  for (const line of String(text).split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    const url = normalizeURL(raw);
    if (url) entries.push({ url, title: '' });
    else invalid++;
  }
  return { entries, invalid };
}

/** Create many bookmarks in whichever folder feeds the dock.
 *
 *  Sequential, not Promise.all: a few hundred parallel creates gain nothing —
 *  the API applies them in order anyway — while making it impossible to say
 *  which one failed. The loop yields periodically so the page keeps painting;
 *  without that an import of a thousand links freezes the tab for the whole
 *  run, which looks exactly like a crash.
 *
 *  Returns what happened rather than toasting, so the caller can report it in
 *  its own words. */
export async function importBookmarks(entries, onProgress) {
  const parentId = activeFolder();
  const existing = await readFolder(parentId);
  // Deduped against what is already in the folder, and against the rest of the
  // file. Importing the same export twice is the obvious thing for somebody to
  // try, and doubling every icon is a poor answer to it.
  const seen = new Set(existing.map(n => n.url).filter(Boolean));

  const queue = [];
  let skipped = 0;
  for (const e of entries) {
    if (!e?.url) continue;
    if (seen.has(e.url)) { skipped++; continue; }
    seen.add(e.url);
    queue.push(e);
  }

  const overflow = Math.max(0, queue.length - IMPORT_CAP);
  const batch = queue.slice(0, IMPORT_CAP);
  let added = 0, failed = 0;

  for (let i = 0; i < batch.length; i++) {
    const { url, title } = batch[i];
    try {
      await chrome.bookmarks.create({ parentId, title: title || hostOf(url), url });
      added++;
    } catch {
      // One rejected link must not abandon the rest of the import.
      failed++;
    }
    if ((i & 31) === 31) {
      onProgress?.(i + 1, batch.length);
      await new Promise(r => setTimeout(r, 0));
    }
  }

  await renderDock();
  return { added, skipped, overflow, failed, shown: nodes.length };
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
