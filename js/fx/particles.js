/* Particle field. Drifts on its own, gathers toward the cursor, and scatters
 * for as long as you hold the mouse down.
 *
 * Three things here are less obvious than they look:
 *
 *  - **Two velocities per particle.** `dx/dy` is a constant drift that is never
 *    damped; `vx/vy` is impulse, which is. One value cannot be both: damping it
 *    enough for a click-burst to settle also brings the ambient drift to a dead
 *    stop within a second, and not damping it leaves the whole field permanently
 *    faster after every click. Splitting them gives a steady drift and a
 *    responsive kick at the same time.
 *
 *  - **The cursor pushes as well as pulls.** Attraction alone, at a strength
 *    strong enough to feel, collapses the entire field onto the pointer in
 *    about a second and leaves nothing to look at. Inside CORE the force
 *    reverses, so particles settle into a ring around the cursor instead of a
 *    dot underneath it.
 *
 *  - **Everything is drawn twice.** A dark pass, then a bright one. The field
 *    has to read against a black photo and against the Paper gradient, and a
 *    single translucent light colour cannot do both — on anything pale it
 *    simply disappears. The dark pass is batched into one Path2D at a flat
 *    alpha, because an outline does not need the distance fade that the bright
 *    pass uses.
 *
 * Cost: the linking pass is O(n²). At the cap of 110 particles that is 5,995
 * pairs a frame, which is nothing; at 400 it would be 79,800, which is not. The
 * count scales with viewport area and then hits the cap, so a 4K monitor does
 * not quietly turn this into a different program.
 */

