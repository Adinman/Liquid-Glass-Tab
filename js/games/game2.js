/* Game 2 — a snake.
 *
 * The snake moves on a fixed tick, not per frame. Tying movement to the frame
 * rate would make the game roughly twice as hard on a 144 Hz monitor as on a
 * 60 Hz one, which is the kind of thing that makes a high score meaningless.
 * The tick shortens as you eat, and that is the entire difficulty curve.
 *
 * Direction is buffered rather than applied immediately. Pressing up then left
 * inside a single tick used to apply only the left — or worse, apply the up,
 * then the left, and turn the snake back into itself on the same tick. A queue
 * of at most two means a fast double-tap around a corner does what you meant.
 *
 * The reverse guard compares against the direction actually *travelled* last
 * tick rather than the last key pressed. With the latter, pressing left then
 * right quickly while moving left is two legal-looking presses that put you
 * into your own neck.
 */
import { recordScore, bestScore, levelFor } from '../state.js';
import { createLevels, reserved } from './levels.js';

const START_MS = 130;        // ms per step at the start
const MIN_MS = 62;           // and the fastest it ever gets
const RAMP = 2.1;            // ms shaved off per apple

const DIRS = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
  W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0],
};

export const game2 = {
  id: 'game2',

  /* A still of a snake mid-run with an apple ahead of it. Fixed shape, not
     random — a preview that reshuffles on every settings redraw looks broken. */
  preview(c, w, h) {
    const cols = 9, rows = 5;
    const s = Math.min(w / cols, h / rows);
    const ox = (w - s * cols) / 2, oy = (h - s * rows) / 2;
    c.fillStyle = 'rgba(10,12,20,.55)';
    c.fillRect(0, 0, w, h);
    drawBoard(c, ox, oy, s, cols, rows);
    // Head first, same order as the live snake.
    drawSnake(c, [[5, 2], [4, 2], [4, 3], [3, 3], [2, 3]], ox, oy, s);
    drawApple(c, ox + 7 * s, oy + 1 * s, s);
  },

  create(host) {
    // Re-read whenever the picker changes it, and never mid-run: switching map
    // size restarts, so a score always belongs to the board it was set on.
    let lv = levelFor('game2');
    let KEY = `game2.${lv.id}`;
    let snake = [];
    let dir = [1, 0];
    let queued = [];
    let apple = [0, 0];
    let score = 0;
    let step = START_MS;
    let acc = 0;
    let state = 'ready';               // ready | play | over
    let over = 0;
    let beat = false;
    let eatFlash = 0;

    let cell = 0, ox = 0, oy = 0;

    function metrics() {
      // Same reservation as Game 1: the picker takes its width out of the court
      // rather than floating over the board.
      const pad = 52;
      const left = reserved();
      const avail = Math.max(120, host.W - left - pad);
      cell = Math.max(8, Math.min(34,
        Math.min(avail / lv.cols, (host.H - pad * 2.2) / lv.rows)));
      ox = left + Math.max(0, (avail - cell * lv.cols) / 2);
      oy = (host.H - cell * lv.rows) / 2 + 8;
      picker.layout(host);
    }

    const picker = createLevels('game2', 'map size', () => {
      lv = levelFor('game2');
      KEY = `game2.${lv.id}`;
      restart();
      metrics();
    });

    const onSnake = (x, y) => snake.some(s => s[0] === x && s[1] === y);

    function placeApple() {
      // Rejection sampling is fine here: the board is 560 cells and the snake
      // would have to fill most of it before this retried more than once or
      // twice, and by then the game is nearly over anyway.
      let x, y, guard = 0;
      do {
        x = Math.floor(Math.random() * lv.cols);
        y = Math.floor(Math.random() * lv.rows);
      } while (onSnake(x, y) && ++guard < 2000);
      apple = [x, y];
    }

    function restart() {
      // Three cells starting a quarter of the way in, so a small board still
      // has room ahead of the snake at the moment it starts.
      const sy = Math.floor(lv.rows / 2);
      const sx = Math.max(2, Math.floor(lv.cols / 4));
      snake = [[sx, sy], [sx - 1, sy], [sx - 2, sy]];
      dir = [1, 0];
      queued = [];
      score = 0;
      step = START_MS;
      acc = 0;
      state = 'ready';
      over = 0;
      beat = false;
      eatFlash = 0;
      placeApple();
    }

    metrics();
    restart();

    function turn(d) {
      // Starting comes first, and unconditionally. The snake begins pointing
      // right, so pressing Right is the most natural way to say "go" — and
      // that press is also a duplicate, so when this sat at the bottom behind
      // the two guards below it returned early and the game stayed frozen on
      // its start screen no matter how many times you pressed the key.
      if (state === 'ready') state = 'play';

      // Compared against the last *queued* direction if there is one, so a
      // two-key corner is judged against where the snake will be, not where it
      // is now.
      const ref = queued.length ? queued[queued.length - 1] : dir;
      if (d[0] === -ref[0] && d[1] === -ref[1]) return;   // no reversing
      if (d[0] === ref[0] && d[1] === ref[1]) return;     // no duplicates
      if (queued.length < 2) queued.push(d);
    }

    function tick() {
      if (queued.length) dir = queued.shift();
      const head = [snake[0][0] + dir[0], snake[0][1] + dir[1]];

      if (head[0] < 0 || head[1] < 0 || head[0] >= lv.cols || head[1] >= lv.rows) return die();
      // The tail cell is about to be vacated, so moving into it is legal —
      // without this exception every straight run at full length dies on its
      // own tail one step early.
      const tail = snake[snake.length - 1];
      const intoTail = head[0] === tail[0] && head[1] === tail[1];
      if (!intoTail && onSnake(head[0], head[1])) return die();

      snake.unshift(head);
      if (head[0] === apple[0] && head[1] === apple[1]) {
        score++;
        eatFlash = 180;
        step = Math.max(MIN_MS, START_MS - score * RAMP);
        placeApple();
      } else {
        snake.pop();
      }
    }

    function die() {
      state = 'over';
      over = 0;
      beat = recordScore(KEY, score);
    }

    return {
      resize: metrics,

      pointerdown(px, py, button) {
        if (button === 0 && picker.pointerdown(px, py)) return;
        if (state === 'over' && over > 300) restart();
      },

      key(e) {
        if (e.key === 'Escape') { host.exit(); return true; }
        if (state === 'over') {
          if ((e.key === 'Enter' || e.key === ' ') && over > 200) { restart(); return true; }
          return false;
        }
        const d = DIRS[e.key];
        if (!d) return false;
        turn(d);
        // Consumed so the arrow keys do not also reach the page underneath.
        return true;
      },

      frame(now, dt) {
        const c = host.c2d;
        eatFlash = Math.max(0, eatFlash - dt);

        if (state === 'play') {
          acc += dt;
          // A while loop rather than a single step: after a stall dt is capped
          // at 50 ms, but a slow frame can still owe more than one tick, and
          // dropping them makes the snake stutter rather than keep pace.
          let guard = 0;
          while (acc >= step && state === 'play' && guard++ < 4) {
            acc -= step;
            tick();
          }
        } else {
          over += state === 'over' ? dt : 0;
        }

        /* court */
        c.fillStyle = 'rgba(0,0,0,.42)';
        c.fillRect(0, 0, host.W, host.H);

        picker.draw(c, host);

        drawBoard(c, ox, oy, cell, lv.cols, lv.rows);
        c.strokeStyle = 'rgba(255,255,255,.16)';
        c.lineWidth = 1;
        c.strokeRect(ox, oy, lv.cols * cell, lv.rows * cell);

        drawApple(c, ox + apple[0] * cell, oy + apple[1] * cell, cell, eatFlash / 180);
        drawSnake(c, snake, ox, oy, cell);

        /* score */
        const best = bestScore(KEY);
        c.textAlign = 'center';
        c.textBaseline = 'alphabetic';
        c.fillStyle = 'rgba(255,255,255,.72)';
        c.font = '600 15px system-ui, sans-serif';
        c.fillText(String(score), ox + lv.cols * cell / 2, oy - 16);
        c.font = '500 12px system-ui, sans-serif';
        c.fillStyle = 'rgba(255,255,255,.4)';
        c.fillText(best ? `best ${best}` : 'no record yet', ox + lv.cols * cell / 2, oy - 32);

        if (state === 'ready') {
          c.fillStyle = 'rgba(255,255,255,.6)';
          c.font = '500 14px system-ui, sans-serif';
          c.fillText('press an arrow key to start', host.W / 2, oy + lv.rows * cell + 26);
        } else if (state === 'over') {
          const t = Math.min(1, over / 260);
          c.globalAlpha = t;
          c.fillStyle = 'rgba(255,255,255,.96)';
          c.font = `600 ${Math.round(Math.min(42, host.H * 0.05))}px system-ui, sans-serif`;
          c.fillText(beat ? 'new record' : 'caught', host.W / 2, oy - 54);
          c.globalAlpha = 1;
          c.fillStyle = 'rgba(255,255,255,.32)';
          c.font = '500 12px system-ui, sans-serif';
          c.fillText('click or Enter to play again · Esc to leave',
            host.W / 2, oy + lv.rows * cell + 26);
        } else {
          c.fillStyle = 'rgba(255,255,255,.32)';
          c.font = '500 12px system-ui, sans-serif';
          c.fillText('Esc to leave', host.W / 2, oy + lv.rows * cell + 26);
        }
        c.textAlign = 'start';
      },

      stop() { snake = []; queued = []; },
    };
  },
};

