/* The arcade: a canvas that sits in the wallpaper stack and runs a game on it.
 *
 * This is the host, not a game. It owns the one <canvas>, the one
 * requestAnimationFrame loop and the one set of input listeners; the things you
 * actually play live in js/games/.
 *
 * This used to also drive ambient "interactive backgrounds" that ran forever
 * behind your widgets. That is gone. Everything here now exists for something
 * the user deliberately started and will deliberately leave, which makes the
 * rules simpler than they were:
 *
 *  1. Nothing runs unless a game is running. No game or a hidden tab and the
 *     rAF is cancelled outright rather than left spinning on an early return.
 *     A new tab page sits open in a background tab far more often than it is
 *     looked at, and a canvas that keeps ticking there is the difference
 *     between a nice feature and a battery complaint in a review.
 *
 *  2. Input listeners exist only while a game is running. They are on `window`,
 *     not the canvas: the canvas sits at the bottom of the stacking order, so
 *     it would never receive a pointer event anyway, and giving it
 *     pointer-events would break clicking the page.
 *
 *  3. Games are factories. `create(host)` returns a fresh object owning its own
 *     state, so starting one twice cannot leave the first one's board behind,
 *     and there is no module-level mutable state to reset.
 *
 * Reduced motion is deliberately not consulted. A game is not decoration — it
 * does not start until you press a button, and freezing it would be a broken
 * game rather than a calmer page.
 */
import { $ } from './util.js';

/* Anything matching this swallows the click: it is UI, not the game. #stage is
   deliberately absent — it covers the whole viewport, so treating it as UI
   would mean the game never saw a click at all. Its children (.widget) are
   what actually matter, and they are click-through during a game anyway. */
const UI_SELECTOR = '.widget,#dock-zone,#spaces,#spaces-popover,#palette-overlay,'
                  + '#settings,#hud,#toast';

/* Retina is worth having; a 3x phone-class ratio on a 4K monitor is four times
   the fill rate for something sitting behind blurred glass. */
const MAX_DPR = 2;

/* And a hard ceiling on total device pixels, because the fill rate is not the
   expensive part - the memory is. A canvas costs width x height x 4 bytes of
   backing store no matter what is drawn on it, so a full-screen one at dpr 2 on
   a 1440p display is 56 MB. 4.2 million pixels caps that at about 17 MB, and it
   is only held while a game is actually on screen. */
const MAX_PIXELS = 4.2e6;
const MIN_SCALE = 0.75;

function scaleFor(w, h) {
  const want = Math.min(MAX_DPR, devicePixelRatio || 1);
  const fit = Math.sqrt(MAX_PIXELS / Math.max(1, w * h));
  return Math.max(MIN_SCALE, Math.min(want, fit));
}

let canvas = null;
let c2d = null;
let raf = 0;
let last = 0;
let game = null;          // the running instance
let gameDef = null;       // its definition
let listening = false;
let REG = null;           // js/games/index.js, imported on demand

/** Live pointer state, in CSS pixels relative to the viewport. Starts far
 *  off-screen so a game that has never seen the mouse does not behave as
 *  though it were parked in the top-left corner. */
const pointer = { x: -9999, y: -9999, inside: false, down: false };

/** Keys currently held. Snake reads this rather than only the keydown edge, so
 *  holding a direction keeps steering. */
const keys = new Set();

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** The object handed to every game. One object for the lifetime of the game,
 *  so `frame` allocates nothing. */
const host = {
  c2d: null,
  W: 0, H: 0, dpr: 1,
  pointer,
  keys,
  accent: () => cssVar('--accent', '#7cc6ff'),
  accent2: () => cssVar('--accent-2', '#b48bff'),
  light: () => document.documentElement.dataset.scheme === 'light',
  exit: () => stop(),              // games hand the screen back with this
};

/* ---------------- sizing ---------------- */

function resize() {
  if (!canvas || !c2d || !gameDef) return;
  const w = canvas.clientWidth || innerWidth;
  const h = canvas.clientHeight || innerHeight;
  const dpr = scaleFor(w, h);
  const bw = Math.max(1, Math.round(w * dpr));
  const bh = Math.max(1, Math.round(h * dpr));
  // Assigning width/height clears the canvas and reallocates the backing store,
  // so only when it actually changed — resize() also runs on every game start.
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  host.W = w; host.H = h; host.dpr = dpr;
  // Games draw in CSS pixels. The backing-store scale is a transform, so none
  // of them ever has to know what dpr is.
  c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  game?.resize?.();
}

/* ---------------- the loop ---------------- */