const CAP = 110;
const AREA_PER = 16000;     // one particle per this many CSS px^2
const LINK = 150;           // px; beyond this two particles are not joined
const REACH = 330;          // px; strong cursor influence
const FAR = 760;            // px; weak influence, out to here
const CORE = 64;            // px; inside this the cursor pushes instead of pulls
const PULL = 0.17;          // attraction, px per frame^2 at the centre of REACH
const FAR_PULL = 0.05;      // the long, weak version of it
const LINK_BUCKETS = 6;     // distinct link opacities; see the drawing pass
const PUSH_HELD = 0.62;     // repulsion while the mouse is held down
const DRAG = 0.94;          // impulse decay per frame
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

    function spawn() {
      const ang = Math.random() * 6.2832;
      const sp = rand(0.22, 0.62);          // px per 60th of a second
      return {
        x: rand(0, host.W), y: rand(0, host.H),
        dx: Math.cos(ang) * sp, dy: Math.sin(ang) * sp,
        vx: 0, vy: 0,
        r: rand(1.8, 4.6),
        // A per-particle blend between the two accent colours, fixed at birth,
        // so the field has some variation without needing a palette.
        t: Math.random(),
      };
    }

    function populate() {
      const want = Math.max(24, Math.min(CAP,
        Math.round((host.W * host.H) / AREA_PER)));
      // Grown and trimmed rather than rebuilt, so dragging a window edge does
      // not restart the whole field on every resize event.
      while (ps.length > want) ps.pop();
      while (ps.length < want) ps.push(spawn());
    }

    populate();

    /** Shove everything away from a point. Used by the click burst; holding the
     *  button applies the same shape continuously from `frame`. */
    function blast(x, y, strength) {
      for (const p of ps) {
        const dx = p.x - x, dy = p.y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 > REACH * REACH || d2 < 1) continue;
        const d = Math.sqrt(d2);
        const push = (1 - d / REACH) * strength;
        p.vx += (dx / d) * push;
        p.vy += (dy / d) * push;
      }
    }

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
        // An impulse that decays rather than a velocity set outright: setting
        // it makes every particle move at the same speed and the burst looks
        // like a stamped ring.
        blast(x, y, 3.4);
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

        const { x: mx, y: my, inside, down } = host.pointer;
        const live = inside && mx > -9998;

        // Held down: keep pushing, every frame, for as long as it is held.
        if (live && down) blast(mx, my, PUSH_HELD * f);

        for (const p of ps) {
          if (live && !down) {
            const dx = mx - p.x, dy = my - p.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > 4 && d2 < FAR * FAR) {
              const d = Math.sqrt(d2);
              // Two ranges, and the weak outer one is not decoration. With only
              // the strong range, a particle shoved past REACH by a click or by
              // holding the button was outside every force that could bring it
              // back, so the field thinned permanently around wherever you had
              // last pushed. The outer pull is what lets it recover — and it is
              // also most of what makes the field read as following the cursor,
              // since on a 1600x900 screen a 330px radius only ever contains
              // about a fifth of the particles.
              let force = (1 - d / FAR) * FAR_PULL;
              if (d < REACH) force += (1 - d / REACH) * PULL;
              // Reverse close in, so the field orbits the cursor rather than
              // piling onto it.
              if (d < CORE) force -= (1 - d / CORE) * PULL * 2.4;
              p.vx += (dx / d) * force * f;
              p.vy += (dy / d) * force * f;
            }
          }

          p.x += (p.dx + p.vx) * f;
          p.y += (p.dy + p.vy) * f;
          // Only the impulse decays. The drift is constant by design — see the
          // header — so the field never coasts to a halt.
          const k = Math.pow(DRAG, f);
          p.vx *= k; p.vy *= k;

          if (p.x < -24) p.x = host.W + 24; else if (p.x > host.W + 24) p.x = -24;
          if (p.y < -24) p.y = host.H + 24; else if (p.y > host.H + 24) p.y = -24;
        }

        /* ---- links ----
           Sorted into a handful of opacity buckets and stroked as one path
           each. The obvious version — beginPath/stroke per link, with its own
           exact alpha — is around 6,000 separate draw calls a frame at the
           particle cap, and measured as the single most expensive thing this
           scene did. Six buckets is seven strokes instead, and the banding is
           invisible: the difference between 0.28 and 0.31 alpha on a hairline
           over a wallpaper is not something anyone can see. */
        const dark = new Path2D();
        const bright = [];
        for (let i = 0; i < LINK_BUCKETS; i++) bright.push(new Path2D());
        for (let i = 0; i < ps.length; i++) {
          const p = ps[i];
          for (let j = i + 1; j < ps.length; j++) {
            const q = ps[j];
            const dx = p.x - q.x, dy = p.y - q.y;
            if (dx > LINK || dx < -LINK || dy > LINK || dy < -LINK) continue;
            const d2 = dx * dx + dy * dy;
            if (d2 > LINK * LINK) continue;
            dark.moveTo(p.x, p.y); dark.lineTo(q.x, q.y);
            const t = 1 - Math.sqrt(d2) / LINK;
            const b = bright[Math.min(LINK_BUCKETS - 1, (t * LINK_BUCKETS) | 0)];
            b.moveTo(p.x, p.y); b.lineTo(q.x, q.y);
          }
        }

        // butt caps, not round: this pass is thousands of segments and round
        // caps add two arc fills to every one of them for an outline nobody
        // looks at directly.
        c.lineCap = 'butt';
        c.strokeStyle = 'rgba(0,0,0,.20)';
        c.lineWidth = 2.6;
        c.stroke(dark);

        c.lineWidth = 1.3;
        for (let i = 0; i < LINK_BUCKETS; i++) {
          const t = (i + 0.5) / LINK_BUCKETS;
          c.strokeStyle = `rgba(${a[0]},${a[1]},${a[2]},${(t * 0.34).toFixed(3)})`;
          c.stroke(bright[i]);
        }

        /* a thread to the cursor, so the interaction is legible rather than
           just a drift somebody might not notice */
        if (live) {
          c.lineWidth = 1.2;
          for (const p of ps) {
            const dx = mx - p.x, dy = my - p.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > REACH * REACH) continue;   // strong radius only, not FAR
            const t = 1 - Math.sqrt(d2) / REACH;
            c.strokeStyle = `rgba(${a2[0]},${a2[1]},${a2[2]},${(t * 0.3).toFixed(3)})`;
            c.beginPath();
            c.moveTo(p.x, p.y);
            c.lineTo(mx, my);
            c.stroke();
          }
        }

        /* ---- dots: one batched dark halo, then the coloured cores ---- */
        const halo = new Path2D();
        for (const p of ps) {
          halo.moveTo(p.x + p.r + 1.7, p.y);
          halo.arc(p.x, p.y, p.r + 1.7, 0, 6.2832);
        }
        c.fillStyle = 'rgba(0,0,0,.30)';
        c.fill(halo);

        for (const p of ps) {
          const r0 = Math.round(a[0] + (a2[0] - a[0]) * p.t);
          const g0 = Math.round(a[1] + (a2[1] - a[1]) * p.t);
          const b0 = Math.round(a[2] + (a2[2] - a[2]) * p.t);
          c.fillStyle = `rgba(${r0},${g0},${b0},.95)`;
          c.beginPath();
          c.arc(p.x, p.y, p.r, 0, 6.2832);
          c.fill();
          // A small white core, on the larger dots only. It is what keeps a dot
          // readable on a wallpaper close to the accent colour, but below about
          // 2.6px the highlight is under a pixel across and costs a fill to
          // draw nothing.
          if (p.r > 2.6) {
            c.fillStyle = 'rgba(255,255,255,.55)';
            c.beginPath();
            c.arc(p.x - p.r * 0.22, p.y - p.r * 0.22, p.r * 0.34, 0, 6.2832);
            c.fill();
          }
        }

        /* click rings */
        if (ripples.length) {
          for (const w of ripples) {
            w.r += 4.6 * f;
            const t = 1 - w.r / REACH;
            if (t <= 0) continue;
            c.strokeStyle = `rgba(${a[0]},${a[1]},${a[2]},${(t * 0.4).toFixed(3)})`;
            c.lineWidth = 2;
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