/** The playfield: a checkerboard, not a hairline grid.
 *
 *  The grid used to be 1px lines at 5.5% white, which on a bright wallpaper
 *  under the court's own dark wash was very close to invisible — you could not
 *  tell how far the next cell was, which is most of what makes this game
 *  readable. Two alternating fills give every cell a visible edge against its
 *  neighbours without drawing a single line, and they read at any cell size. */
function drawBoard(c, ox, oy, s, cols, rows) {
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      c.fillStyle = ((x + y) & 1) ? 'rgba(255,255,255,.075)' : 'rgba(0,0,0,.22)';
      c.fillRect(ox + x * s, oy + y * s, s, s);
    }
  }
}

/** The snake, as one connected body.
 *
 *  Stroked as a single path through the cell centres with round joins and caps,
 *  rather than one rounded square per cell. The per-cell version left a visible
 *  seam at every join and a stack of separate tiles at a corner, so it read as
 *  a queue of blocks that happened to be adjacent rather than as one animal.
 *
 *  Two passes: a darker, wider stroke underneath for an outline that keeps the
 *  body readable on a pale wallpaper, then the body itself. A single flat
 *  colour rather than a tail fade — alpha under 1 double-blends everywhere the
 *  path overlaps itself, which puts a bright seam on exactly the coils a fade
 *  was meant to clarify. */
