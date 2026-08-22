/* Particle field. Drifts on its own, gathers toward the cursor, scatters on a
 * click.
 *
 * The two costs worth knowing about:
 *
 *  - The linking pass is O(n^2). At the cap of 110 particles that is 5,995
 *    pairs a frame, which is nothing; at 400 it would be 79,800, which is not.
 *    The count scales with viewport area and then hits the cap, so a 4K monitor
 *    does not quietly turn this into a different program.
 *
 *  - getComputedStyle forces a style recalculation, so the accent colour is
 *    read on a timer rather than every frame. It only changes when somebody is
 *    dragging the colour picker, and a fifth of a second of staleness there is
 *    invisible.
 */

const CAP = 110;
const AREA_PER = 16000;     // one particle per this many CSS px^2
const LINK = 132;           // px; beyond this two particles are not joined
const REACH = 210;          // px; cursor influence radius
const ACCENT_MS = 200;

/** '#7cc6ff' or '#7cf' -> [124,198,255]. Anything else -> null, and the caller
 *  keeps the last good value: a half-typed hex in the colour input should not
 *  make the background flicker to black. */
function rgb(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const particles = {
  id: 'particles',
  // Name and description live in FX_SCENES in js/config.js, not here: the
  // settings picker has to list every scene without importing any of them.
  ambient: true,

  create(host) {
    let ps = [];
    let a = [124, 198, 255];
    let a2 = [180, 139, 255];
    let accentAge = 1e9;      // forces a read on the first frame
    let ripples = [];

    const rand = (lo, hi) => lo + Math.random() * (hi - lo);

    function populate() {
      const want = Math.max(24, Math.min(CAP,
        Math.round((host.W * host.H) / AREA_PER)));
      // Grown and trimmed rather than rebuilt, so dragging a window edge does
      // not restart the whole field on every resize event.
      while (ps.length > want) ps.pop();
      while (ps.length < want) {
        ps.push({
          x: rand(0, host.W), y: rand(0, host.H),
          vx: rand(-0.012, 0.012), vy: rand(-0.012, 0.012),
          r: rand(0.9, 2.4),
          // A per-particle blend between the two accent colours, fixed at
          // birth, so the field has some variation without needing a palette.
          t: Math.random(),
        });
      }
    }

    populate();

    return {
      resize() {
        // Anything now outside the viewport is folded back in, otherwise
        // shrinking the window strands half the field off-screen for good.
        for (const p of ps) {
          if (p.x > host.W) p.x = Math.random() * host.W;
          if (p.y > host.H) p.y = Math.random() * host.H;
        }
        populate();
      },

      pointerdown(x, y) {
        ripples.push({ x, y, r: 0 });
        // A hard shove that decays, rather than setting velocity outright:
        // setting it makes every particle move at the same speed and the burst
        // looks like a stamped ring.
        for (const p of ps) {
          const dx = p.x - x, dy = p.y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 > REACH * REACH || d2 < 1) continue;
          const d = Math.sqrt(d2);
          const push = (1 - d / REACH) * 2.6;
          p.vx += (dx / d) * push;
          p.vy += (dy / d) * push;
        }
      },

      frame(now, dt) {
        const c = host.c2d;
        const f = dt / 16.7;                   // frames' worth of time

        accentAge += dt;
        if (accentAge > ACCENT_MS) {
          accentAge = 0;
          a = rgb(host.accent()) || a;
          a2 = rgb(host.accent2()) || a2;
        }

        const { x: mx, y: my, inside } = host.pointer;
        const live = inside && mx > -9998;

        for (const p of ps) {
          if (live) {
            const dx = mx - p.x, dy = my - p.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < REACH * REACH && d2 > 4) {
              const d = Math.sqrt(d2);
              // Falls off with distance and is deliberately weak: strong
              // attraction collapses the whole field onto the pointer within a
              // second and there is nothing left to look at.
              const pull = (1 - d / REACH) * 0.055 * f;
              p.vx += (dx / d) * pull;
              p.vy += (dy / d) * pull;
            }
          }

          p.x += p.vx * f;
          p.y += p.vy * f;
          // Drag, so a click burst settles back to a drift instead of leaving
          // the field permanently faster than it started.
          p.vx *= 0.976; p.vy *= 0.976;
          // A floor on the drift, or everything eventually stops dead.
          if (Math.abs(p.vx) < 0.01) p.vx += (Math.random() - 0.5) * 0.008;
          if (Math.abs(p.vy) < 0.01) p.vy += (Math.random() - 0.5) * 0.008;

          if (p.x < -20) p.x = host.W + 20; else if (p.x > host.W + 20) p.x = -20;
          if (p.y < -20) p.y = host.H + 20; else if (p.y > host.H + 20) p.y = -20;
        }

        /* links */
        c.lineWidth = 1;
        for (let i = 0; i < ps.length; i++) {
          const p = ps[i];
          for (let j = i + 1; j < ps.length; j++) {
            const q = ps[j];
            const dx = p.x - q.x, dy = p.y - q.y;
            if (dx > LINK || dx < -LINK || dy > LINK || dy < -LINK) continue;
            const d2 = dx * dx + dy * dy;
            if (d2 > LINK * LINK) continue;
            const t = 1 - Math.sqrt(d2) / LINK;
            c.strokeStyle = `rgba(${a[0]},${a[1]},${a[2]},${(t * 0.17).toFixed(3)})`;
            c.beginPath();
            c.moveTo(p.x, p.y);
            c.lineTo(q.x, q.y);
            c.stroke();
          }
        }

        /* a thread to the cursor, so the interaction is legible rather than
           just a subtle drift somebody might not notice */
        if (live) {
          for (const p of ps) {
            const dx = mx - p.x, dy = my - p.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > REACH * REACH) continue;
            const t = 1 - Math.sqrt(d2) / REACH;
            c.strokeStyle = `rgba(${a2[0]},${a2[1]},${a2[2]},${(t * 0.2).toFixed(3)})`;
            c.beginPath();
            c.moveTo(p.x, p.y);
            c.lineTo(mx, my);
            c.stroke();
          }
        }

        /* dots */
        for (const p of ps) {
          const r0 = Math.round(a[0] + (a2[0] - a[0]) * p.t);
          const g0 = Math.round(a[1] + (a2[1] - a[1]) * p.t);
          const b0 = Math.round(a[2] + (a2[2] - a[2]) * p.t);
          c.fillStyle = `rgba(${r0},${g0},${b0},.62)`;
          c.beginPath();
          c.arc(p.x, p.y, p.r, 0, 6.2832);
          c.fill();
        }

        /* click rings */
        if (ripples.length) {
          for (const w of ripples) {
            w.r += 3.4 * f;
            const t = 1 - w.r / REACH;
            if (t <= 0) continue;
            c.strokeStyle = `rgba(${a[0]},${a[1]},${a[2]},${(t * 0.34).toFixed(3)})`;
            c.lineWidth = 1.6;
            c.beginPath();
            c.arc(w.x, w.y, w.r, 0, 6.2832);
            c.stroke();
          }
          ripples = ripples.filter(w => w.r < REACH);
        }
      },

      stop() { ps = []; ripples = []; },
    };
  },
};
