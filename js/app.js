// Bootstrap: build the stage, wire shortcuts, own the drag layout.
import { $, $$, el, clamp, toast, dropCache, openIncognito } from './util.js';
import { WALLPAPERS, WIDGET_SIZE, WIDGET_SCALE, CANON, widgetSize } from './config.js';
import { S, loadSettings, set, setWidget, onChange, isHttpURL } from './state.js';
import { initTheme, applyTheme, attachSheen } from './theme.js';
import { initDock, applyDockSettings, renderDock } from './dock.js';
import { initPalette } from './palette.js';
import { initSpaces, renderSpaces, spaceList, activeSpace, switchTo } from './spaces.js';
import { initSettings } from './settings.js';
import { REGISTRY } from './widgets/index.js';
import { initArcade } from './arcade.js';
import { initI18n, onLocaleChange, translateDOM, t } from './i18n.js';
import { ACTIONS, actionFor, bookmarkFor, keyLabel, resolve as resolveKey } from './keys.js';

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
    // setWidget updates S synchronously and only the trip to disk is deferred,
    // so doing it first is what lets relayout() below see the new size and
    // re-divide left/top by the zoom that goes with it. The other order
    // measured against the size being replaced.
    const written = setWidget(id, { size: WIDGET_SIZE.default });
    applySize(panel, WIDGET_SIZE.default);
    relayout();
    await written;
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
    let pct = z0 * 100;

    /* Where the panel actually sits, captured once so it can be held there.
       A resize should grow the panel, not move it.

       relayout() writes left/top in pixels pre-divided by the panel's zoom,
       because a pixel offset is resolved in the panel's own zoomed space and
       multiplied by that zoom again on the way to the screen. The division is
       done with the STORED size, so the moment this drag changes the zoom the
       offsets are stale by the ratio of the two and the panel travels
       (newZoom / oldZoom) times its own offset — a widget 1300px down the page
       grown to 150% was thrown 650px further down, then snapped back on
       release when relayout() rewrote the offsets. Re-divide by the LIVE zoom
       on every step instead.

       Percentages are immune: measured in Chrome, `left:10%` renders at the
       same pixel at any zoom while `left:80px` scales 1:1 with it. So a
       centre-anchored `left:50%` is recognised and left alone rather than
       converted to pixels, which would drop the centring. */
    const startZ = zoomOf(panel);
    const pxVal = v => (v || '').endsWith('px') ? parseFloat(v) : null;
    const l0 = pxVal(panel.style.left), t0 = pxVal(panel.style.top);
    const realL = l0 == null ? null : l0 * startZ;
    const realT = t0 == null ? null : t0 * startZ;

    // Kept off .dragging on purpose: that class also carries scale(1.03) and a
    // z-index lift, which belong to a move and not to a resize. relayout()
    // treats the two the same way, which is all that is needed here.
    panel.classList.add('resizing');
    try { grip.setPointerCapture(e.pointerId); } catch {}

    /* One write per frame. A high-polling-rate mouse delivers pointermove
       several times per refresh, and every one of these invalidates layout for
       the panel and for both counter-zoomed badges — work that is thrown away
       by the next event before anything is painted. */
    let frame = 0;
    const paint = () => {
      frame = 0;
      applySize(panel, pct);
      const z = zoomOf(panel) || 1;
      if (realL != null) panel.style.left = (realL / z).toFixed(2) + 'px';
      if (realT != null) panel.style.top = (realT / z).toFixed(2) + 'px';
    };

    const move = ev => {
      // The zoom that puts the corner back under the pointer, taken across
      // both axes together so the longer edge leads.
      // The pointer moves in real pixels, the value being solved for is in
      // stored-size space, so the delta is divided back through the viewport
      // factor or the grip tracks the cursor at the wrong rate on a big screen.
      const dz = ((ev.clientX - x0) * spread + (ev.clientY - y0)) / (baseW + baseH) / vp;
      // Fractional while the drag is live, rounded only on release. Rounding
      // here quantised the panel to whole percent, which on a 380px widget is
      // a ~4px jump per step — the stair-stepping read as the resize being
      // coarse rather than as the deliberate 1% granularity of the setting.
      pct = clamp((z0 + dz) * 100, WIDGET_SIZE.min, WIDGET_SIZE.max);
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const up = async () => {
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      // Never removed before, so every resize left another one behind, each
      // holding a stale `pct` from its own drag and each able to fire later.
      grip.removeEventListener('pointercancel', up);
      panel.classList.remove('resizing');

      pct = clamp(Math.round(pct), WIDGET_SIZE.min, WIDGET_SIZE.max);
      applySize(panel, pct);
      // Before relayout, so the pass sees the size it is meant to measure
      // against — S is updated synchronously and only the write is deferred.
      const written = setWidget(id, { size: pct });
      // Growing downward can run a panel under the dock or off the bottom, and
      // this is also what puts left/top back on the layout's own terms.
      relayout();
      await written;
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
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
  // Which edge to keep clear of, or null when there is nothing to avoid — an
  // auto-hidden dock is not on screen, and a hand-placed widget is where the
  // user put it.
  const edge = (placed || S.dockAutohide) ? null : S.dockEdge;
  const minX = edge === 'left' ? reserve : 8;
  const right = innerWidth - (edge === 'right' ? reserve : 8);
  const minY = edge === 'top' ? reserve : 12;
  const bottom = innerHeight - (edge === 'bottom' ? reserve : 12);
  return {
    minX, maxX: Math.max(minX, right - w),
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
      // Either kind of drag. A move owns left/top; a resize owns the zoom, and
      // with it the pixel offsets that are divided by that zoom. Both have to
      // be left alone until the pointer is released, or this pass re-applies
      // the STORED size and snaps the panel back between two pointermoves.
      dragging: el.classList.contains('dragging') || el.classList.contains('resizing'),
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
  // Keep clear of a dock along the left or right edge.
  //
  // The anchoring pass above reserves space vertically only — it grew up around
  // a dock that was always along the bottom, and `dockLine` is the whole of its
  // notion of "the dock is in the way". Reworking that to be edge-aware is a
  // much larger change than it is worth, so the horizontal result is clamped
  // here instead. Bottom and top docks are untouched: their reserve is already
  // in `dockLine`.
  const sideDock = !S.dockAutohide && (S.dockEdge === 'left' || S.dockEdge === 'right');
  const minLeft = sideDock && S.dockEdge === 'left' ? reserve : 8;
  const maxRight = innerWidth - (sideDock && S.dockEdge === 'right' ? reserve : 8);

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
      // Clamped in real pixels, before the zoom conversion below.
      const w = it.w0 * fitScale;
      const x = clamp(it.left, minLeft, Math.max(minLeft, maxRight - w));
      const lp = Math.round(x / div) + 'px';
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
/* ---------------- alignment guides ----------------

   While a panel is being dragged, its left/centre/right and top/middle/bottom
   are matched against the same lines on every other panel, and against the
   middle of the window. The nearest match within SNAP_PX pulls the panel onto
   it and draws a line there.

   Deliberately soft, because a layout tool that decides where things go is
   worse than no tool at all:

     - the pull is only SNAP_PX wide, and is recomputed from the raw pointer
       position on every single move. There is no captured "snapped" state to
       break out of — move further than the threshold and the panel is simply
       wherever the cursor is;
     - holding Shift turns it off for the length of a drag;
     - the whole thing is a setting, off in one click;
     - nothing here ever moves a panel that is not being dragged, and nothing
       is written to storage that was not already written by the drop.

   A grid would be the other way to do this, and is the thing being avoided:
   it constrains every position instead of offering the handful that are
   actually meaningful. */
const SNAP_PX = 6;

let guides = null;
function guideEls() {
  if (guides) return guides;
  // Built here rather than in newtab.html: the dev harness renders its own
  // copy of the body, so markup added there has to be added twice and drifts.
  const mk = cls => {
    const g = el('div', { class: 'align-guide ' + cls, 'aria-hidden': 'true' });
    document.body.append(g);
    return g;
  };
  guides = { v: mk('v'), h: mk('h') };
  return guides;
}

/** At most one line per axis; null hides that one. */
function drawGuides(x, y) {
  const g = guideEls();
  // Only written when the value actually changes. This runs on every
  // pointermove, and assigning a style the element already has still costs a
  // style invalidation.
  const line = (node, pos, prop) => {
    if (pos == null) {
      if (node.style.display !== 'none') node.style.display = 'none';
      return;
    }
    const px = Math.round(pos) + 'px';
    if (node.style.display !== 'block') node.style.display = 'block';
    if (node.style[prop] !== px) node.style[prop] = px;
  };
  line(g.v, x, 'left');
  line(g.h, y, 'top');
}

const hideGuides = () => { if (guides) drawGuides(null, null); };

/** The lines a drag can snap to.
 *
 *  Measured once, at pointerdown: nothing else moves while a drag is running,
 *  and re-reading every panel's rect on every pointermove would force a layout
 *  per panel per event. getBoundingClientRect is right here rather than
 *  offsetWidth — these are real screen positions, so the panels' own zoom has
 *  to be in them. */
function snapTargets(dragged) {
  const vx = [{ pos: innerWidth / 2, mid: true }];
  const hy = [{ pos: innerHeight / 2, mid: true }];
  for (const p of $$('.widget')) {
    if (p === dragged) continue;
    const r = p.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    vx.push({ pos: r.left }, { pos: r.left + r.width / 2 }, { pos: r.right });
    hy.push({ pos: r.top }, { pos: r.top + r.height / 2 }, { pos: r.bottom });
  }
  return { vx, hy };
}

/** The nearest line within the threshold, or null.
 *
 *  `anchors` are the dragged panel's own three lines on that axis, in the
 *  order start / centre / end. Ties keep the first found, and the middle of
 *  the window is first in the list, so centring wins over an edge that merely
 *  happens to sit in the same place. */
function bestSnap(anchors, targets) {
  let best = null;
  for (const target of targets) {
    for (let i = 0; i < anchors.length; i++) {
      const d = target.pos - anchors[i];
      if (Math.abs(d) <= SNAP_PX && (!best || Math.abs(d) < Math.abs(best.d))) {
        best = { d, pos: target.pos, mid: !!target.mid, anchor: i };
      }
    }
  }
  return best;
}

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
    // Taken before .dragging adds scale(1.03), so the lines are the panel's
    // real edges rather than the lifted ones.
    const targets = S.snapGuides ? snapTargets(panel) : { vx: [], hy: [] };
    // Whether the drop landed the panel's own centre on the middle of the
    // window, which is the one snap that means something after the drag ends.
    let centreSnapped = false;
    panel.classList.add('dragging');
    try { panel.setPointerCapture(e.pointerId); } catch {}

    const move = ev => {
      if (Math.abs(ev.clientX - e.clientX) > 3 || Math.abs(ev.clientY - e.clientY) > 3) moved = true;
      // Dragging IS placing it, so this gets the full viewport — and matches
      // what relayout will allow once the drop is recorded as placed.
      const b = layoutBounds(w, h, true);
      let x = clamp(ev.clientX - offX, b.minX, b.maxX);
      let y = clamp(ev.clientY - offY, b.minY, b.maxY);

      let gx = null, gy = null;
      centreSnapped = false;
      // Shift suspends the guides mid-drag, for when you want a panel a few
      // pixels off a neighbour and the pull keeps taking it back.
      if (S.snapGuides && !ev.shiftKey) {
        const sx = bestSnap([x, x + w / 2, x + w], targets.vx);
        if (sx) {
          const nx = clamp(x + sx.d, b.minX, b.maxX);
          // Only when the clamp left it alone. A guide drawn at a line the
          // panel is not allowed to reach is a line it never touches.
          if (Math.abs(nx - x - sx.d) < 0.5) {
            x = nx;
            gx = sx.pos;
            centreSnapped = sx.mid && sx.anchor === 1;
          }
        }
        const sy = bestSnap([y, y + h / 2, y + h], targets.hy);
        if (sy) {
          const ny = clamp(y + sy.d, b.minY, b.maxY);
          if (Math.abs(ny - y - sy.d) < 0.5) { y = ny; gy = sy.pos; }
        }
      }
      drawGuides(gx, gy);

      panel.style.left = (x / innerWidth * 100).toFixed(2) + '%';
      panel.style.top = (y / innerHeight * 100).toFixed(2) + '%';
    };
    const up = async () => {
      panel.removeEventListener('pointermove', move);
      panel.removeEventListener('pointerup', up);
      panel.classList.remove('dragging');
      hideGuides();
      if (!moved) {
        // A click, not a drag. Put back exactly what was there and write
        // nothing — a panel you merely touched should be unchanged.
        panel.style.left = wasLeft;
        panel.style.transform = wasTransform;
        panel.dataset.anchor = wasAnchor;
        panel.dataset.placed = wasPlaced;
        return;
      }
      // Dropped with its own centre on the middle of the window: give centre
      // anchoring back, rather than leaving a panel that looks centred until
      // the window is next resized and then drifts. A drag is what takes that
      // anchoring away, so reaching for the centre guide is the only way to
      // ask for it again — and it is unmistakably what the gesture meant.
      if (centreSnapped) {
        panel.style.left = '50%';
        panel.style.transform = 'translateX(-50%)';
      }
      panel.dataset.ay = parseFloat(panel.style.top);   // dropping it here sets a new intent
      panel.dataset.ax = parseFloat(panel.style.left);
      panel.dataset.anchor = centreSnapped ? 'center' : '';
      panel.dataset.placed = '1';
      await setWidget(id, {
        x: parseFloat(panel.style.left),
        y: parseFloat(panel.style.top),
        anchor: centreSnapped ? 'center' : null,
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
    // A pointer sequence does not always end in pointerup — a system gesture or
    // a touch-scroll can cancel it. Without this the panel keeps the `dragging`
    // class, and relayout() reads that class to decide what to skip, so the
    // widget silently stops resizing and stops being repositioned for the rest
    // of the session with nothing on screen to explain it.
    panel.addEventListener('pointercancel', up);
  });
}

function toggleEdit() {
  const r = document.documentElement;
  const on = r.dataset.edit !== 'on';
  r.dataset.edit = on ? 'on' : 'off';
  toast(on ? 'Edit mode — drag panels to move them' : 'Layout locked');
}

/* ---------------- shortcuts ----------------
   What each action does. Which key runs it lives in settings (⚙ → Shortcuts)
   and is resolved per keypress, so a rebind takes effect immediately and
   without re-registering anything. */
const RUN = {
  palette:   () => window.dispatchEvent(new Event('lgt:palette')),
  search:    () => $('.w-search')?._focus?.(),
  settings:  () => window.dispatchEvent(new Event('lgt:settings')),
  edit:      () => toggleEdit(),
  wallpaper: () => window.dispatchEvent(new Event('lgt:cycle-wallpaper')),
  dock:      () => set({ dockAutohide: !S.dockAutohide }).then(applyDockSettings),
  incognito: () => openIncognito(),
  help:      () => toast(shortcutSummary()),
  space:     () => {
    const list = spaceList();
    // One homescreen is the default state, and cycling within a list of one
    // looks like a dead key rather than like nothing to cycle to.
    if (list.length < 2) { toast(t('There is only one homescreen.')); return; }
    const i = list.findIndex(s => s.id === activeSpace()?.id);
    switchTo(list[(i + 1) % list.length].id);
  },
  perf:      async () => {
    await set({ lowPerf: !S.lowPerf });
    applyTheme();
    applyDockSettings();
    // The mode changes how the whole page looks, so saying which way it went
    // is not chatter — from a keypress there is otherwise nothing to confirm
    // that the flatter interface was asked for rather than broken.
    toast(S.lowPerf ? t('Low performance mode on') : t('Low performance mode off'));
  },
};

/** The help toast, built from what is actually bound. It used to be a hardcoded
 *  string, which was fine until the keys could move — then it would have been a
 *  list of shortcuts that confidently named the wrong keys. */
function shortcutSummary() {
  const parts = [];
  for (const a of ACTIONS) {
    if (a.id === 'help') continue;              // you are reading it
    const b = resolveKey(S.keys, a.id);
    if (b) parts.push(`${keyLabel(b)} ${t(a.label).toLowerCase()}`);
  }
  return parts.join(' · ') || t('No shortcuts are set.');
}

function initKeys() {
  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)
      || document.activeElement?.isContentEditable;
    const id = actionFor(S.keys, e, typing);
    if (id && RUN[id]) {
      // Every one of these replaces whatever the key would otherwise do — `/`
      // opens Chrome's quick-find, `,` types a comma into nothing.
      e.preventDefault();
      RUN[id]();
      return;
    }
    // Actions win a tie. They cannot actually tie, because the drawer refuses
    // a binding either set already holds — but an imported settings file is
    // not bound by the drawer, so the order here is the tie-break.
    const bm = bookmarkFor(S.bookmarkKeys, e, typing);
    // Re-checked at the point of navigation rather than trusted from storage,
    // for the same reason sanitize checks it on the way in.
    if (bm && isHttpURL(bm.url)) {
      e.preventDefault();
      location.href = bm.url;
    }
  });
}

