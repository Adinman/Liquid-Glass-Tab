/* Interactive backgrounds: the canvas that lives in the wallpaper stack.
 *
 * This is the host, not a scene. It owns the one <canvas>, the one
 * requestAnimationFrame loop and the one set of pointer listeners; the things
 * you actually see live in js/fx/. Everything here exists so that a background
 * which is *doing* something costs nothing while it is not.
 *
 * Three rules the scenes rely on:
 *
 *  1. The loop does not run unless there is something to draw. No scene, hidden
 *     tab, or an ambient scene under prefers-reduced-motion — in each case the
 *     rAF is cancelled outright rather than left spinning on an early return. A
 *     new tab page sits open in a background tab far more often than it is
 *     looked at, and a canvas that keeps ticking there is the difference
 *     between a nice effect and a battery complaint in a review.
 *
 *  2. Pointer listeners exist only while a scene is running, and `move` is
 *     passive. They are on `window`, not the canvas: the canvas sits at
 *     z-index 0 underneath #stage, so it would never receive a pointer event
 *     anyway, and giving it pointer-events would break clicking the page.
 *
 *  3. Scenes are factories. `create(host)` returns a fresh object owning its own
 *     state, so switching scenes twice cannot leave the first one's particles
 *     behind, and there is no module-level mutable state to reset.
 */
import { S } from './state.js';
import { $ } from './util.js';

/* Anything matching this swallows the click: it is UI, not background. #stage is
   deliberately absent — it covers the whole viewport, so treating it as UI would
   mean the background never saw a click at all. Its children (.widget) are what
   actually matter. */
const UI_SELECTOR = '.widget,#dock-zone,#spaces,#spaces-popover,#palette-overlay,'
                  + '#settings,#hud,#toast';

/* Retina is worth having; a 3x phone-class ratio on a 4K monitor is four times
   the fill rate for something sitting behind blurred glass. */
const MAX_DPR = 2;

/* And a hard ceiling on total device pixels, because the fill rate is not the
   expensive part - the memory is. A canvas costs width x height x 4 bytes of
   backing store no matter what is drawn on it, so a full-screen one at dpr 2 on
   a 1440p display is 56 MB, held for as long as the scene is on, in every open
   new tab. 4.2 million pixels caps that at about 17 MB.

   This costs nothing on ordinary displays: at 1920x1080 with dpr 1 the ratio is
   already under the cap, so those users keep the full resolution they always
   had. It only bites on large or high-density screens, where the alternative
   was tens of megabytes for a field of dots behind blurred glass. */
const MAX_PIXELS = 4.2e6;
const MIN_SCALE = 0.75;      // never so soft that the dots turn to mush

function scaleFor(w, h) {
  const want = Math.min(MAX_DPR, devicePixelRatio || 1);
  const fit = Math.sqrt(MAX_PIXELS / Math.max(1, w * h));
  return Math.max(MIN_SCALE, Math.min(want, fit));
}

let canvas = null;
let c2d = null;
let raf = 0;
let last = 0;
let scene = null;         // the running instance
let sceneDef = null;      // its definition, kept for `ambient` and restarts
let suspended = null;     // the ambient scene id a game interrupted
let listening = false;
let REG = null;           // js/fx/index.js, imported on demand

const reduced = matchMedia('(prefers-reduced-motion: reduce)');

/** Live pointer state, in CSS pixels relative to the viewport. Starts far
 *  off-screen so a scene that has never seen the mouse does not behave as
 *  though it were parked in the top-left corner. */
const pointer = { x: -9999, y: -9999, px: -9999, py: -9999, inside: false, down: false };

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** The object handed to every scene. One object for the lifetime of the scene,
 *  so `frame` allocates nothing. */
const host = {
  c2d: null,
  W: 0, H: 0, dpr: 1,
  pointer,
  accent: () => cssVar('--accent', '#7cc6ff'),
  accent2: () => cssVar('--accent-2', '#b48bff'),
  light: () => document.documentElement.dataset.scheme === 'light',
  exit: () => stopGame(),          // games hand the screen back with this
};

/* ---------------- sizing ---------------- */

