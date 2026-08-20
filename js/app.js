// Bootstrap: build the stage, wire shortcuts, own the drag layout.
import { $, $$, el, clamp, toast, dropCache, openIncognito } from './util.js';
import { WALLPAPERS } from './config.js';
import { S, loadSettings, set, setWidget, onChange } from './state.js';
import { initTheme, applyTheme, attachSheen } from './theme.js';
import { initDock, applyDockSettings, renderDock } from './dock.js';
import { initPalette } from './palette.js';
import { initSpaces, renderSpaces } from './spaces.js';
import { initSettings } from './settings.js';
import { REGISTRY } from './widgets/index.js';

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
  // Remember where the widget is *meant* to sit. clampPanel measures from this
  // rather than from wherever it currently is, so a panel pushed up by growing
  // content drops back once the content shrinks again.
  panel.dataset.ay = cfg.y ?? 10;
  // Whether the user put it here by hand. Decides if clampPanel is allowed to
  // move it clear of the dock — see layoutBounds.
  panel.dataset.placed = cfg.placed ? '1' : '';
  panel.style.transform = cfg.anchor === 'center' ? 'translateX(-50%)' : '';
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
 *  The drag handler and clampPanel must agree for a given panel, or a drop
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

/** Pull a panel back inside the viewport, leaving room for the dock.
 *  Position only — never size — so this can't feed back into the observer. */
function clampPanel(panel) {
  if (panel.classList.contains('dragging')) return;
  const r = panel.getBoundingClientRect();
  const b = layoutBounds(r.width, r.height, wasPlaced(panel));

  // Vertical clamping is measured from the widget's intended position, not its
  // current one. Clamping only ever pulls upward, so measuring from the current
  // position ratchets: a widget whose content grows gets shoved up, and when
  // the content shrinks again nothing brings it back down.
  const wantTop = (parseFloat(panel.dataset.ay) || 0) / 100 * innerHeight;
  const top = clamp(wantTop, b.minY, b.maxY);

  // Horizontal has no such problem — content rarely changes a panel's width —
  // so this stays relative to where it actually is.
  const left = clamp(r.left, b.minX, b.maxX);

  if (Math.abs(left - r.left) > 0.5) {
    panel.style.left = (left / innerWidth * 100).toFixed(2) + '%';
    panel.style.transform = '';        // centre anchoring can't survive a nudge
  }
  if (Math.abs(top - r.top) > 0.5) {
    panel.style.top = (top / innerHeight * 100).toFixed(2) + '%';
  }
}

// Widgets grow once their data arrives (weather and news especially), so
// clamping has to react to size, not just to window resizes.
const sizeWatch = new ResizeObserver(entries => {
  for (const e of entries) clampPanel(e.target);
});

function keepInView() { for (const panel of $$('.widget')) clampPanel(panel); }

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
    const pre = panel.getBoundingClientRect();
    panel.style.transform = '';
    panel.style.left = (pre.left / innerWidth * 100).toFixed(2) + '%';

    const r = panel.getBoundingClientRect();
    const offX = e.clientX - r.left, offY = e.clientY - r.top;
    // Untransformed size: .widget.dragging applies scale(1.03), and the entry
    // animation may still be scaling the panel, either of which would skew
    // bounds derived from the rect.
    const w = panel.offsetWidth, h = panel.offsetHeight;
    panel.classList.add('dragging');
    try { panel.setPointerCapture(e.pointerId); } catch {}

    const move = ev => {
      // Dragging IS placing it, so this gets the full viewport — and matches
      // what clampPanel will allow once the drop is recorded as placed.
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
      panel.dataset.ay = parseFloat(panel.style.top);   // dropping it here sets a new intent
      panel.dataset.placed = '1';
      await setWidget(id, {
        x: parseFloat(panel.style.left),
        y: parseFloat(panel.style.top),
        anchor: null,
        placed: true,
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
    await set({ wallpaper: next.id, wallpaperCustom: '' });
    applyTheme();
    toast(next.name);
  });

  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(keepInView, 200); });

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
  initTheme();
  initEvents();
  initKeys();
  initPalette();
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
