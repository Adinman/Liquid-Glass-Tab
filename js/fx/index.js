/* The interactive-background registry.
 *
 * Same shape as js/widgets/index.js, for the same reason: one table that names
 * everything, so adding a scene is one import and one line rather than a hunt
 * through the settings drawer.
 *
 * The split matters. An `ambient` scene is a background — it is chosen in
 * settings, it persists, and it must be cheap enough to leave on forever. A
 * game is launched by a button, takes the screen, dims the widgets, and ends.
 * js/fx.js treats the two differently in exactly three places: reduced motion
 * silences ambient scenes only, a game suspends and restores the ambient one,
 * and only a game gets the keyboard.
 */
import { particles } from './particles.js';
import { lightswitch } from './lightswitch.js';
import { pong } from './pong.js';

export const SCENES = {
  particles,
  lightswitch,
};

export const GAMES = {
  pong,
};

export const ALL = { ...SCENES, ...GAMES };