function resize() {
  if (!canvas || !c2d) return;
  // No scene means no pixels. Without this the plain window-resize listener
  // sizes the canvas to the full viewport for somebody who has never turned an
  // interactive background on, and that allocation is then held for the life of
  // the tab - measured at 3.5 MB in a 720p window, and 56 MB at 1440p on a
  // high-density display.
  if (!sceneDef) return;
  const w = canvas.clientWidth || innerWidth;
  const h = canvas.clientHeight || innerHeight;
  const dpr = scaleFor(w, h);
  const bw = Math.max(1, Math.round(w * dpr));
  const bh = Math.max(1, Math.round(h * dpr));
  // Assigning width/height clears the canvas and reallocates the backing store,
  // so only when it actually changed — resize() also runs on every scene start.
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  host.W = w; host.H = h; host.dpr = dpr;
  // Scenes draw in CSS pixels. The backing-store scale is a transform, so none
  // of them ever has to know what dpr is.
  c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  scene?.resize?.();
}

/* ---------------- the loop ---------------- */

/** Whether there is any reason to be drawing. */
function shouldRun() {
  if (!scene) return false;
  if (document.hidden) return false;
  // A game was launched deliberately and is not decoration, so reduced-motion
  // silences the ambient scenes only.
  if (sceneDef?.ambient && reduced.matches) return false;
  return true;
}

