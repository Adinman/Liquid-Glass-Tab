// Bootstrap: build the stage, wire shortcuts, own the drag layout.
import { $, $$, el, clamp, toast, dropCache, openIncognito } from './util.js';
import { WALLPAPERS, WIDGET_SIZE, WIDGET_SCALE, CANON, widgetSize } from './config.js';
import { S, loadSettings, set, setWidget, onChange } from './state.js';
import { initTheme, applyTheme, attachSheen } from './theme.js';
import { initDock, applyDockSettings, renderDock } from './dock.js';
import { initPalette } from './palette.js';
import { initSpaces, renderSpaces } from './spaces.js';
import { initSettings } from './settings.js';
import { REGISTRY } from './widgets/index.js';
import { initFX, refreshScene } from './fx.js';
import { initPro, isPro, onProChange } from './pro.js';

const stage = () => $('#stage');
const teardown = new Map();   // widget id -> cleanup fn

/* ---------------- widgets ---------------- */
function buildWidget(id) {
  const def = REGISTRY[id];
  const cfg = S.widgets[id];
  if (!def || !cfg?.on) return;

  // `bare` widgets render their own content with no glass panel, header or
  // padding around it — currently just the visualiser.
  const bare = !!def.bare;
  const panel = el('div', {
    class: [bare ? 'bare' : 'glass', 'widget', def.className || ''].join(' ').trim(),
    dataset: { id },
    style: { animationDelay: (Object.keys(REGISTRY).indexOf(id) * 28) + 'ms' },
  });
  if (!bare) attachSheen(panel);
  panel.append(el('div', { class: 'drag-badge', text: '✥' }));
  panel.append(sizeHandle(panel, id));

  let cleanup = () => {};
  try { cleanup = def.render(panel) || (() => {}); }
  catch (e) {
    panel.append(el('div', { class: 'muted', style: { fontSize: '12px' }, text: `“${id}” failed: ${e.message}` }));
    console.error(`[cgt] widget ${id}`, e);
  }
  teardown.set(id, cleanup);

  place(panel, cfg);
  makeDraggable(panel, id);
  stage().append(panel);
  sizeWatch.observe(panel);
}

function place(panel, cfg) {
  panel.style.left = (cfg.x ?? 10) + '%';
  panel.style.top = (cfg.y ?? 10) + '%';
  // Remember where the widget is *meant* to sit. relayout measures from this
  // rather than from wherever it currently is, so a panel pushed up by growing
  // content drops back once the content shrinks again.
  panel.dataset.ay = cfg.y ?? 10;
  // Whether the user put it here by hand. Decides if relayout is allowed to
  // move it clear of the dock — see layoutBounds.
  panel.dataset.placed = cfg.placed ? '1' : '';
  // The intended x, for the same reason dataset.ay exists. Horizontal clamping
  // used to measure from wherever the panel currently was, which ratchets: a
  // narrow window shoves every panel left, and widening it again left them
  // there because nothing remembered where they were meant to be.
  panel.dataset.ax = cfg.x ?? 10;
  panel.dataset.anchor = cfg.anchor === 'center' ? 'center' : '';
  panel.style.transform = cfg.anchor === 'center' ? 'translateX(-50%)' : '';
  applySize(panel, widgetSize(cfg));
}

/* ---------------- widget size ----------------
   Size is a CSS `zoom` on the panel, not a `transform: scale`. Measured in
   Chrome against a control that proves the test can actually see a dead
   backdrop (a parent with `filter` or `opacity < 1` flattens the glass):

     - zoom is not a backdrop root, so the panel keeps sampling the wallpaper;
     - a percentage `left`/`top` lands on the same pixel zoomed or not — the
       percentage resolves in the element's own scaled space and is scaled
       back — so no stored position needs recomputing when the size changes;
     - the layout box genuinely changes, so the widgets that size to their
       content (weather, news, lyrics, notes, quote) still do, at the same
       proportions, and text is re-laid out rather than stretched.

   `transform: scale` fails the last two: it grows about the panel's centre,
   walking a positioned panel off its anchor, and leaves offsetWidth reporting
   the unscaled box — which is what the drag maths measures.

   The catch to remember: offsetWidth/offsetHeight are in the panel's own
   pixels and ignore zoom, while getBoundingClientRect() is in real ones.
   Anything measuring a panel against the viewport has to scale. */
