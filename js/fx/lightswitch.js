/* A light switch on the wall. Clicking it turns the room's lights on: the photo
 * or video wallpaper brightens a little, and the glass brightens with it.
 *
 * It does not touch the colour scheme. An earlier version flipped dark/light,
 * which was a much bigger hammer than a light switch should be — it repainted
 * every panel, every icon and every piece of text, so a cosmetic toggle in the
 * corner of the wallpaper rewrote the whole page. Now it does what a dimmer
 * does: `data-lights` on the root, read by css/base.css for the wallpaper and
 * by applyTheme for the glass, and nothing else changes.
 *
 * It is drawn on the background canvas rather than being a DOM button on
 * purpose: it belongs to the wallpaper, sits underneath the glass, and picks up
 * the same blur and refraction from any panel that overlaps it. A <button>
 * would sit on top of everything and look like a control that had escaped from
 * the settings drawer.
 *
 * Drag it to move it; the position is stored as percentages of the viewport, so
 * it lands in the same relative place on a different monitor. One thing the
 * canvas cannot solve: if a widget is sitting on top of the switch, the click
 * belongs to the widget and there is no way to grab the switch underneath it.
 * That is why settings carries a Reset position button — it is the only way
 * back from a switch that has been buried.
 */
import { S, set } from '../state.js';
import { applyTheme } from '../theme.js';

/** Movement past this many pixels means the pointer is dragging the switch
 *  rather than clicking it. Same idea as the widget drag guard: without it
 *  every drag also toggles the lights on release. */
const DRAG_SLOP = 4;

/** Ease toward a target. Frame-rate independent: `f` is how many 60ths of a
 *  second passed, so a 30 Hz display eases at the same speed as a 144 Hz one
 *  instead of at half or double it. */