/** The floating buttons in the top corner, both of which can be turned off.
 *
 *  Lives here rather than in dock.js even though the setting sits on the Dock
 *  tab: the gear appears twice, once on the dock and once up here, and hiding
 *  only one of them would read as the setting not working. dock.js owns its
 *  own copy; this owns these two. */
function applyChrome() {
  $('#btn-settings').hidden = !S.showSettingsBtn;
  $('#btn-edit').hidden = !S.showEditBtn;
}

/* ---------------- app events ---------------- */
function initEvents() {
  window.addEventListener('lgt:edit', toggleEdit);
  // An event rather than a direct call: settings.js does not import this file,
  // and adding that edge would make a cycle out of what is currently a line.
  window.addEventListener('lgt:chrome', applyChrome);
  applyChrome();

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
      if (S.activeSpace !== before) renderDock();
    });
  });
}

/* ---------------- go ---------------- */
(async function main() {
  await loadSettings();
  // Before anything renders. `t` is synchronous, so the catalogue has to be in
  // memory by the time the first label is built — otherwise the page paints in
  // English and then flips, which is the same class of flash early.js exists to
  // remove.
  await initI18n();
  initTheme();
  initEvents();
  initKeys();
  initPalette();
  initArcade();
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
    if (keys.includes('*')) rebuildWidgets();
  });

  // Changing language rebuilds every surface that holds a translated string.
  // The same set the cross-tab settings listener refreshes, for the same
  // reason: these are built once from strings, not bound to them.
  onLocaleChange(() => {
    translateDOM();
    rebuildWidgets();
    applyDockSettings();
    renderDock();
    renderSpaces();
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