const zoomOf = panel => parseFloat(panel.style.zoom) || 1;

/** Set by relayout(). 1 unless the window is too small for the layout, in
 *  which case everything shrinks together by this factor. Never above 1. */
let fitScale = 1;

function applySize(panel, pct) {
  // Two factors: what the user set for this widget, and how much the window is
  // forcing everything to shrink. Kept separate on purpose — the stored size
  // must never absorb the fit factor, or resizing would rewrite saved sizes.
  const z = clamp(pct, WIDGET_SIZE.min, WIDGET_SIZE.max) / 100 * fitScale;
  if (Math.abs(zoomOf(panel) - z) > 1e-4) panel.style.zoom = z;

  // The badges are controls, not content. Counter-zoom them so the grab
  // targets stay one physical size — a 50% widget otherwise gets an 11px
  // grip. Their own offsets scale with their own zoom, so they stay pinned
  // to the corner rather than drifting inward.
  const inv = z === 1 ? '' : (1 / z).toFixed(4);
  for (const b of panel.querySelectorAll(':scope > .drag-badge, :scope > .size-badge')) {
    if (b.style.zoom !== inv) b.style.zoom = inv;
  }
}

/** The bottom-right resize grip. Shown in edit mode only, same as the move
 *  badge. The Alt check below mirrors the move drag's guard, but unlike the
 *  panel the grip is display:none outside edit mode, so Alt alone can't reach
 *  it — it's there so the guard stays correct if that CSS ever changes. */
function sizeHandle(panel, id) {
  const grip = el('div', { class: 'size-badge', text: '⤡',
    title: 'Drag to resize · double-click for 100%' });

  grip.addEventListener('dblclick', async e => {
    e.stopPropagation();
    applySize(panel, WIDGET_SIZE.default);
    relayout();
    await setWidget(id, { size: WIDGET_SIZE.default });
  });

  grip.addEventListener('pointerdown', e => {
    if (document.documentElement.dataset.edit !== 'on' && !e.altKey) return;
    e.preventDefault();
    e.stopPropagation();          // or the panel starts a move drag underneath

    // Stored size, not the on-screen zoom: the panel's actual zoom includes the
    // viewport factor, and feeding that back in would bake the window size into
    // the saved value — every resize would silently rewrite it.
    const vp = fitScale;
    const z0 = widgetSize(S.widgets[id]) / 100;
    // Unzoomed reference: offsetWidth ignores zoom, the .dragging scale(1.03)
    // and any in-flight entry animation, so it holds still while the corner
    // moves. Deriving it from the rect instead would feed the resize back
    // into itself.
    const baseW = panel.offsetWidth, baseH = panel.offsetHeight;
    // A centre-anchored panel grows away from the middle both ways, so its
    // right edge only travels half the width it gains.
    const spread = panel.style.transform.includes('translateX') ? 2 : 1;
    const x0 = e.clientX, y0 = e.clientY;
    let pct = Math.round(z0 * 100);
    try { grip.setPointerCapture(e.pointerId); } catch {}

    const move = ev => {
      // The zoom that puts the corner back under the pointer, taken across
      // both axes together so the longer edge leads.
      // The pointer moves in real pixels, the value being solved for is in
      // stored-size space, so the delta is divided back through the viewport
      // factor or the grip tracks the cursor at the wrong rate on a big screen.
      const dz = ((ev.clientX - x0) * spread + (ev.clientY - y0)) / (baseW + baseH) / vp;
      pct = clamp(Math.round((z0 + dz) * 100), WIDGET_SIZE.min, WIDGET_SIZE.max);
      applySize(panel, pct);
    };
    const up = async () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      // Growing downward can run a panel under the dock or off the bottom.
      // Nothing else re-clamps: a zoom change leaves the layout box alone, so
      // the ResizeObserver never fires for it.
      relayout();
      await setWidget(id, { size: pct });
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });

  return grip;
}

export function rebuildWidgets() {
  for (const [, fn] of teardown) { try { fn(); } catch {} }
  teardown.clear();
  sizeWatch.disconnect();
  stage().innerHTML = '';
  for (const id of Object.keys(REGISTRY)) buildWidget(id);
  keepInView();
}