const approach = (v, target, rate, f) => v + (target - v) * (1 - Math.pow(1 - rate, f));

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const lightswitch = {
  id: 'lightswitch',
  // Name and description live in FX_SCENES in js/config.js, not here: the
  // settings picker has to list every scene without importing any of them.
  ambient: true,

  create(host) {
    // Where the plate is, recomputed every frame and read by the hit test. Kept
    // as state rather than derived in pointerdown so the two can never disagree
    // about where the switch is mid-animation.
    const box = { x: 0, y: 0, w: 0, h: 0 };
    let lit = S.fxLights ? 1 : 0;       // animated 0..1, follows the setting
    let hover = 0;                      // animated 0..1
    let press = 0;                      // animated 0..1, decays after a click
    let born = 0;                       // ms since the scene started

    // drag state
    let grab = null;                    // {dx, dy, fromX, fromY} while held
    let moved = false;

    // Not `clamp(...) || 50`. That reads as "or the default", but 0 is falsy,
    // so a switch at the very left edge would jump to the middle every time the
    // scene started. Same falsy-zero trap that inRange() in js/state.js exists
    // to avoid; the || was really there to catch NaN, so catch NaN explicitly.
    const at = (v, fallback) => {
      const n = Number(v);
      return Number.isFinite(n) ? clamp(n, 0, 100) : fallback;
    };
    const pos = () => ({
      x: at(S.fxSwitch?.x, 50),
      y: at(S.fxSwitch?.y, 72),
    });

    function layout() {
      // Clamped rather than a flat percentage: 5.5% of a 3840px monitor is a
      // 210px light switch, which reads as a piece of furniture rather than a
      // detail.
      const w = Math.max(52, Math.min(84, host.W * 0.055));
      box.w = w;
      box.h = w * 1.52;
      const p = pos();
      // The stored percentage is the switch's centre, and it is clamped so the
      // plate always stays wholly on screen — including after a resize that
      // made the window smaller than it was when the switch was dropped.
      box.x = clamp(host.W * p.x / 100 - w / 2, 0, Math.max(0, host.W - w));
      box.y = clamp(host.H * p.y / 100 - box.h / 2, 0, Math.max(0, host.H - box.h));
    }

    layout();

    const inside = (x, y) =>
      x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;

    return {
      resize: layout,

      pointerdown(x, y) {
        if (!inside(x, y)) return;
        moved = false;
        grab = { dx: x - box.x, dy: y - box.y, fromX: x, fromY: y };
      },

      pointerup() {
        if (!grab) return;
        if (moved) {
          // Store the centre, as a percentage, so it survives a monitor change.
          set({ fxSwitch: {
            x: +((box.x + box.w / 2) / host.W * 100).toFixed(2),
            y: +((box.y + box.h / 2) / host.H * 100).toFixed(2),
          } });
        } else {
          press = 1;
          set({ fxLights: !S.fxLights });
          applyTheme();
        }
        grab = null;
      },

      frame(now, dt) {
        const c = host.c2d;
        const f = dt / 16.7;
        born += dt;

        const p = host.pointer;

        if (grab && p.down) {
          if (Math.abs(p.x - grab.fromX) > DRAG_SLOP
              || Math.abs(p.y - grab.fromY) > DRAG_SLOP) moved = true;
          if (moved) {
            box.x = clamp(p.x - grab.dx, 0, Math.max(0, host.W - box.w));
            box.y = clamp(p.y - grab.dy, 0, Math.max(0, host.H - box.h));
          }
        } else {
          // Not being dragged, so the stored position is the truth. Doing this
          // every frame is what makes a Reset in settings take effect at once.
          layout();
        }

        const over = p.inside && inside(p.x, p.y);
        hover = approach(hover, over ? 1 : 0, 0.18, f);
        lit = approach(lit, S.fxLights ? 1 : 0, 0.22, f);
        press = approach(press, 0, 0.12, f);

        // A slow breath for the first few seconds so the switch is noticed at
        // all. It is a background element with no affordance of its own, and a
        // feature nobody discovers may as well not have been built.
        const intro = born < 6000 ? (1 - born / 6000) : 0;
        const breathe = intro * (0.5 + 0.5 * Math.sin(born / 620));

        const cx = box.x + box.w / 2;
        const cy = box.y + box.h / 2;
        const glow = Math.max(lit * 0.85, hover * 0.5, breathe * 0.45, press);

        /* the light it casts */
        if (glow > 0.01) {
          const r = box.w * (2.6 + press * 1.4);
          const g = c.createRadialGradient(cx, cy, box.w * 0.2, cx, cy, r);
          g.addColorStop(0, `rgba(255,244,214,${(glow * 0.20).toFixed(3)})`);
          g.addColorStop(0.45, `rgba(255,238,200,${(glow * 0.07).toFixed(3)})`);
          g.addColorStop(1, 'rgba(255,238,200,0)');
          c.fillStyle = g;
          c.beginPath();
          c.arc(cx, cy, r, 0, 6.2832);
          c.fill();
        }

        /* A dark drop under the plate. Without it the switch disappears against
           a pale wallpaper, which is most of the Paper and Dawn gradients and
           any bright photo. */
        c.save();
        c.shadowColor = 'rgba(0,0,0,.45)';
        c.shadowBlur = 14;
        c.shadowOffsetY = 3;

        /* the wall plate — the same recipe as the CSS glass, by hand */
        const rr = box.w * 0.16;
        c.beginPath();
        c.roundRect(box.x, box.y, box.w, box.h, rr);
        const plate = c.createLinearGradient(0, box.y, 0, box.y + box.h);
        plate.addColorStop(0, `rgba(255,255,255,${(0.18 + hover * 0.07).toFixed(3)})`);
        plate.addColorStop(1, 'rgba(255,255,255,0.07)');
        c.fillStyle = plate;
        c.fill();
        c.restore();

        c.lineWidth = 1;
        c.strokeStyle = `rgba(255,255,255,${(0.34 + hover * 0.2).toFixed(3)})`;
        c.beginPath();
        c.roundRect(box.x, box.y, box.w, box.h, rr);
        c.stroke();

        /* the rocker: sits high when lit, low when not */
        const inset = box.w * 0.17;
        const rw = box.w - inset * 2;
        const rh = box.h * 0.42;
        // 0.06..0.52 of the plate height, so the rocker travels most of the
        // plate without ever touching its edges.
        const ry = box.y + box.h * (0.52 - lit * 0.46) - (press * 0.02 * box.h);
        c.beginPath();
        c.roundRect(box.x + inset, ry, rw, rh, rr * 0.72);
        const key = c.createLinearGradient(0, ry, 0, ry + rh);
        // Warm and bright when the light is on, cool and recessed when it is off.
        key.addColorStop(0, lit > 0.5
          ? `rgba(255,250,232,${(0.58 + lit * 0.34).toFixed(3)})`
          : `rgba(226,232,244,${(0.34 + hover * 0.12).toFixed(3)})`);
        key.addColorStop(1, lit > 0.5
          ? `rgba(255,226,168,${(0.44 + lit * 0.3).toFixed(3)})`
          : 'rgba(150,160,178,0.24)');
        c.fillStyle = key;
        c.fill();
        c.strokeStyle = 'rgba(255,255,255,.34)';
        c.stroke();

        /* the little indicator dot, at the end the rocker is not */
        const dy = box.y + box.h * (lit > 0.5 ? 0.87 : 0.13);
        c.fillStyle = `rgba(255,255,255,${(0.18 + lit * 0.25).toFixed(3)})`;
        c.beginPath();
        c.arc(cx, dy, box.w * 0.045, 0, 6.2832);
        c.fill();

        /* the hint under it, while the cursor is on it */
        if (hover > 0.02) {
          c.save();
          c.globalAlpha = hover * 0.8;
          c.shadowColor = 'rgba(0,0,0,.6)';
          c.shadowBlur = 6;
          c.fillStyle = 'rgba(255,255,255,.95)';
          c.font = `500 ${Math.round(box.w * 0.19)}px system-ui, sans-serif`;
          c.textAlign = 'center';
          c.textBaseline = 'top';
          const top = box.y + box.h + box.w * 0.16;
          c.fillText(S.fxLights ? 'lights off' : 'lights on', cx, top);
          c.globalAlpha = hover * 0.45;
          c.font = `500 ${Math.round(box.w * 0.15)}px system-ui, sans-serif`;
          c.fillText('drag to move', cx, top + box.w * 0.24);
          c.restore();
          c.textAlign = 'start';
          c.textBaseline = 'alphabetic';
        }
      },

      stop() { grab = null; },
    };
  },
};