const shouldRun = () => !!game && !document.hidden;

function tick(now) {
  raf = 0;
  if (!shouldRun()) return;
  // The first frame after a pause would otherwise carry the whole gap as dt and
  // teleport everything across the screen. Capped at about three frames.
  const dt = last ? Math.min(50, now - last) : 16.7;
  last = now;

  c2d.clearRect(0, 0, host.W, host.H);
  try {
    game.frame(now, dt);
  } catch (e) {
    // A broken game must not take the new tab page down with it, and must not
    // throw sixty times a second into the console either.
    console.error('[cgt] arcade', gameDef?.id, e);
    stop();
    return;
  }
  raf = requestAnimationFrame(tick);
}

function start() {
  if (raf || !shouldRun()) return;
  last = 0;
  raf = requestAnimationFrame(tick);
}

function pause() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

/* ---------------- input ---------------- */

function onMove(e) {
  pointer.x = e.clientX; pointer.y = e.clientY; pointer.inside = true;
}

function onLeave() { pointer.inside = false; }

function onDown(e) {
  if (e.target instanceof Element && e.target.closest(UI_SELECTOR)) return;
  if (e.button === 0) pointer.down = true;
  pointer.x = e.clientX; pointer.y = e.clientY;
  // The button is forwarded because Game 1 needs the right one for flags.
  game?.pointerdown?.(e.clientX, e.clientY, e.button);
}

/** Clearing `down` matters more than setting it: a missed release leaves a game
 *  believing the button is still held. Hence capture phase (a widget's own
 *  pointerup calls stopPropagation), plus pointercancel and blur — a release
 *  outside the window, or an alt-tab mid-drag, never delivers a pointerup. */
function onUp() {
  if (!pointer.down) return;
  pointer.down = false;
  game?.pointerup?.();
}

/** Losing the window drops every held key as well as the mouse button. Without
 *  this a keyup never arrives for anything held at the moment of an alt-tab, so
 *  Game 3's paddle would still be travelling when you came back. */
function onBlur() {
  onUp();
  keys.clear();
}

/** A game that wants the right mouse button has to stop the context menu from
 *  opening over the top of it. Only while one is running. */
function onContextMenu(e) {
  if (e.target instanceof Element && e.target.closest(UI_SELECTOR)) return;
  e.preventDefault();
}

/* Panels that own Escape ahead of the game. A game takes the whole screen, but
   the keyboard shortcuts are not disabled while one runs and neither of these
   is dimmed by `data-arcade`, so the settings drawer and the palette can both
   be opened over the top of it. Each closes itself on Escape from a listener on
   `document`, and onKey below is on `window` in the capture phase — so without
   this check the game swallowed the key before any of them saw it, and closing
   the drawer took two presses: one that quit the game, and one for the drawer. */
const OVERLAY_SELECTOR = '#settings,#palette-overlay,#dock-flyout,#dock-popover,#spaces-popover';

const overlayOpen = () =>
  [...document.querySelectorAll(OVERLAY_SELECTOR)].some(el => !el.hidden);

/** A game returning true has consumed the key. */
function onKey(e) {
  if (!game) return;
  if (e.key === 'Escape' && overlayOpen()) return;
  keys.add(e.key);
  if (game.key?.(e) === true) { e.preventDefault(); e.stopPropagation(); }
}

function onKeyUp(e) { keys.delete(e.key); }

function listen(on) {
  if (on === listening) return;
  listening = on;
  const fn = on ? addEventListener : removeEventListener;
  fn('pointermove', onMove, { passive: true });
  fn('pointerdown', onDown, true);      // capture: widgets stopPropagation on theirs
  fn('pointerup', onUp, { capture: true, passive: true });
  fn('pointercancel', onUp, { capture: true, passive: true });
  fn('blur', onBlur);
  fn('keydown', onKey, true);
  fn('keyup', onKeyUp, true);
  fn('contextmenu', onContextMenu);
  // Not on `window`, and not with the others. pointerleave does not bubble, so
  // a window listener in the bubble phase never fires at all. On the root
  // element it fires once, when the pointer leaves the document, which is the
  // only thing this cares about.
  const root = document.documentElement;
  if (on) root.addEventListener('pointerleave', onLeave, { passive: true });
  else root.removeEventListener('pointerleave', onLeave, { passive: true });
  if (!on) keys.clear();
}

/* ---------------- lifecycle ---------------- */

/** `data-arcade` fades the widgets and dock to 7% and makes them click-through.
 *  It is derived from the running game here and set nowhere else, because
 *  managing it alongside the game let the two disagree — and the result was
 *  every widget, the dock and the settings button invisible and unclickable,
 *  which Escape could not recover and only a reload cleared. */