/** The box a panel of this size may occupy.
 *
 *  There are two limits, and which one applies depends on how the panel got
 *  where it is:
 *
 *    - the viewport, always;
 *    - room for the dock, only for panels the user has *not* placed by hand.
 *
 *  The dock reserve exists so a widget that grows after mount — weather and
 *  news especially — doesn't slide under the dock. It was never meant to
 *  overrule a deliberate drag, and applying it to both made the bottom ~190px
 *  of the screen unusable. A panel the user dragged somewhere stays there;
 *  only automatic repositioning keeps clear of the dock.
 *
 *  The drag handler and relayout must agree for a given panel, or a drop
 *  lands somewhere clamping will silently move it away from on the next
 *  rebuild. */
function layoutBounds(w, h, placed = false) {
  const reserve = S.dockAutohide ? 14 : (S.dockSize || 56) + 42;
  const dockTop = !placed && S.dockEdge === 'top' && !S.dockAutohide;
  const dockBottom = !placed && S.dockEdge === 'bottom' && !S.dockAutohide;
  const minY = dockTop ? reserve : 12;
  const bottom = innerHeight - (dockBottom ? reserve : 12);
  return {
    minX: 8, maxX: Math.max(8, innerWidth - w - 8),
    minY, maxY: Math.max(minY, bottom - h),
  };
}

const wasPlaced = panel => panel.dataset.placed === '1';

// A widget growing once its data arrives can start overlapping its neighbour,
// which is a whole-layout question now rather than a per-panel one. Debounced,
// because several widgets finish fetching at once.
const sizeWatch = new ResizeObserver(() => scheduleRelayout());

/* ---------------- layout pass ----------------
   Positions are stored as percentages of the viewport, while widget heights are
   fixed pixels. So the GAPS between widgets shrink with the window and the
   widgets themselves do not, and below some height they simply collide.
   Measured on the shipped layout: weather stops clearing news below a 903px
   viewport, and the clock stops clearing the search bar below 750px — a
   1366x768 laptop already overlaps.

   Per-panel clamping cannot see any of that: it clamps one panel against the
   and has no idea another panel is there, so it will happily hold two widgets
   perfectly in view and perfectly on top of each other.

   This pass does the two things that actually help, in the order that matters:

     1. Shrink everything together, if that is enough to make it fit. Only ever
        down, never up — scaling up was the first attempt at this and it made a
        wide short window worse, because it keyed off width.
     2. Push whatever still collides downward, in reading order.

   Both are display-time only. dataset.ax/ay keep the position you chose, so the
   moment the window has room again everything springs back to exactly where you
   put it, and nothing here is ever written to storage. */

/** The scale at which the tallest column of widgets fits the usable height. */
function computeFit(items, avail) {
  const cols = [];
  for (const it of [...items].sort((a, b) => a.aLeft - b.aLeft)) {
    const left = it.aLeft;
    const right = it.aRight;   // current-width extents, so columns group as drawn
    // Same column = horizontally overlapping. Those are the ones that can
    // collide vertically, so their stacked height is what has to fit.
    const col = cols.find(c => Math.min(c.right, right) - Math.max(c.left, left) > 2);
    if (col) {
      col.left = Math.min(col.left, left);
      col.right = Math.max(col.right, right);
      col.h += it.h0 + WIDGET_SCALE.gap;
    } else {
      cols.push({ left, right, h: it.h0 + WIDGET_SCALE.gap });
    }
  }
  const need = Math.max(1, ...cols.map(c => c.h));
  const byHeight = avail / need;

  // And the same question horizontally: how far must everything shrink before
  // each widget fits beside its own percentage position. Three columns of
  // fixed-width widgets do not fit in a half-width window, and without this
  // they kept full size and ran into each other — which is what sent the search
  // bar down under the weather panel. Asked per widget rather than across the
  // whole span, because it is the widget furthest right that binds.
  let byWidth = 1;
  for (const it of items) {
    const room = it.centred
      ? innerWidth - 16
      : innerWidth - 8 - (it.xPct / 100 * innerWidth);
    byWidth = Math.min(byWidth, room / Math.max(1, it.w0));
  }

  return clamp(Math.min(byHeight, byWidth), WIDGET_SCALE.min, 1);
}

