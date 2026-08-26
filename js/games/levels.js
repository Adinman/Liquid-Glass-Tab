/* The in-game level picker: a small panel down the left-hand side of the court.
 *
 * It lives here rather than in the settings drawer because difficulty is a
 * thing you change *while playing* — you finish a board, decide it was too
 * easy, and want the next one bigger. Sending you to a settings tab to do that
 * means leaving the game, and a dropdown in a drawer is a strange place to keep
 * a control whose whole purpose is to restart the thing you are looking at.
 *
 * Shared by both games that have levels, so the panel is drawn, laid out and
 * hit-tested in one place. Two copies of this drifted apart the moment one of
 * them needed a different row height.
 *
 * The panel reserves its own width out of the court rather than floating over
 * it. Overlapping would put a click target on top of the board, and on a
 * minesweeper that means a cell you can see but cannot open.
 */
import { ARCADE } from '../config.js';
import { bestScore, setLevel, levelFor } from '../state.js';

const PANEL_W = 118;
const GAP = 22;
const TITLE_H = 30;
const ROW_H = 42;
const PAD = 8;

/** How much horizontal room the panel takes out of the court, including the gap
 *  between it and the board. Games subtract this before sizing their cells. */
export const reserved = () => PANEL_W + GAP * 2;

/**
 * @param gameId  the ARCADE id whose `levels` this picks from
 * @param title   the word above the rows — what the levels actually change
 * @param onPick  called with the new level once it has been stored
 */
export function createLevels(gameId, title, onPick) {
  const game = ARCADE.find(g => g.id === gameId);
  const levels = game?.levels || [];
  const unit = game?.unit || '';
  const box = { x: 0, y: 0, w: PANEL_W, h: TITLE_H + ROW_H * levels.length + PAD * 2 };
  let hover = -1;

  return {
    reserved,

    /** Pinned to the left edge and vertically centred on the court. */
    layout(host) {
      box.x = GAP;
      box.y = Math.max(GAP, (host.H - box.h) / 2);
    },

    /** The level id under a point, or null. */
    hit(x, y) {
      if (x < box.x || x > box.x + box.w) return null;
      const top = box.y + TITLE_H + PAD;
      const i = Math.floor((y - top) / ROW_H);
      if (i < 0 || i >= levels.length) return null;
      return levels[i].id;
    },

    /** Returns true when the click was the panel's, so the game knows not to
     *  also treat it as a click on the board. */
    pointerdown(x, y) {
      const id = this.hit(x, y);
      if (!id) return false;
      if (levelFor(gameId).id !== id) {
        setLevel(gameId, id);
        onPick?.();
      }
      return true;
    },

    /** Track the pointer so a row lights under the cursor. */
    move(host) {
      const p = host.pointer;
      hover = -1;
      if (!p.inside) return;
      const id = this.hit(p.x, p.y);
      if (id) hover = levels.findIndex(l => l.id === id);
    },

    draw(c, host) {
      this.move(host);
      const cur = levelFor(gameId).id;

      c.fillStyle = 'rgba(10,14,22,.5)';
      c.beginPath();
      c.roundRect(box.x, box.y, box.w, box.h, 14);
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,.12)';
      c.lineWidth = 1;
      c.stroke();

      c.textAlign = 'left';
      c.textBaseline = 'alphabetic';
      c.fillStyle = 'rgba(255,255,255,.38)';
      c.font = '600 10px system-ui, sans-serif';
      c.fillText(title.toUpperCase(), box.x + 12, box.y + 20);

      levels.forEach((l, i) => {
        const y = box.y + TITLE_H + PAD + i * ROW_H;
        const on = l.id === cur;

        if (on || hover === i) {
          c.fillStyle = on ? 'rgba(255,255,255,.13)' : 'rgba(255,255,255,.06)';
          c.beginPath();
          c.roundRect(box.x + 5, y + 2, box.w - 10, ROW_H - 6, 9);
          c.fill();
        }
        if (on) {
          // A bar down the selected row, so which one is live is readable at a
          // glance rather than from a 6% background tint.
          c.fillStyle = host.accent();
          c.beginPath();
          c.roundRect(box.x + 5, y + 8, 2.5, ROW_H - 18, 2);
          c.fill();
        }

        c.fillStyle = on ? 'rgba(255,255,255,.96)' : 'rgba(255,255,255,.66)';
        c.font = `${on ? 600 : 500} 13px system-ui, sans-serif`;
        c.fillText(l.name, box.x + 14, y + 18);

        // The record for that level, under its name. Seeing all three is most
        // of the reason to keep separate records at all.
        const b = bestScore(`${gameId}.${l.id}`);
        c.fillStyle = on ? host.accent() : 'rgba(255,255,255,.34)';
        c.font = '500 11px system-ui, sans-serif';
        c.fillText(b ? `${b}${unit}` : '—', box.x + 14, y + 32);
      });

      c.textAlign = 'start';
    },
  };
}
