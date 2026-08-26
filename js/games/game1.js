/* Game 1 — a minesweeper.
 *
 * Scored on time, and only on a win. A loss is not a result: you can lose in
 * one click, and a "best" that rewards that is not a record of anything. That
 * is also why this is the one game in the arcade where lower is better, which
 * `recordScore` has to be told explicitly — see js/state.js.
 *
 * The first click is always safe. Standard for the genre, and not politeness:
 * without it roughly one game in eight is over before it has started, which
 * reads as the game being broken rather than as bad luck. The mine under the
 * first cell is moved somewhere else rather than the board being regenerated,
 * so the count stays exactly right.
 *
 * The board size comes from the chosen level, never from the window. Scaling
 * the grid to the viewport would make the record meaningless — the same number
 * of seconds would describe a different game on every monitor. The *cell size*
 * scales instead, so a level fills whatever window it is given, and each level
 * keeps its own record under its own key.
 */
import { recordScore, bestScore, levelFor } from '../state.js';
import { createLevels, reserved } from './levels.js';

/* Per-number colours, the convention every version of this game uses. Reading
   them off the accent instead would make 1 and 2 nearly the same hue on most
   accents, and the whole point of the numbers is telling them apart fast. */
const NUM_COLOURS = ['', '#5db1ff', '#4fd18b', '#ff8a8a', '#c08cff',
                     '#ffb454', '#4fd6d6', '#e8e8e8', '#9aa4b8'];

function newBoard(lv) {
  const n = lv.cols * lv.rows;
  return {
    lv,
    idx: (x, y) => y * lv.cols + x,
    mine: new Uint8Array(n),
    near: new Uint8Array(n),
    open: new Uint8Array(n),
    flag: new Uint8Array(n),
  };
}

/** The eight neighbours of a cell, clipped to the board. */
function around(b, x, y, fn) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= b.lv.cols || ny >= b.lv.rows) continue;
      fn(nx, ny);
    }
  }
}

/** Scatter the mines, avoiding one cell and its neighbours so the first click
 *  opens something rather than ending the game. */
function layMines(b, safeX, safeY) {
  const { cols, rows, mines } = b.lv;
  const banned = new Set([b.idx(safeX, safeY)]);
  around(b, safeX, safeY, (x, y) => banned.add(b.idx(x, y)));

  // Hard is 99 mines in 480 cells with 9 banned, so there is always room — but
  // clamp anyway rather than spin forever if a level is ever mis-specified.
  const want = Math.min(mines, cols * rows - banned.size);
  let placed = 0;
  while (placed < want) {
    const i = Math.floor(Math.random() * cols * rows);
    if (b.mine[i] || banned.has(i)) continue;
    b.mine[i] = 1;
    placed++;
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let n = 0;
      around(b, x, y, (nx, ny) => { if (b.mine[b.idx(nx, ny)]) n++; });
      b.near[b.idx(x, y)] = n;
    }
  }
}