function relayout() {
  const panels = $$('.widget');
  if (!panels.length) return;

  const reserve = S.dockAutohide ? 14 : (S.dockSize || 56) + 42;
  const top0 = 12;
  const bottomFree = Math.max(top0 + 60, innerHeight - 12);
  const dockLine = Math.max(top0 + 60, innerHeight - reserve);

  // Every widget is measured twice: as it is now, and as it was in the window
  // it was arranged in. The second one is what the anchors are derived from.
  const items = panels.map(el => {
    const cfg = S.widgets[el.dataset.id] || {};
    const uz = widgetSize(cfg) / 100;
    const vw = Number(cfg.vw) > 0 ? Number(cfg.vw) : CANON.w;
    const vh = Number(cfg.vh) > 0 ? Number(cfg.vh) : CANON.h;
    const w0 = el.offsetWidth * uz;
    const h0 = el.offsetHeight * uz;
    const centred = el.dataset.anchor === 'center';
    // Horizontal is a percentage of the CURRENT width, vertical a pixel offset
    // in the window this was arranged in. They are deliberately different.
    //
    // Vertically the gaps have to be pixels, because widget heights are pixels
    // and a percentage gap stretches away from them. Horizontally the opposite
    // is true: a pixel gap glues each column to its edge, so a half-width
    // window empties out the middle, the columns run into each other, and the
    // push-down below dumps the centre column underneath whatever tall widget
    // it landed on. Percentages simply compress, which is what is wanted.
    const xPct = parseFloat(el.dataset.ax) || 0;
    let aLeft = xPct / 100 * innerWidth;
    if (centred) aLeft -= w0 / 2;
    const aTop = (parseFloat(el.dataset.ay) || 0) / 100 * vh;
    return {
      el, id: el.dataset.id, w0, h0, centred, xPct,
      placed: el.dataset.placed === '1',
      dragging: el.classList.contains('dragging'),
      aLeft, aTop, aRight: aLeft + w0, aBottom: aTop + h0,
      authDock: Math.max(60, vh - reserve),
    };
  });

  fitScale = S.widgetScaleMode === 'window' ? computeFit(items, dockLine - top0) : 1;
  const fitStr = fitScale.toFixed(4);
  if (document.documentElement.style.getPropertyValue('--fit') !== fitStr) {
    document.documentElement.style.setProperty('--fit', fitStr);
  }
  for (const it of items) {
    if (!it.dragging) applySize(it.el, widgetSize(S.widgets[it.id] || {}));
  }

  /* ---- pick each widget's anchor, in the window it was arranged in ----
     Whatever it sits closest to is what it should keep its distance from. A
     widget just above the dock follows the dock; one tucked under another
     follows that one; anything else keeps its gap to the nearer screen edge.
     Only widgets ABOVE can be anchored to, so the graph cannot contain a
     cycle and a single ordered pass resolves it. */
  const overlapsX = (a, b) => Math.min(a.aRight, b.aRight) - Math.max(a.aLeft, b.aLeft) > 2;
  for (const it of items) {
    let best = null;
    for (const other of items) {
      if (other === it || !overlapsX(it, other)) continue;
      if (other.aBottom > it.aTop + 1) continue;               // not above it
      const gap = it.aTop - other.aBottom;
      if (!best || gap < best.gap) best = { gap, other };
    }
    const toTop = it.aTop - top0;
    const toDock = it.authDock - it.aBottom;
    const widgetGap = best ? best.gap : Infinity;

    // Which edge, decided by where the widget's TOP sits in the usable height,
    // not by which gap happens to be smaller. Comparing the gaps sends every
    // TALL widget to the dock — the weather panel is most of the column, so its
    // bottom is near the dock however high its top starts, and it would then
    // follow the dock downward on entering fullscreen while its top pulled away
    // from the top of the screen. Reading the top edge instead says what you
    // would say looking at it: this one starts up there, so it stays up there.
    const midline = (top0 + it.authDock) / 2;
    if (widgetGap <= toTop && widgetGap <= Math.abs(toDock)) {
      it.vAnchor = 'widget'; it.vRef = best.other; it.vGap = widgetGap;
    } else if (it.aTop > midline) {
      it.vAnchor = 'dock'; it.vGap = toDock;
    } else {
      it.vAnchor = 'top'; it.vGap = toTop;
    }

  }

  // Resolve top-down, so a widget's anchor is always already placed.
  const order = [...items].sort((a, b) => a.aTop - b.aTop);
  for (const it of order) {
    const w = it.w0 * fitScale, h = it.h0 * fitScale;
    it.w = w; it.h = h;

    it.left = it.centred ? innerWidth / 2 - w / 2 : it.xPct / 100 * innerWidth;
    it.left = clamp(it.left, 8, Math.max(8, innerWidth - w - 8));

    if (it.vAnchor === 'widget' && it.vRef && it.vRef.top != null) {
      it.top = it.vRef.top + it.vRef.h + it.vGap * fitScale;
    } else if (it.vAnchor === 'dock') {
      it.top = dockLine - it.vGap * fitScale - h;
    } else {
      it.top = top0 + it.vGap * fitScale;
    }
    const limit = it.placed ? bottomFree : dockLine;
    it.top = clamp(it.top, top0, Math.max(top0, limit - h));
  }

  // Safety net. Anchoring keeps the arrangement, but a widget that grew since
  // it was placed can still land on its neighbour, so anything still colliding
  // is pushed clear.
  const done = [];
  for (const b of order) {
    for (let guard = 0; guard < 40; guard++) {
      const hit = done.find(o =>
        Math.min(b.left + b.w, o.left + o.w) - Math.max(b.left, o.left) > 2 &&
        Math.min(b.top + b.h, o.top + o.h) - Math.max(b.top, o.top) > 2);
      if (!hit) break;
      b.top = hit.top + hit.h + WIDGET_SCALE.gap * fitScale;
    }
    done.push(b);
  }

  // Written in pixels, not percentages, because this pass has already decided
  // the exact position and a percentage would be re-resolved by the browser
  // against the new viewport the instant it changes. That is the stretch this
  // whole anchoring model exists to remove: if a resize ever lands before the
  // pass re-runs, percentages spread everything apart in the meantime while
  // pixels simply hold still until the pass corrects them.
  //
  // The drag handler still writes percentages while dragging and reads them
  // back on drop, so the stored intent is unaffected by this.
  for (const it of items) {
    if (it.dragging) continue;
    // Divided by the panel's own zoom. `left`/`top` are resolved in the
    // element's zoomed coordinate space, so a pixel written here is multiplied
    // by the zoom again on the way to the screen — at fit 0.6 the whole layout
    // collapsed into the top-left corner at 0.6x its intended offsets.
    //
    // This is exactly the trap in the widget-size note above: offsetWidth is in
    // the panel's own pixels, getBoundingClientRect is in real ones. Percentages
    // are immune, which is why they worked before and why they are still what
    // the drag handler writes; pixels have to be converted.
    const z = widgetSize(S.widgets[it.id] || {}) / 100 * fitScale;
    const div = z > 0 ? z : 1;
    if (!it.centred) {
      const lp = Math.round(it.left / div) + 'px';
      if (it.el.style.left !== lp) it.el.style.left = lp;
    }
    const tp = Math.round(it.top / div) + 'px';
    if (it.el.style.top !== tp) it.el.style.top = tp;
  }
}

