/* Game 3 — a pong.
 *
 * Scoring is a rally count, not a scoreline, and that is a deliberate choice: a
 * first-to-seven match has a best score of seven and nothing to chase after the
 * first evening. A rally count is a single number that can always go up, which
 * is what makes an all-time record worth keeping at all. The opponent gets
 * faster and more accurate as the rally grows, so the number stops climbing
 * where your reflexes stop.
 *
 * Your paddle is on the arrow keys, and it has a speed limit. It used to
 * follow the mouse, which had to be speed-limited for the same reason — an
 * unlimited paddle teleports and the game cannot be lost — but a limited one
 * then lags the cursor, so the pointer and the bat were never in the same place
 * and aiming felt broken. A key press has no position to disagree with, so the
 * limit is just how fast the bat moves and reads as the paddle's own weight.
 *
 * The ball is stepped in substeps rather than one big move per frame. At 144 Hz
 * that is wasted effort, but on the frame after a stall — an alt-tab, a garbage
 * collection — dt is capped at 50 ms and a single move of that size would carry
 * the ball clean through a paddle.
 */
import { recordScore, bestScore } from '../state.js';

const PADDLE_H = 0.17;       // of court height
const PADDLE_W = 12;         // px
const MARGIN = 0.045;        // paddle inset from the edge, of court width
const BALL_R = 7;
const START_SPEED = 6.4;     // px per 60th of a second
const SPEED_STEP = 0.19;     // added per return
const MAX_SPEED = 19;
const PLAYER_SPEED = 12.5;   // px per 60th; the whole difficulty of the game
const SERVE_DELAY = 750;     // ms