export const game1 = {
  id: 'game1',

  /* A still of a game in progress: some cleared cells, some numbers, a flag.
     Drawn from the same primitives as the real board so the picker is showing
     the game rather than an illustration of it. */
  preview(c, w, h) {
    const cols = 8, rows = 5;
    const s = Math.min(w / cols, h / rows);
    const ox = (w - s * cols) / 2, oy = (h - s * rows) / 2;
    // A fixed pattern, not random: a preview that reshuffles every time the
    // settings panel redraws reads as a glitch.
    const map = [
      '11100000',
      '1F100000',
      '11111000',
      '0001F100',
      '000111 0',
    ];
    c.fillStyle = 'rgba(10,12,20,.55)';
    c.fillRect(0, 0, w, h);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const ch = map[y][x];
        const px = ox + x * s, py = oy + y * s;
        drawCell(c, px, py, s, {
          open: ch !== ' ' && ch !== 'F',
          flag: ch === 'F',
          near: ch >= '1' && ch <= '8' ? +ch : 0,
        });
      }
    }
  },

  create(host) {
    // Re-read whenever the picker changes it, but never mid-board: switching
    // deals a fresh game, so a run always finishes on the level it started on
    // and files under that level's key.
    let lv = levelFor('game1');
    let KEY = `game1.${lv.id}`;
    let b = newBoard(lv);
    let laid = false;                  // mines are placed on the first click
    let state = 'play';                // play | won | lost
    let started = 0;                   // ms, set on the first click
    let elapsed = 0;                   // seconds, frozen when the game ends
    let over = 0;                      // ms since the game ended
    let beat = false;
    let boomAt = -1;                   // the mine that was clicked
    let hoverI = -1;

    // Geometry, recomputed on resize.
    let cell = 0, ox = 0, oy = 0;

    function metrics() {
      // Leave room for the header line above the board and the hint below it,
      // and for the level picker down the left-hand side. The picker reserves
      // its width rather than floating over the board — a click target on top
      // of a minesweeper is a cell you can see but cannot open.
      const pad = 56;
      const left = reserved();
      const avail = Math.max(120, host.W - left - pad);
      // Hard is 30 wide, so the minimum has to be small enough that it still
      // fits a laptop screen — otherwise the board runs off both edges.
      cell = Math.max(11, Math.min(38,
        Math.min(avail / lv.cols, (host.H - pad * 2.4) / lv.rows)));
      ox = left + Math.max(0, (avail - cell * lv.cols) / 2);
      oy = (host.H - cell * lv.rows) / 2 + 10;
      picker.layout(host);
    }

    const picker = createLevels('game1', 'difficulty', () => {
      lv = levelFor('game1');
      KEY = `game1.${lv.id}`;
      restart();
      metrics();
    });

    metrics();

    const cellAt = (px, py) => {
      const x = Math.floor((px - ox) / cell);
      const y = Math.floor((py - oy) / cell);
      if (x < 0 || y < 0 || x >= lv.cols || y >= lv.rows) return -1;
      return b.idx(x, y);
    };

    /** Open a cell, cascading through the zero-neighbour region.
     *
     *  An explicit stack rather than recursion: a board that is mostly empty
     *  can cascade over 200 cells in one click, and each of those would be a
     *  frame of a recursive call for no benefit. */
    function open(i) {
      if (b.open[i] || b.flag[i]) return;
      const stack = [i];
      while (stack.length) {
        const cur = stack.pop();
        if (b.open[cur] || b.flag[cur]) continue;
        b.open[cur] = 1;
        if (b.near[cur] !== 0) continue;
        const cx = cur % lv.cols, cy = (cur / lv.cols) | 0;
        around(b, cx, cy, (nx, ny) => {
          const ni = b.idx(nx, ny);
          if (!b.open[ni] && !b.mine[ni]) stack.push(ni);
        });
      }
    }

    /** Won when every cell that is not a mine has been opened. Deliberately not
     *  "every mine is flagged": that would make the game unwinnable for anyone
     *  who clears it without bothering to flag, which is most people. */
    function checkWin() {
      for (let i = 0; i < b.open.length; i++) {
        if (!b.mine[i] && !b.open[i]) return;
      }
      state = 'won';
      over = 0;
      elapsed = (performance.now() - started) / 1000;
      beat = recordScore(KEY, Math.max(1, Math.round(elapsed)), true);
    }

    function reveal(i) {
      if (!laid) {
        layMines(b, i % lv.cols, (i / lv.cols) | 0);
        laid = true;
        started = performance.now();
      }
      if (b.flag[i] || b.open[i]) return;
      if (b.mine[i]) {
        b.open[i] = 1;
        boomAt = i;
        state = 'lost';
        over = 0;
        elapsed = started ? (performance.now() - started) / 1000 : 0;
        return;
      }
      open(i);
      checkWin();
    }

    /** Clicking a satisfied number opens its remaining neighbours. Without it
     *  the endgame is a lot of clicking cells you have already worked out. */
    function chord(i) {
      if (!b.open[i] || !b.near[i]) return;
      const cx = i % lv.cols, cy = (i / lv.cols) | 0;
      let flags = 0;
      around(b, cx, cy, (nx, ny) => { if (b.flag[b.idx(nx, ny)]) flags++; });
      if (flags !== b.near[i]) return;
      around(b, cx, cy, (nx, ny) => {
        const ni = b.idx(nx, ny);
        if (!b.flag[ni] && !b.open[ni]) reveal(ni);
      });
    }

    function restart() {
      b = newBoard(lv);
      laid = false;
      state = 'play';
      started = 0; elapsed = 0; over = 0;
      beat = false; boomAt = -1;
    }

    return {
      resize: metrics,

      pointerdown(px, py, button) {
        // The picker gets first refusal, and only on the left button — a
        // right-click is a flag and has no business changing difficulty.
        if (button === 0 && picker.pointerdown(px, py)) return;
        if (state !== 'play') {
          if (over > 300) restart();
          return;
        }
        const i = cellAt(px, py);
        if (i < 0) return;
        if (button === 2) {
          // Flagging before the mines exist is allowed and harmless — the
          // first *reveal* is what lays them, and it avoids the flagged cell
          // only because it avoids the clicked one.
          if (!b.open[i]) b.flag[i] ^= 1;
          return;
        }
        if (button !== 0) return;
        if (b.open[i]) chord(i);
        else reveal(i);
      },

      key(e) {
        if (e.key === 'Escape') { host.exit(); return true; }
        if ((e.key === 'Enter' || e.key === 'r' || e.key === 'R')
            && (state !== 'play' ? over > 200 : true)) { restart(); return true; }
        return false;
      },

      frame(now, dt) {
        const c = host.c2d;
        if (state !== 'play') over += dt;

        const p = host.pointer;
        hoverI = p.inside && state === 'play' ? cellAt(p.x, p.y) : -1;

        // A dark court so the board reads against any wallpaper, the same as
        // the other two games.
        c.fillStyle = 'rgba(0,0,0,.42)';
        c.fillRect(0, 0, host.W, host.H);

        /* header: mines left, and the clock */
        let flags = 0;
        for (let i = 0; i < b.flag.length; i++) if (b.flag[i]) flags++;
        const secs = state === 'play'
          ? (started ? (now - started) / 1000 : 0)
          : elapsed;

        c.textAlign = 'center';
        c.textBaseline = 'alphabetic';
        c.font = '600 15px system-ui, sans-serif';
        c.fillStyle = 'rgba(255,255,255,.72)';
        const boardW = cell * lv.cols;
        c.fillText(`${lv.mines - flags} left`, ox + boardW * 0.22, oy - 16);
        c.fillText(`${secs.toFixed(1)}s`, ox + boardW * 0.78, oy - 16);

        const best = bestScore(KEY);
        c.font = '500 12px system-ui, sans-serif';
        c.fillStyle = 'rgba(255,255,255,.4)';
        c.fillText(best ? `best ${best}s` : 'no record yet', ox + boardW / 2, oy - 16);

        picker.draw(c, host);

        /* board */
        for (let y = 0; y < lv.rows; y++) {
          for (let x = 0; x < lv.cols; x++) {
            const i = b.idx(x, y);
            drawCell(c, ox + x * cell, oy + y * cell, cell, {
              open: !!b.open[i],
              flag: !!b.flag[i],
              near: b.near[i],
              mine: !!b.mine[i] && state !== 'play',
              boom: i === boomAt,
              hover: i === hoverI && !b.open[i],
            });
          }
        }

        /* result */
        if (state !== 'play') {
          const t = Math.min(1, over / 260);
          c.globalAlpha = t;
          c.textAlign = 'center';
          c.fillStyle = 'rgba(255,255,255,.96)';
          c.font = `600 ${Math.round(Math.min(42, host.H * 0.05))}px system-ui, sans-serif`;
          c.fillText(state === 'won' ? (beat ? 'new record' : 'cleared') : 'boom',
            host.W / 2, oy - 46);
          if (state === 'won') {
            c.font = '500 14px system-ui, sans-serif';
            c.fillStyle = 'rgba(255,255,255,.66)';
            c.fillText(`${elapsed.toFixed(1)} seconds`, host.W / 2, oy - 26);
          }
          c.globalAlpha = 1;
        }

        c.font = '500 12px system-ui, sans-serif';
        c.fillStyle = 'rgba(255,255,255,.32)';
        c.fillText(state === 'play'
          ? 'right-click to flag · R to restart · Esc to leave'
          : 'click to play again · Esc to leave',
          host.W / 2, oy + cell * lv.rows + 26);
        c.textAlign = 'start';
      },

      stop() { b = newBoard(lv); },
    };
  },
};