let relayoutTimer = 0;
function scheduleRelayout() {
  clearTimeout(relayoutTimer);
  relayoutTimer = setTimeout(relayout, 60);
}

/* The viewport itself, watched directly.
   `resize` is the obvious signal and it is not a complete one: entering or
   leaving fullscreen, a devtools viewport override, and a window manager
   snapping the window can all change the viewport without a resize event
   arriving when you would expect it. Observing the root element catches every
   one of them, and since the pass writes pixels, a missed signal only delays
   the correction rather than stretching the layout in the meantime. */
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => scheduleRelayout()).observe(document.documentElement);
}
addEventListener('fullscreenchange', scheduleRelayout);

function keepInView() { relayout(); }

/* ---------------- drag layout ---------------- */
function makeDraggable(panel, id) {
  panel.addEventListener('pointerdown', e => {
    const editing = document.documentElement.dataset.edit === 'on';
    if (!editing && !e.altKey) return;
    if (e.target.closest('input, textarea, select, button, a')) return;

    e.preventDefault();

    // Centre-anchored panels (the clock and search bar by default) sit at
    // left:50% with translateX(-50%). Convert that to a plain left offset
    // BEFORE measuring anything. getBoundingClientRect() includes transforms,
    // so measuring first and clearing the transform afterwards left the
    // pointer offset computed against a box half a panel-width from where the
    // panel then was — and releasing without actually moving dropped the
    // anchor while keeping the old x, shunting the panel permanently right by
    // half its width.
    //
    // Both of those writes are provisional. Committing them on a mere click —
    // which is what used to happen, because `up` always persisted — silently
    // converted a centre-anchored panel into an absolutely positioned one and
    // marked it `placed`. Nothing visibly moved, so there was no way to know,
    // and from then on the clock no longer recentred when the window changed
    // size. They are rolled back below unless the pointer actually moves.
    const wasAnchor = panel.dataset.anchor;
    const wasLeft = panel.style.left;
    const wasTransform = panel.style.transform;
    const wasPlaced = panel.dataset.placed;
    let moved = false;

    const pre = panel.getBoundingClientRect();
    panel.style.transform = '';
    panel.style.left = (pre.left / innerWidth * 100).toFixed(2) + '%';

    const r = panel.getBoundingClientRect();
    const offX = e.clientX - r.left, offY = e.clientY - r.top;
    // Untransformed size: .widget.dragging applies scale(1.03), and the entry
    // animation may still be scaling the panel, either of which would skew
    // bounds derived from the rect. offsetWidth is in the panel's own pixels
    // and ignores its zoom, so a resized panel has to be scaled back up to
    // viewport ones or the bounds are wrong by the size factor.
    const z = zoomOf(panel);
    const w = panel.offsetWidth * z, h = panel.offsetHeight * z;
    panel.classList.add('dragging');
    try { panel.setPointerCapture(e.pointerId); } catch {}

    const move = ev => {
      if (Math.abs(ev.clientX - e.clientX) > 3 || Math.abs(ev.clientY - e.clientY) > 3) moved = true;
      // Dragging IS placing it, so this gets the full viewport — and matches
      // what relayout will allow once the drop is recorded as placed.
      const b = layoutBounds(w, h, true);
      const x = clamp(ev.clientX - offX, b.minX, b.maxX);
      const y = clamp(ev.clientY - offY, b.minY, b.maxY);
      panel.style.left = (x / innerWidth * 100).toFixed(2) + '%';
      panel.style.top = (y / innerHeight * 100).toFixed(2) + '%';
    };
    const up = async () => {
      panel.removeEventListener('pointermove', move);
      panel.removeEventListener('pointerup', up);
      panel.classList.remove('dragging');
      if (!moved) {
        // A click, not a drag. Put back exactly what was there and write
        // nothing — a panel you merely touched should be unchanged.
        panel.style.left = wasLeft;
        panel.style.transform = wasTransform;
        panel.dataset.anchor = wasAnchor;
        panel.dataset.placed = wasPlaced;
        return;
      }
      panel.dataset.ay = parseFloat(panel.style.top);   // dropping it here sets a new intent
      panel.dataset.ax = parseFloat(panel.style.left);
      panel.dataset.anchor = '';                       // a drag drops centre anchoring
      panel.dataset.placed = '1';
      await setWidget(id, {
        x: parseFloat(panel.style.left),
        y: parseFloat(panel.style.top),
        anchor: null,
        placed: true,
        // The viewport this was arranged in. Without it the percentages above
        // have no scale, and the gaps this position implies cannot be
        // reproduced at any other window size.
        vw: Math.round(innerWidth),
        vh: Math.round(innerHeight),
      });
    };
    panel.addEventListener('pointermove', move);
    panel.addEventListener('pointerup', up);
  });
}

