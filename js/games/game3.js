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
import { recordScore, bestScore, levelFor } from '../state.js';
import { t } from '../i18n.js';
import { createLevels, reserved } from './levels.js';

const PADDLE_H = 0.17;       // of court height
const PADDLE_W = 12;         // px
const MARGIN = 0.045;        // paddle inset from the edge, of court width
const BALL_R = 7;
const START_SPEED = 6.4;     // px per 60th of a second
const SPEED_STEP = 0.19;     // added per return
const MAX_SPEED = 19;
const PLAYER_SPEED = 12.5;   // px per 60th; the whole difficulty of the game
const SERVE_DELAY = 750;     // ms
const MATCH_POINTS = 7;      // two-player mode only; see below

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

    /* Which opponent, fixed for the life of the instance. Switching deals a
       fresh game, so a rally always finishes under the rules it started with
       and files against the right record. */
    let mode = levelFor('game3').id;   // 'ai' | 'friend'
    let KEY = `game3.${mode}`;
    const vsFriend = () => mode === 'friend';

    // Two-player scoring. The one-player game is an endless rally and stays
    // that way — a rally count is a single number that can always go up, which
    // is what makes an all-time record worth chasing. Two people at one
    // keyboard want to beat each other rather than a number, so that mode is a
    // match to MATCH_POINTS, and what it files as a record is the longest rally
    // of the match: a measure of the two of you rather than of one.
    let ptsL = 0, ptsR = 0;
    let bestRally = 0;                 // longest rally this match
    let winner = '';                   // 'left' | 'right', two-player only

    // Read live, never snapshotted — see the note on recordScore in
    // js/state.js for what a stale copy did to this game's record.
    const record = () => bestScore(KEY);
    let beat = false;                  // this run passed the old record
    let flash = 0;                     // ms of impact flash left
    let over = 0;                      // ms since the game ended

    const you = { y: 0, h: 0 };
    const cpu = { y: 0, h: 0 };
    const ball = { x: 0, y: 0, vx: 0, vy: 0, sp: START_SPEED };

    function metrics() {
      W = host.W; H = host.H;
      you.h = cpu.h = Math.max(54, H * PADDLE_H);
      picker.layout(host);
    }

    const picker = createLevels('game3', 'opponent', () => {
      mode = levelFor('game3').id;
      KEY = `game3.${mode}`;
      restart();
      metrics();
    });

    function centre() {
      you.y = cpu.y = H / 2;
    }

    /* The left edge of the playable court. The opponent picker reserves its
       width down the left-hand side exactly as it does in the other two games,
       so the left paddle starts beyond it rather than underneath it. */
    const courtL = () => reserved() + W * MARGIN;
    const courtMid = () => (courtL() + W * (1 - MARGIN)) / 2;

    function serve(toPlayer) {
      ball.x = courtMid(); ball.y = H / 2;
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

    /** One side let the ball past. What that means depends on the opponent. */
    function missed(side) {
      if (bestRally < rally) bestRally = rally;

      if (!vsFriend()) {
        // One player: the computer missing does not end anything and is not
        // scored — the rally simply carries on. Turning it into a point would
        // mean two numbers to read, and the record is the point of the game.
        if (side === 'right') { serve(true); return; }
        finish();
        return;
      }

      // Two players: a miss is a point for the other side.
      if (side === 'left') ptsR++; else ptsL++;
      rally = 0;
      if (ptsL >= MATCH_POINTS || ptsR >= MATCH_POINTS) {
        winner = ptsL > ptsR ? 'left' : 'right';
        finish();
        return;
      }
      centre();
      // Served towards whoever just conceded, which is the convention and also
      // stops the same player being on the back foot twice running.
      serve(side === 'left');
    }

    function finish() {
      state = 'over';
      over = 0;
      // One write per game, and it is the only thing this game persists. In a
      // match it is the longest rally the two of you managed, not the score.
      beat = recordScore(KEY, Math.max(bestRally, rally));
    }

    function restart() {
      rally = 0; beat = false;
      ptsL = 0; ptsR = 0; bestRally = 0; winner = '';
      centre();
      serve(true);
    }

    /** One substep of ball motion. `s` is the fraction of a 60th of a second. */
    function step(s) {
      ball.x += ball.vx * ball.sp * s;
      ball.y += ball.vy * ball.sp * s;

      if (ball.y < BALL_R) { ball.y = BALL_R; ball.vy = Math.abs(ball.vy); flash = 90; }
      else if (ball.y > H - BALL_R) { ball.y = H - BALL_R; ball.vy = -Math.abs(ball.vy); flash = 90; }

      const px = courtL() + PADDLE_W;
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

      if (ball.x < courtL() - 60) { missed('left'); return; }
      if (ball.x > W + 40) { missed('right'); return; }
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

      pointerdown(px, py, button) {
        if (button === 0 && picker.pointerdown(px, py)) return;
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
        // The picker sits under the left player's hand in two-player mode, so
        // it is worth being explicit: only a click changes the opponent, never
        // a stray key.
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
        const held = (...keys) => keys.some(k => host.keys.has(k));
        const drive = (bat, up, down) => {
          if (up === down) return;
          bat.y = Math.max(half, Math.min(H - half,
            bat.y + (down ? 1 : -1) * PLAYER_SPEED * f));
        };

        if (vsFriend()) {
          // Left is WASD, right is the arrows — the two hands the keyboard
          // actually separates. Alone against the computer both sets drive the
          // one bat, because there is no one to take the other half.
          drive(you, held('w', 'W'), held('s', 'S'));
          drive(cpu, held('ArrowUp'), held('ArrowDown'));
        } else {
          drive(you, held('ArrowUp', 'w', 'W'), held('ArrowDown', 's', 'S'));
        }

        if (state === 'play' && !vsFriend()) {
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
          // Parked in front of whoever is about to serve.
          const toLeft = ball.vx < 0;
          ball.x = toLeft ? courtL() + PADDLE_W + BALL_R * 2.4
                          : W * (1 - MARGIN) - PADDLE_W - BALL_R * 2.4;
          ball.y = toLeft ? you.y : cpu.y;
          if (wait <= 0) { state = 'play'; ball.x = courtMid(); ball.y = H / 2; }
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

        picker.draw(c, host);

        c.strokeStyle = 'rgba(255,255,255,.13)';
        c.lineWidth = 2;
        c.setLineDash([10, 14]);
        c.beginPath();
        c.moveTo(courtMid(), 0); c.lineTo(courtMid(), H);
        c.stroke();
        c.setLineDash([]);

        paddle(c, courtL(), you.y, you.h, accent);
        paddle(c, W * (1 - MARGIN) - PADDLE_W, cpu.y, cpu.h,
          vsFriend() ? host.accent2() : 'rgba(255,255,255,.72)');

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
        const mid = courtMid();

        if (vsFriend()) {
          // Each side's points over its own half, so which number is yours is
          // answered by where you are sitting rather than by reading a label.
          const big = `600 ${Math.round(Math.min(120, H * 0.15))}px system-ui, sans-serif`;
          c.font = big;
          c.fillStyle = 'rgba(255,255,255,.22)';
          c.fillText(String(ptsL), (courtL() + mid) / 2, H * 0.28);
          c.fillText(String(ptsR), (mid + W * (1 - MARGIN)) / 2, H * 0.28);

          c.font = '500 13px system-ui, sans-serif';
          c.fillStyle = 'rgba(255,255,255,.42)';
          c.fillText(t('first to {n}', { n: MATCH_POINTS }), mid, H * 0.34);
          c.fillStyle = 'rgba(255,255,255,.3)';
          c.font = '500 12px system-ui, sans-serif';
          c.fillText(t('rally {n}', { n: rally }), mid, H * 0.375);
        } else {
          c.fillStyle = 'rgba(255,255,255,.20)';
          c.font = `600 ${Math.round(Math.min(150, H * 0.19))}px system-ui, sans-serif`;
          c.fillText(String(rally), mid, H * 0.30);

          c.font = '500 13px system-ui, sans-serif';
          c.fillStyle = 'rgba(255,255,255,.42)';
          const best = record();
          c.fillText(best ? t('best {n}', { n: best }) : t('no record yet'), mid, H * 0.34);
        }

        if (state === 'over') {
          const fade = Math.min(1, over / 260);
          c.globalAlpha = fade;
          c.fillStyle = 'rgba(255,255,255,.96)';
          c.font = `600 ${Math.round(Math.min(46, H * 0.055))}px system-ui, sans-serif`;
          c.fillText(
            vsFriend() ? (winner === 'left' ? t('left wins') : t('right wins'))
              : beat ? t('new record') : t('missed'),
            mid, H * 0.52);
          c.font = '500 15px system-ui, sans-serif';
          c.fillStyle = 'rgba(255,255,255,.66)';
          c.fillText(
            vsFriend() ? `${ptsL} – ${ptsR}`
              : t('{n} returns', { n: rally }),
            mid, H * 0.56);
          if (vsFriend() && bestRally > 0) {
            c.fillStyle = 'rgba(255,255,255,.45)';
            c.font = '500 13px system-ui, sans-serif';
            c.fillText(t('longest rally {n}', { n: bestRally }), mid, H * 0.595);
          }
          c.fillStyle = 'rgba(255,255,255,.45)';
          c.font = '500 13px system-ui, sans-serif';
          c.fillText(t('Enter to play again · Esc to leave'),
            mid, H * (vsFriend() && bestRally > 0 ? 0.635 : 0.60));
          c.globalAlpha = 1;
        } else {
          c.fillStyle = 'rgba(255,255,255,.30)';
          c.font = '500 12px system-ui, sans-serif';
          c.fillText(vsFriend()
            ? t('W S · ↑ ↓ · Esc to leave')
            : t('↑ ↓ to move · Esc to leave'), mid, H - 22);
        }

        c.textAlign = 'start';
      },

      stop() { /* nothing retained */ },
    };
  },
};
