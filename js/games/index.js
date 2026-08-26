/* The arcade registry.
 *
 * Same shape as js/widgets/index.js, for the same reason: one table that names
 * everything, so adding a game is one import and one line rather than a hunt
 * through the settings drawer.
 *
 * Every module in here is loaded together, the first time any game is started
 * or any preview is drawn. That is deliberate — the whole point of the dynamic
 * import in js/arcade.js is that a new tab nobody plays on loads none of it, and
 * splitting the registry further would trade a real saving for a negligible one.
 *
 * `package.py` checks these ids against ARCADE in js/config.js, so a game added
 * in one place and forgotten in the other fails the build rather than shipping
 * a picker entry that does nothing.
 */
import { game1 } from './game1.js';
import { game2 } from './game2.js';
import { game3 } from './game3.js';

export const GAMES = {
  game1,
  game2,
  game3,
};