function toggleEdit() {
  const r = document.documentElement;
  const on = r.dataset.edit !== 'on';
  r.dataset.edit = on ? 'on' : 'off';
  toast(on ? 'Edit mode — drag panels to move them' : 'Layout locked');
}

/* ---------------- shortcuts ---------------- */
function initKeys() {
  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)
      || document.activeElement?.isContentEditable;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault(); window.dispatchEvent(new Event('lgt:palette')); return;
    }
    if (typing) return;

    if (e.key === '/') { e.preventDefault(); $('.w-search')?._focus?.(); }
    else if (e.key.toLowerCase() === 'e') toggleEdit();
    else if (e.key === ',') window.dispatchEvent(new Event('lgt:settings'));
    else if (e.key.toLowerCase() === 'b') set({ dockAutohide: !S.dockAutohide }).then(applyDockSettings);
    else if (e.key.toLowerCase() === 'w') window.dispatchEvent(new Event('lgt:cycle-wallpaper'));
    else if (e.key.toLowerCase() === 'i') openIncognito();
    else if (e.key === '?') toast('Ctrl+K palette · / search · I private window · E edit · , settings · W wallpaper · B dock');
  });
}

/* ---------------- app events ---------------- */
function initEvents() {
  window.addEventListener('lgt:edit', toggleEdit);

  $('#btn-edit').addEventListener('click', toggleEdit);
  $('#btn-settings').addEventListener('click', () => window.dispatchEvent(new Event('lgt:settings')));

  // Turning shrink-to-fit on or off re-applies every widget's zoom in place,
  // rather than rebuilding: rebuildWidgets tears down every widget, which
  // restarts the visualiser's audio graph and re-runs each widget's fetch.
  window.addEventListener('lgt:rescale', relayout);

  window.addEventListener('lgt:reload', () => {
    for (const panel of $$('.widget')) panel._reload?.(true);
  });

  window.addEventListener('lgt:clearcache', async () => {
    await dropCache();
    window.dispatchEvent(new Event('lgt:reload'));
    toast('Cache cleared');
  });

  window.addEventListener('lgt:cycle-wallpaper', async () => {
    const i = WALLPAPERS.findIndex(w => w.id === S.wallpaper);
    const next = WALLPAPERS[(i + 1) % WALLPAPERS.length];
    // The live wallpaper has to go too, exactly as it does when a gradient is
    // clicked in settings. Cycling only the layer underneath a playing video
    // changed nothing you could see, while still clearing the photo selection
    // and announcing a name in a toast — an inert key that quietly threw away
    // a setting.
    const hadVideo = !!S.wallpaperVideo;
    await set({
      wallpaper: next.id,
      wallpaperCustom: '',
      ...(hadVideo ? { wallpaperVideo: '', wallpaperVideoName: '' } : {}),
    });
    applyTheme();
    toast(hadVideo ? `${next.name} — live wallpaper off` : next.name);
  });

  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(relayout, 200);
  });

  // Settings changed in another new tab? Reflect it here.
  // Another tab changed something (including switching homescreen) — follow it.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    // onChanged also fires for this tab's own writes, and re-applying the
    // theme, dock and spaces bar in response to a change we just made is pure
    // waste. Settings are small now that the wallpaper lives elsewhere, so
    // comparing is far cheaper than the rebuild it avoids.
    try {
      if (JSON.stringify(changes.settings.newValue) === JSON.stringify(S)) return;
    } catch { /* fall through and reload */ }

    const before = S.activeSpace;
    loadSettings().then(() => {
      applyTheme();
      applyDockSettings();
      renderSpaces();
      refreshScene(isPro());
      if (S.activeSpace !== before) renderDock();
    });
  });
}

