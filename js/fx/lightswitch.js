/* A light switch on the wall. Clicking it flips the whole page between the dark
 * and light colour schemes.
 *
 * It is drawn on the background canvas rather than being a DOM button on
 * purpose: it belongs to the wallpaper, sits underneath the glass, and picks up
 * the same blur and refraction from any panel that overlaps it. A <button>
 * would sit on top of everything and look like a control that had escaped from
 * the settings drawer.
 *
 * Where it goes: horizontally centred, 72% down. That is empty in the default
 * layout — the clock is at 16%, the search bar at 40%, and every default-on
 * widget is pinned to the left or right thirds. Somebody who has moved a widget
 * on top of it can move it back off; the switch does not chase free space,
 * because a control that is somewhere different every time you open a tab is
 * worse than one that is occasionally behind a panel.
 */
import { S, set } from '../state.js';
import { applyTheme } from '../theme.js';

const AT_X = 0.5;
const AT_Y = 0.72;

/** Ease toward a target. Frame-rate independent: `f` is how many 60ths of a
 *  second passed, so a 30 Hz display eases at the same speed as a 144 Hz one
 *  instead of at half or double it. */
const approach = (v, target, rate, f) => v + (target - v) * (1 - Math.pow(1 - rate, f));

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
    let lit = host.light() ? 1 : 0;     // animated 0..1, follows the scheme
    let hover = 0;                      // animated 0..1
    let press = 0;                      // animated 0..1, decays after a click
    let born = 0;                       // ms since the scene started

    function layout() {
      // Clamped rather than a flat percentage: 5.5% of a 3840px monitor is a
      // 210px light switch, which reads as a piece of furniture rather than a
      // detail.
      const w = Math.max(52, Math.min(84, host.W * 0.055));
      box.w = w;
      box.h = w * 1.52;
      box.x = host.W * AT_X - w / 2;
      box.y = host.H * AT_Y - box.h / 2;
    }

    layout();

    const inside = (x, y) =>
      x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;

    return {
      resize: layout,

      pointerdown(x, y) {
        if (!inside(x, y)) return;
        press = 1;
        const next = host.light() ? 'dark' : 'light';
        set({ scheme: next });
        applyTheme();
      },

      frame(now, dt) {
        const c = host.c2d;
        const f = dt / 16.7;
        born += dt;
        layout();

        const p = host.pointer;
        const over = p.inside && inside(p.x, p.y);
        hover = approach(hover, over ? 1 : 0, 0.18, f);
        lit = approach(lit, host.light() ? 1 : 0, 0.22, f);
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

        /* the wall plate — the same recipe as the CSS glass, by hand */
        const rr = box.w * 0.16;
        c.beginPath();
        c.roundRect(box.x, box.y, box.w, box.h, rr);
        const plate = c.createLinearGradient(0, box.y, 0, box.y + box.h);
        plate.addColorStop(0, `rgba(255,255,255,${(0.16 + hover * 0.06).toFixed(3)})`);
        plate.addColorStop(1, 'rgba(255,255,255,0.06)');
        c.fillStyle = plate;
        c.fill();
        c.lineWidth = 1;
        c.strokeStyle = `rgba(255,255,255,${(0.30 + hover * 0.18).toFixed(3)})`;
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
          ? `rgba(255,250,232,${(0.55 + lit * 0.35).toFixed(3)})`
          : `rgba(226,232,244,${(0.30 + hover * 0.10).toFixed(3)})`);
        key.addColorStop(1, lit > 0.5
          ? `rgba(255,226,168,${(0.42 + lit * 0.28).toFixed(3)})`
          : 'rgba(150,160,178,0.22)');
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

        /* a one-word hint while the cursor is on it */
        if (hover > 0.02) {
          c.globalAlpha = hover * 0.7;
          c.fillStyle = 'rgba(255,255,255,.9)';
          c.font = `500 ${Math.round(box.w * 0.2)}px system-ui, sans-serif`;
          c.textAlign = 'center';
          c.textBaseline = 'top';
          c.fillText(S.scheme === 'light' ? 'lights off' : 'lights on',
            cx, box.y + box.h + box.w * 0.18);
          c.globalAlpha = 1;
          c.textAlign = 'start';
          c.textBaseline = 'alphabetic';
        }
      },

      stop() { /* nothing retained */ },
    };
  },
};
