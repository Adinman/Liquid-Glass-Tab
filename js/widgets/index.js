import * as core from './core.js';
import * as data from './data.js';
import * as music from './music.js';
import * as prod from './productivity.js';

export const REGISTRY = {
  clock: core.clock,
  search: core.search,
  quote: core.quote,
  calendar: core.calendar,
  worldclock: core.worldclock,
  countdown: core.countdown,
  speeddial: core.speeddial,
  battery: core.battery,
  weather: data.weather,
  news: data.news,
  crypto: data.crypto_,
  spotify: music.spotify,
  visualizer: music.visualizer,
  lyrics: music.lyrics,
  notes: prod.notes,
  tasks: prod.tasks,
  pomodoro: prod.pomodoro,
};

export { searchPlaces, detectPlace } from './data.js';