/* ---------------- go ---------------- */
(async function main() {
  await loadSettings();
  initTheme();
  initEvents();
  initKeys();
  initPalette();
  // The licence is one storage read and decides whether the interactive
  // background is allowed to start, so it happens before the settings drawer is
  // built and reads it.
  await initPro();
  initFX();
  // Not awaited: it dynamically imports the scene registry, and a new tab has
  // no business waiting on that to paint.
  refreshScene(isPro());
  // Activating or deactivating in the drawer takes effect on this tab straight
  // away, and on every other open one via the storage listener above.
  onProChange(() => refreshScene(isPro()));
  initSettings(rebuildWidgets);
  rebuildWidgets();
  await initSpaces();
  await initDock();

  // Switching homescreen swaps the dock's bookmarks; the shared widgets stay
  // put, so the layout never needs rebuilding.
  window.addEventListener('lgt:space-changed', renderDock);

  // Belt and braces: widgets that fetch grow a second or two after mount, and
  // a throttled tab may not deliver ResizeObserver callbacks promptly.
  for (const delay of [400, 1500, 4000]) setTimeout(keepInView, delay);

  onChange(keys => {
    if (keys.includes('*')) { rebuildWidgets(); refreshScene(isPro()); }
  });

  // First run: open settings so the user can point weather at their city.
  const seen = await chrome.storage.local.get('welcomed');
  if (!seen.welcomed) {
    await chrome.storage.local.set({ welcomed: true });
    setTimeout(() => {
      window.dispatchEvent(new Event('lgt:settings'));
      toast('Welcome — press ? for shortcuts');
    }, 700);
  }
})();