/* The dimmed regions, made inert as well as click-through.
   `pointer-events: none` stops the mouse and nothing else: the dock is a
   toolbar with real tab stops, so during a game you could still Tab into a dock
   you cannot see and press Enter on a bookmark. `inert` takes the whole subtree
   out of hit-testing, focus order and the accessibility tree in one attribute,
   which is the actual intent. */
const DIMMED = ['#stage', '#dock-zone', '#spaces', '#hud'];

function applyAttr() {
  const root = document.documentElement;
  if (gameDef) root.dataset.arcade = gameDef.id;
  else delete root.dataset.arcade;
  for (const sel of DIMMED) {
    const el = document.querySelector(sel);
    if (el) el.inert = !!gameDef;
  }
}

export function stop() {
  pause();
  try { game?.stop?.(); } catch { /* a failing teardown must not block the next game */ }
  game = null; gameDef = null;
  applyAttr();
  listen(false);
  if (canvas) {
    canvas.hidden = true;
    // Hiding an element does not free its backing store; only resizing it does.
    // Zero is the point - an idle tab should hold no canvas memory at all.
    canvas.width = 0; canvas.height = 0;
  }
  host.W = 0; host.H = 0;
}

/** Load the game registry, once, the first time something is actually started.
 *  Three games' worth of code is dead weight on a new tab that is not playing
 *  one — which is nearly every new tab. */
let regPromise = null;
export function ensureReg() {
  if (REG) return Promise.resolve(REG);
  if (!regPromise) {
    regPromise = import('./games/index.js').then(m => (REG = m)).catch(e => {
      console.error('[cgt] arcade registry', e);
      regPromise = null;              // let a later attempt retry
      return null;
    });
  }
  return regPromise;
}

/* Both entry points await a dynamic import before touching anything, and in
   that window another request can arrive. Whoever asked last should win, so
   each request takes a ticket and drops out if it has been superseded. */
let gen = 0;

/** Start a game. Returns false if the id is not one. */
export async function play(id) {
  const mine = ++gen;
  const reg = await ensureReg();
  if (mine !== gen) return false;               // superseded while importing
  // hasOwn, not a bare lookup: GAMES is an object literal, so GAMES.toString
  // and GAMES.constructor are both truthy and neither is a game.
  const def = id && reg && Object.hasOwn(reg.GAMES, id) ? reg.GAMES[id] : null;
  if (!def) return false;

  stop();
  if (!canvas) return false;
  canvas.hidden = false;
  gameDef = def;
  applyAttr();
  resize();                          // before create, so W/H are real
  try {
    game = def.create(host);
  } catch (e) {
    console.error('[cgt] arcade', def.id, e);
    gameDef = null;
    applyAttr();
    canvas.hidden = true;
    canvas.width = 0; canvas.height = 0;
    return false;
  }
  listen(true);
  start();
  return true;
}

export const running = () => !!gameDef;

/* Backing-store size for a picker preview.
 *
 * Fixed rather than measured off the element. The canvas has to be drawn before
 * it has been laid out, and every callback that could say when it *has* been —
 * requestAnimationFrame, ResizeObserver — is driven by the rendering pipeline,
 * which is precisely what the dev preview harness does not run. A measured
 * version is therefore code that cannot be verified outside Chrome, and both
 * attempts at one silently drew nothing.
 *
 * Nothing is lost by fixing it: the drawer is a fixed width, so the card is a
 * known size, and this is 2x that for a crisp image on any display. CSS scales
 * the result into whatever box the card ends up with. */
const PREVIEW_W = 340;
const PREVIEW_H = 148;

/** Draw a still preview of a game into a canvas, for the picker. Async only
 *  because the registry is imported on demand. */
export async function drawPreview(id, el) {
  if (!el) return;
  const reg = await ensureReg();
  const def = reg && Object.hasOwn(reg.GAMES, id) ? reg.GAMES[id] : null;
  if (!def?.preview) return;
  el.width = PREVIEW_W;
  el.height = PREVIEW_H;
  const c = el.getContext('2d');
  if (!c) return;
  try { def.preview(c, PREVIEW_W, PREVIEW_H, host); }
  catch (e) { console.error('[cgt] arcade preview', id, e); }
}

export function initArcade() {
  canvas = $('#wp-arcade');
  if (!canvas) return;
  c2d = canvas.getContext('2d', { alpha: true, desynchronized: true });
  if (!c2d) return;
  host.c2d = c2d;

  addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause(); else start();
  });
}