function tick(now) {
  raf = 0;
  if (!shouldRun()) return;
  // The first frame after a pause would otherwise carry the whole gap as dt and
  // teleport everything across the screen. Capped at about three frames.
  const dt = last ? Math.min(50, now - last) : 16.7;
  last = now;

  c2d.clearRect(0, 0, host.W, host.H);
  try {
    scene.frame(now, dt);
  } catch (e) {
    // A broken scene must not take the new tab page down with it, and must not
    // throw sixty times a second into the console either.
    console.error('[cgt] fx scene', sceneDef?.id, e);
    stop();
    return;
  }
  pointer.px = pointer.x; pointer.py = pointer.y;
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

/** One frame, outside the loop. What a reduced-motion ambient scene gets: a
 *  light switch you cannot see is worse than one that does not animate. */
function drawStill() {
  if (!scene || !c2d) return;
  c2d.clearRect(0, 0, host.W, host.H);
  try { scene.frame(performance.now(), 16.7); } catch { /* see tick */ }
}

/* ---------------- input ---------------- */

function onMove(e) {
  pointer.x = e.clientX; pointer.y = e.clientY; pointer.inside = true;
  if (shouldRun()) start(); else drawStill();
}

function onLeave() { pointer.inside = false; }

function onDown(e) {
  if (e.button !== 0) return;
  if (e.target instanceof Element && e.target.closest(UI_SELECTOR)) return;
  pointer.down = true;
  pointer.x = e.clientX; pointer.y = e.clientY;
  scene?.pointerdown?.(e.clientX, e.clientY);
  if (shouldRun()) start(); else drawStill();
}

/** Clearing `down` matters more than setting it: hold-to-repel and the light
 *  switch drag both run for as long as it is true, so a missed release leaves
 *  the field permanently repelling and the switch stuck to the cursor. Hence
 *  capture phase (a widget's own pointerup calls stopPropagation), plus
 *  pointercancel and blur — a release outside the window, or an alt-tab
 *  mid-drag, never delivers a pointerup at all. */
function onUp() {
  if (!pointer.down) return;
  pointer.down = false;
  scene?.pointerup?.();
}

/** A scene returning true has consumed the key. Only the games do, and only for
 *  Escape and the pause key — the palette, the edit-mode shortcut and every
 *  other binding on the page must keep working underneath an ambient scene. */
function onKey(e) {
  if (scene?.key?.(e) === true) { e.preventDefault(); e.stopPropagation(); }
}

function listen(on) {
  if (on === listening) return;
  listening = on;
  const fn = on ? addEventListener : removeEventListener;
  fn('pointermove', onMove, { passive: true });
  fn('pointerdown', onDown, true);      // capture: widgets stopPropagation on theirs
  fn('pointerup', onUp, { capture: true, passive: true });
  fn('pointercancel', onUp, { capture: true, passive: true });
  fn('blur', onUp);
  fn('pointerleave', onLeave, { passive: true });
  fn('keydown', onKey, true);
}

/* ---------------- scene lifecycle ---------------- */

/** `data-fx-game` fades the widgets and dock to 7% and makes them
 *  click-through. It is derived from the running scene here and set nowhere
 *  else, because managing it alongside the scene let the two disagree: a
 *  setScene landing just after a startGame replaced the game with an ambient
 *  scene and left the attribute behind, and stopGame() then early-returned
 *  because no game was running. The result was every widget, the dock and the
 *  settings button invisible and unclickable, which Escape could not recover
 *  and only a reload cleared. */
function applyGameAttr() {
  const root = document.documentElement;
  if (sceneDef && !sceneDef.ambient) root.dataset.fxGame = sceneDef.id;
  else delete root.dataset.fxGame;
}

function stop() {
  pause();
  try { scene?.stop?.(); } catch { /* a failing teardown must not block the next scene */ }
  scene = null; sceneDef = null;
  applyGameAttr();
  listen(false);
  if (canvas) {
    canvas.hidden = true;
    // Hiding an element does not free its backing store; only resizing it does.
    // Zero is the point - an idle tab should hold no canvas memory at all.
    canvas.width = 0; canvas.height = 0;
  }
  host.W = 0; host.H = 0;
}

function run(def) {
  stop();
  if (!def || !canvas) return;
  canvas.hidden = false;
  sceneDef = def;
  applyGameAttr();
  resize();                          // before create, so W/H are real
  try {
    scene = def.create(host);
  } catch (e) {
    console.error('[cgt] fx scene', def.id, e);
    sceneDef = null;
    applyGameAttr();
    canvas.hidden = true;
    canvas.width = 0; canvas.height = 0;
    return;
  }
  listen(true);
  if (shouldRun()) start(); else drawStill();
}

/* ---------------- public ---------------- */

/** Load the scene registry, once, the first time something is actually turned
 *  on. Three scenes' worth of code is dead weight on a new tab with no
 *  interactive background set — which is every new tab until somebody enables
 *  one, and every tab belonging to everybody who never does. */
let regPromise = null;
function ensureReg() {
  if (REG) return Promise.resolve(REG);
  if (!regPromise) {
    regPromise = import('./fx/index.js').then(m => (REG = m)).catch(e => {
      console.error('[cgt] fx registry', e);
      regPromise = null;              // let a later attempt retry
      return null;
    });
  }
  return regPromise;
}

/* Both entry points await a dynamic import before touching anything, and in
   that window another request can arrive - the storage listener re-applies the
   scene whenever any other tab writes settings.
   Whoever asked last should win, so each request takes a ticket and drops out
   if it has been superseded. Without it, clicking Play Pong while a settings
   change was in flight tore the game down and left the page stuck behind the
   game's own dimming. */
let gen = 0;

/** Switch the ambient background. '' or an unknown id means none. */
export async function setScene(id) {
  // A game is on screen: remember the choice and apply it when the game ends,
  // rather than yanking the canvas out from under it.
  if (gameRunning()) { suspended = id || null; return; }
  const mine = ++gen;
  if (!id) { stop(); return; }
  const reg = await ensureReg();
  if (mine !== gen) return;                     // superseded while importing
  // Re-checked after the await too: a game may have started in the gap, and the
  // check at the top of the function is by then stale.
  if (gameRunning()) { suspended = id || null; return; }
  // hasOwn, not a bare lookup: SCENES is an object literal, so SCENES.toString
  // and SCENES.constructor are both truthy and neither is a scene.
  const def = reg && Object.hasOwn(reg.SCENES, id) ? reg.SCENES[id] : null;
  if (def) run(def); else stop();
}

/** Launch a game scene, suspending any ambient one. */
export async function startGame(id) {
  const mine = ++gen;
  const reg = await ensureReg();
  if (mine !== gen) return false;               // superseded while importing
  const def = id && reg && Object.hasOwn(reg.GAMES, id) ? reg.GAMES[id] : null;
  if (!def) return false;
  suspended = sceneDef?.ambient ? sceneDef.id : null;
  run(def);                                     // sets data-fx-game via applyGameAttr
  return true;
}

export function stopGame() {
  // The attribute is cleared by stop() -> applyGameAttr, never here, so it
  // cannot survive this early return.
  if (!gameRunning()) { applyGameAttr(); return; }
  const back = suspended; suspended = null;
  stop();
  if (back) setScene(back);
}

export const gameRunning = () => !!(sceneDef && !sceneDef.ambient);

/** Re-apply the current setting. */
export function refreshScene() {
  if (gameRunning()) return;
  return setScene(S.fxScene);
}

export function initFX() {
  canvas = $('#wp-fx');
  if (!canvas) return;
  c2d = canvas.getContext('2d', { alpha: true, desynchronized: true });
  if (!c2d) return;
  host.c2d = c2d;

  addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause(); else start();
  });
  // Turning reduced motion on or off mid-session should take effect without a
  // reload: restarting the scene re-runs the shouldRun check.
  reduced.addEventListener?.('change', () => { if (sceneDef) run(sceneDef); });
}