export const game3 = {
  id: 'game3',
  // See ARCADE in js/config.js for the name and description.

  /* A still mid-rally. Fixed positions, not random — a preview that reshuffles
     on every settings redraw reads as a glitch rather than as a game. */
  preview(c, w, h) {
    c.fillStyle = 'rgba(10,12,20,.55)';
    c.fillRect(0, 0, w, h);

    c.strokeStyle = 'rgba(255,255,255,.14)';
    c.lineWidth = 1.5;
    c.setLineDash([4, 6]);
    c.beginPath(); c.moveTo(w / 2, 4); c.lineTo(w / 2, h - 4); c.stroke();
    c.setLineDash([]);

    const pw = Math.max(3, w * 0.022);
    const ph = h * 0.3;
    const bat = (x, y, colour) => {
      c.fillStyle = colour;
      c.beginPath();
      c.roundRect(x, y - ph / 2, pw, ph, pw / 2);
      c.fill();
    };
    bat(w * 0.06, h * 0.58, '#7cc6ff');
    bat(w * 0.94 - pw, h * 0.4, 'rgba(255,255,255,.72)');

    c.fillStyle = '#fff';
    c.beginPath();
    c.arc(w * 0.42, h * 0.5, Math.max(2, h * 0.045), 0, 6.2832);
    c.fill();
  },

  create(host) {
    let W = host.W, H = host.H;
    let state = 'ready';               // ready | play | over
    let wait = SERVE_DELAY;
    let rally = 0;
    // Read live, never snapshotted — see the note on recordScore in
    // js/state.js for what a stale copy did to this game's record.
    const record = () => bestScore('game3');
    let beat = false;                  // this run passed the old record
    let flash = 0;                     // ms of impact flash left
    let over = 0;                      // ms since the game ended

    const you = { y: 0, h: 0 };
    const cpu = { y: 0, h: 0 };
    const ball = { x: 0, y: 0, vx: 0, vy: 0, sp: START_SPEED };

    function metrics() {
      W = host.W; H = host.H;
      you.h = cpu.h = Math.max(54, H * PADDLE_H);
    }

    function centre() {
      you.y = cpu.y = H / 2;
    }

    function serve(toPlayer) {
      ball.x = W / 2; ball.y = H / 2;
      ball.sp = START_SPEED;
      // Never dead flat and never near-vertical: a flat serve is boring and a
      // steep one spends most of its life bouncing off the top and bottom.
      const ang = Math.random() * 0.7 - 0.35;
      ball.vx = (toPlayer ? -1 : 1) * Math.cos(ang);
      ball.vy = Math.sin(ang) + (Math.random() - 0.5) * 0.25;
      state = 'ready';
      wait = SERVE_DELAY;
    }

    metrics();
    centre();
    serve(true);

    function finish() {
      state = 'over';
      over = 0;
      // One write per game, and it is the only thing this game persists.
      beat = recordScore('game3', rally);
    }

    function restart() {
      rally = 0; beat = false;
      centre();
      serve(true);
    }

    /** One substep of ball motion. `s` is the fraction of a 60th of a second. */
    function step(s) {
      ball.x += ball.vx * ball.sp * s;
      ball.y += ball.vy * ball.sp * s;

      if (ball.y < BALL_R) { ball.y = BALL_R; ball.vy = Math.abs(ball.vy); flash = 90; }
      else if (ball.y > H - BALL_R) { ball.y = H - BALL_R; ball.vy = -Math.abs(ball.vy); flash = 90; }

      const px = W * MARGIN + PADDLE_W;
      const cx = W * (1 - MARGIN) - PADDLE_W;

      // Player paddle. The check is "crossed the face while moving left", so a
      // fast ball that started the substep to the right of the paddle and
      // finished to the left of it is still caught.
      if (ball.vx < 0 && ball.x - BALL_R <= px && ball.x - BALL_R > px - ball.sp * s - BALL_R * 2) {
        const off = (ball.y - you.y) / (you.h / 2);
        if (Math.abs(off) <= 1.12) {
          ball.x = px + BALL_R;
          ball.vx = Math.abs(ball.vx);
          // Where you hit it steers it: the edges of the paddle are how you
          // aim, and the only reason the game has any depth at all.
          ball.vy += off * 0.62;
          normalise();
          ball.sp = Math.min(MAX_SPEED, ball.sp + SPEED_STEP);
          rally++;
          flash = 130;
        }
      }

      // Opponent paddle.
      if (ball.vx > 0 && ball.x + BALL_R >= cx && ball.x + BALL_R < cx + ball.sp * s + BALL_R * 2) {
        const off = (ball.y - cpu.y) / (cpu.h / 2);
        if (Math.abs(off) <= 1.12) {
          ball.x = cx - BALL_R;
          ball.vx = -Math.abs(ball.vx);
          ball.vy += off * 0.5;
          normalise();
          ball.sp = Math.min(MAX_SPEED, ball.sp + SPEED_STEP * 0.6);
          flash = 90;
        }
      }

      if (ball.x < -40) { finish(); return; }
      // The opponent missing does not end anything and is not scored — the
      // rally simply carries on. Turning it into a point would mean two numbers
      // to read, and the record is the point of the game.
      if (ball.x > W + 40) serve(true);
    }

    function normalise() {
      const m = Math.hypot(ball.vx, ball.vy) || 1;
      ball.vx /= m; ball.vy /= m;
      // Keep some horizontal component or the ball can end up drifting almost
      // straight up and down between the walls forever.
      if (Math.abs(ball.vx) < 0.42) {
        ball.vx = Math.sign(ball.vx || 1) * 0.42;
        ball.vy = Math.sign(ball.vy || 1) * Math.sqrt(1 - 0.42 * 0.42);
      }
    }

    function paddle(c, x, y, h, colour) {
      c.fillStyle = colour;
      c.beginPath();
      c.roundRect(x, y - h / 2, PADDLE_W, h, PADDLE_W / 2);
      c.fill();
    }

    return {
      resize() {
        const oldH = H || 1;
        metrics();
        // Positions are ratios of the old height, so resizing mid-rally does
        // not drop the ball outside the court.
        you.y *= H / oldH; cpu.y *= H / oldH;
        ball.x = Math.min(ball.x, W - BALL_R);
        ball.y = Math.min(ball.y, H - BALL_R);
      },

      pointerdown() {
        if (state === 'over' && over > 400) restart();
        else if (state === 'ready') wait = 0;
      },

      key(e) {
        if (e.key === 'Escape') { host.exit(); return true; }
        if (e.key === 'Enter' && state === 'over' && over > 200) { restart(); return true; }
        // Consumed so the arrows never reach the page, and so a serve can be
        // started with the same keys that move the bat.
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown'
            || e.key === 'w' || e.key === 'W' || e.key === 's' || e.key === 'S') {
          if (state === 'ready') wait = 0;
          return true;
        }
        return false;
      },

      frame(now, dt) {
        const c = host.c2d;
        const f = dt / 16.7;
        flash = Math.max(0, flash - dt);

        /* paddles */
        const half = you.h / 2;
        // Read from the held-key set rather than the keydown edge, so holding a
        // key keeps moving. Both pressed at once cancel, which is what you want
        // from a rocker: no jitter, and no last-one-wins surprise.
        const up = host.keys.has('ArrowUp') || host.keys.has('w') || host.keys.has('W');
        const down = host.keys.has('ArrowDown') || host.keys.has('s') || host.keys.has('S');
        if (up !== down) {
          you.y = Math.max(half, Math.min(H - half,
            you.y + (down ? 1 : -1) * PLAYER_SPEED * f));
        }

        if (state === 'play') {
          // The opponent tracks the ball, with a reaction speed and an aiming
          // error that both improve as the rally goes on. Its speed is
          // deliberately below the player's for the first dozen returns, so the
          // opening of a game is winnable and the difficulty arrives later.
          const skill = Math.min(1, rally / 26);
          const spd = (6.2 + skill * 7.4) * f;
          const err = (1 - skill) * cpu.h * 0.42;
          const want = Math.max(half, Math.min(H - half,
            ball.vx > 0 ? ball.y + Math.sin(now / 700) * err : H / 2));
          const d = want - cpu.y;
          cpu.y += Math.abs(d) <= spd ? d : Math.sign(d) * spd;
        }

        /* ball */
        if (state === 'ready') {
          wait -= dt;
          ball.x = W * MARGIN + PADDLE_W + BALL_R * 2.4;
          ball.y = you.y;
          if (wait <= 0) { state = 'play'; ball.x = W / 2; ball.y = H / 2; }
        } else if (state === 'play') {
          const steps = Math.max(1, Math.ceil(f * ball.sp / (BALL_R * 1.2)));
          for (let i = 0; i < steps && state === 'play'; i++) step(f / steps);
        } else {
          over += dt;
        }

        /* ---- draw ---- */
        const accent = host.accent();

        // Court. Faint, because the wallpaper is still behind it and the point
        // is to play on the background rather than replace it.
        c.fillStyle = 'rgba(0,0,0,.34)';
        c.fillRect(0, 0, W, H);

        c.strokeStyle = 'rgba(255,255,255,.13)';
        c.lineWidth = 2;
        c.setLineDash([10, 14]);
        c.beginPath();
        c.moveTo(W / 2, 0); c.lineTo(W / 2, H);
        c.stroke();
        c.setLineDash([]);

        paddle(c, W * MARGIN, you.y, you.h, accent);
        paddle(c, W * (1 - MARGIN) - PADDLE_W, cpu.y, cpu.h, 'rgba(255,255,255,.72)');

        if (state !== 'over') {
          const glow = flash / 130;
          if (glow > 0) {
            c.fillStyle = `rgba(255,255,255,${(glow * 0.28).toFixed(3)})`;
            c.beginPath();
            c.arc(ball.x, ball.y, BALL_R * (2.4 + glow * 1.6), 0, 6.2832);
            c.fill();
          }
          c.fillStyle = '#fff';
          c.beginPath();
          c.arc(ball.x, ball.y, BALL_R, 0, 6.2832);
          c.fill();
        }

        /* score */
        c.textAlign = 'center';
        c.textBaseline = 'alphabetic';
        c.fillStyle = 'rgba(255,255,255,.20)';
        c.font = `600 ${Math.round(Math.min(150, H * 0.19))}px system-ui, sans-serif`;
        c.fillText(String(rally), W / 2, H * 0.30);

        c.font = '500 13px system-ui, sans-serif';
        c.fillStyle = 'rgba(255,255,255,.42)';
        const best = record();
        c.fillText(best ? `best ${best}` : 'no record yet', W / 2, H * 0.34);

        if (state === 'over') {
          const t = Math.min(1, over / 260);
          c.globalAlpha = t;
          c.fillStyle = 'rgba(255,255,255,.96)';
          c.font = `600 ${Math.round(Math.min(46, H * 0.055))}px system-ui, sans-serif`;
          c.fillText(beat ? 'new record' : 'missed', W / 2, H * 0.52);
          c.font = '500 15px system-ui, sans-serif';
          c.fillStyle = 'rgba(255,255,255,.66)';
          c.fillText(`${rally} ${rally === 1 ? 'return' : 'returns'}`, W / 2, H * 0.56);
          c.fillStyle = 'rgba(255,255,255,.45)';
          c.font = '500 13px system-ui, sans-serif';
          c.fillText('Enter to play again · Esc to leave', W / 2, H * 0.60);
          c.globalAlpha = 1;
        } else {
          c.fillStyle = 'rgba(255,255,255,.30)';
          c.font = '500 12px system-ui, sans-serif';
          c.fillText('↑ ↓ to move · Esc to leave', W / 2, H - 22);
        }

        c.textAlign = 'start';
      },

      stop() { /* nothing retained */ },
    };
  },
};