function drawSnake(c, cells, ox, oy, s) {
  if (!cells.length) return;
  const px = ([x, y]) => [ox + x * s + s / 2, oy + y * s + s / 2];

  c.lineCap = 'round';
  c.lineJoin = 'round';
  const trace = () => {
    c.beginPath();
    const [hx, hy] = px(cells[0]);
    c.moveTo(hx, hy);
    for (let i = 1; i < cells.length; i++) {
      const [x, y] = px(cells[i]);
      c.lineTo(x, y);
    }
    // A single-cell snake has no segment to stroke, so give it a zero-length
    // one — with a round cap that draws as the dot it should be.
    if (cells.length === 1) c.lineTo(hx, hy);
  };

  c.strokeStyle = 'rgba(6,20,12,.55)';
  c.lineWidth = s * 0.82;
  trace(); c.stroke();

  c.strokeStyle = '#7ee7a7';
  c.lineWidth = s * 0.62;
  trace(); c.stroke();

  /* ---- the head ----
     It has to say which way the snake was going, and say it at a glance. That
     matters most at the exact moment it stops mattering to the game: when you
     have just died and are looking at a still frame trying to work out what
     happened. Two dark dots a tenth of a cell off centre, on a body of one flat
     colour, did not — the head was indistinguishable from the tail. */
  const [hx, hy] = px(cells[0]);

  // Unit direction of travel, from the neck to the head.
  let dx = 0, dy = 0;
  if (cells.length > 1) {
    dx = Math.sign(cells[0][0] - cells[1][0]);
    dy = Math.sign(cells[0][1] - cells[1][1]);
  }
  if (!dx && !dy) dx = 1;              // nowhere to look yet: face right

  // Pushed forward out of its cell, so the head leads the body instead of
  // sitting centred on the last square like every other segment.
  const cx = hx + dx * s * 0.12;
  const cy = hy + dy * s * 0.12;
  c.fillStyle = '#8ff0b5';
  c.beginPath();
  c.arc(cx, cy, s * 0.4, 0, 6.2832);
  c.fill();

  // White eyes with a dark pupil, set forward and to each side. White because
  // the body is green and dark-on-green at this size reads as texture; forward
  // because that is the whole point.
  const ex = -dy, ey = dx;             // across the direction of travel
  const eyeR = Math.max(1.5, s * 0.135);
  const pupR = Math.max(0.9, s * 0.07);
  for (const side of [1, -1]) {
    const px0 = cx + ex * side * s * 0.17 + dx * s * 0.13;
    const py0 = cy + ey * side * s * 0.17 + dy * s * 0.13;
    c.fillStyle = '#ffffff';
    c.beginPath(); c.arc(px0, py0, eyeR, 0, 6.2832); c.fill();
    // The pupil sits at the front of the eye, which is what makes it a look
    // rather than a stare.
    c.fillStyle = '#0a1810';
    c.beginPath();
    c.arc(px0 + dx * eyeR * 0.38, py0 + dy * eyeR * 0.38, pupR, 0, 6.2832);
    c.fill();
  }
}

function drawApple(c, x, y, s, flash = 0) {
  const cx = x + s / 2, cy = y + s / 2;
  const r = s * (0.3 + flash * 0.12);
  if (flash > 0) {
    c.fillStyle = `rgba(255,120,120,${(flash * 0.3).toFixed(3)})`;
    c.beginPath(); c.arc(cx, cy, r * 2.1, 0, 6.2832); c.fill();
  }
  c.fillStyle = '#ff6b6b';
  c.beginPath(); c.arc(cx, cy, r, 0, 6.2832); c.fill();
  c.fillStyle = 'rgba(255,255,255,.5)';
  c.beginPath(); c.arc(cx - r * 0.3, cy - r * 0.3, r * 0.28, 0, 6.2832); c.fill();
}