/** One cell. Shared by the board and the preview so they cannot drift apart. */
function drawCell(c, x, y, s, { open, flag, near, mine, boom, hover }) {
  const pad = Math.max(0.5, s * 0.04);
  const r = Math.max(2, s * 0.16);
  c.beginPath();
  c.roundRect(x + pad, y + pad, s - pad * 2, s - pad * 2, r);

  if (boom) c.fillStyle = 'rgba(255,90,90,.85)';
  else if (open) c.fillStyle = 'rgba(255,255,255,.06)';
  else if (hover) c.fillStyle = 'rgba(255,255,255,.28)';
  else c.fillStyle = 'rgba(255,255,255,.19)';
  c.fill();

  if (!open) {
    // A top highlight, so an unopened cell reads as raised rather than as a
    // slightly different flat square.
    c.strokeStyle = 'rgba(255,255,255,.22)';
    c.lineWidth = 1;
    c.stroke();
  }

  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const cx = x + s / 2, cy = y + s / 2;

  if (flag) {
    c.fillStyle = '#ff6b6b';
    c.font = `600 ${Math.round(s * 0.5)}px system-ui, sans-serif`;
    c.fillText('⚑', cx, cy + s * 0.02);
  } else if (mine) {
    c.fillStyle = boom ? '#fff' : 'rgba(255,255,255,.75)';
    c.beginPath();
    c.arc(cx, cy, s * 0.18, 0, 6.2832);
    c.fill();
  } else if (open && near > 0) {
    c.fillStyle = NUM_COLOURS[near] || '#fff';
    c.font = `700 ${Math.round(s * 0.52)}px system-ui, sans-serif`;
    c.fillText(String(near), cx, cy + s * 0.02);
  }
  c.textAlign = 'start';
  c.textBaseline = 'alphabetic';
}
