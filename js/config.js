// Default settings. Everything the UI can change lives here.

export const WALLPAPERS = [
  { id: 'aurora',   name: 'Aurora',    css: 'linear-gradient(140deg,#132a4d 0%,#3b1b63 48%,#0a2b3d 100%)' },
  { id: 'ember',    name: 'Ember',     css: 'linear-gradient(150deg,#2b1020 0%,#67231f 50%,#1a0d19 100%)' },
  { id: 'forest',   name: 'Forest',    css: 'linear-gradient(160deg,#08251f 0%,#124436 45%,#06181c 100%)' },
  { id: 'midnight', name: 'Midnight',  css: 'linear-gradient(160deg,#05070f 0%,#131a2e 50%,#080a14 100%)' },
  { id: 'candy',    name: 'Candy',     css: 'linear-gradient(140deg,#3a1c5c 0%,#8b2f6b 45%,#20406e 100%)' },
  { id: 'sand',     name: 'Sand',      css: 'linear-gradient(150deg,#3a2a1c 0%,#7a5a37 50%,#2a2118 100%)' },
  { id: 'ice',      name: 'Ice',       css: 'linear-gradient(150deg,#0e2537 0%,#215d75 50%,#0b1b2c 100%)' },
  { id: 'mono',     name: 'Mono',      css: 'linear-gradient(160deg,#14161c 0%,#2a2e38 50%,#0e1015 100%)' },
  { id: 'dawn',     name: 'Dawn',      css: 'linear-gradient(150deg,#f7c6a3 0%,#e58a9a 45%,#8ea6d8 100%)' },
  { id: 'paper',    name: 'Paper',     css: 'linear-gradient(150deg,#eef1f6 0%,#dfe4ee 50%,#e9ecf3 100%)' },
];

/* ---------------- packaged backgrounds ----------------
   Stills and clips that ship inside the extension, next to the gradients
   above. Both reuse the fields a user's own wallpaper already uses —
   `wallpaperCustom` for the still layer, `wallpaperVideo` for the video one —
   under a `bg:` prefix, so every existing rule about which layer wins applies
   to them unchanged.

   Packaged rather than fetched, which is what keeps them cheap: no host
   permission, no network request, nothing added to the store's data
   disclosure, and Chrome shares one decode of a packaged file across every
   open tab — where a blob: URL out of IndexedDB is minted per page.

   Only the id is stored. It is looked up in these tables rather than pasted
   into a path, so an imported settings file carrying `bg:../../something`
   resolves to nothing instead of resolving to a file.

   Regenerate the files with `python assets/make_backgrounds.py`. */
export const BG_PREFIX = 'bg:';

export const PHOTOS = [
  { id: 'galaxy',   name: 'Galaxy',      credit: 'Alisson Silva / Pexels' },
  { id: 'milkyway', name: 'Milky Way',   credit: 'Anjan Karki / Pexels' },
  { id: 'lake',     name: 'Alpine Lake', credit: 'eberhard grossgasteiger / Pexels' },
  { id: 'meadow',   name: 'Meadow',      credit: 'Poliakova / Pexels' },
  { id: 'smoke',    name: 'Ember',       credit: 'Thales / Pexels' },
];

export const CLIPS = [
  { id: 'dusklake', name: 'Still Water', credit: 'Pixabay' },
  { id: 'blossom',  name: 'Blossom',     credit: 'Pixabay' },
  { id: 'rain',     name: 'Rain',        credit: 'Pixabay' },
];

export const photoFile = id => `assets/bg/${id}.avif`;
export const clipFile  = id => `assets/bg/${id}.mp4`;
export const bgThumb   = id => `assets/bg/thumbs/${id}.webp`;

/** A clip's first frame at a size that can actually fill a screen.
 *
 *  The picker thumbnail is 192x108, which is right for a 64px swatch and
 *  hopeless as a full-screen stand-in: blown up to 1920 wide it is a 10x
 *  upscale, so every new tab under a live wallpaper showed a blurred smear
 *  resolving into sharp video. 1280 wide costs about 30 KB an clip in AVIF. */
export const clipPoster = id => `assets/bg/${id}.poster.avif`;

/** `bg:<id>` -> its entry in `list`, or null for anything else. */
export function bundled(list, value) {
  if (typeof value !== 'string' || !value.startsWith(BG_PREFIX)) return null;
  const id = value.slice(BG_PREFIX.length);
  return list.find(b => b.id === id) || null;
}

/* Interactive backgrounds: names and descriptions only.

   The implementations live in js/fx/ and are imported the first time one is
   switched on, so the settings drawer cannot import them — listing a scene in
   the picker would drag all of them onto every new tab, which is exactly the
   cost the lazy import exists to avoid. Hence the split: this table is the
   single source of the user-facing strings, and the modules hold only the id,
   the ambient flag and the code.

   `package.py` checks these ids against the registry, so a scene added here
   and forgotten in js/fx/index.js fails the build rather than shipping a
   picker entry that does nothing. */
export const FX_SCENES = [
  { id: 'particles', name: 'Particles',
    blurb: 'Gathers around the cursor. Hold the mouse down to push it away.' },
  { id: 'lightswitch', name: 'Light switch',
    blurb: 'Drag it anywhere. Click it to brighten the wallpaper and the glass.' },
];

export const FX_GAMES = [
  { id: 'pong', name: 'Pong',
    blurb: 'Endless rally against the computer. It gets faster the longer you last.' },
];

export const ENGINES = {
  google:     { name: 'Google',     url: 'https://www.google.com/search?q=%s' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  bing:       { name: 'Bing',       url: 'https://www.bing.com/search?q=%s' },
  brave:      { name: 'Brave',      url: 'https://search.brave.com/search?q=%s' },
  youtube:    { name: 'YouTube',    url: 'https://www.youtube.com/results?search_query=%s' },
  perplexity: { name: 'Perplexity', url: 'https://www.perplexity.ai/search?q=%s' },
};

export const FEEDS = [
  { id: 'bbc',    name: 'BBC',        url: 'https://feeds.bbci.co.uk/news/world/rss.xml',      on: true },
  { id: 'hn',     name: 'Hacker News',url: 'https://hnrss.org/frontpage',                       on: true },
  { id: 'verge',  name: 'The Verge',  url: 'https://www.theverge.com/rss/index.xml',            on: true },
  { id: 'ars',    name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', on: false },
  { id: 'nyt',    name: 'NYT',        url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', on: false },
];

/** Starter bookmark sets for new homescreens. */
export const PRESETS = {
  work: { name: 'Work', icon: '💼', links: [
    ['Gmail', 'https://mail.google.com'],
    ['Calendar', 'https://calendar.google.com'],
    ['Drive', 'https://drive.google.com'],
    ['Slack', 'https://slack.com'],
    ['Notion', 'https://www.notion.so'],
    ['Zoom', 'https://zoom.us'],
    ['LinkedIn', 'https://www.linkedin.com'],
  ] },
  social: { name: 'Social', icon: '💬', links: [
    ['X', 'https://x.com'],
    ['Instagram', 'https://www.instagram.com'],
    ['Reddit', 'https://www.reddit.com'],
    ['Discord', 'https://discord.com/app'],
    ['Facebook', 'https://www.facebook.com'],
    ['TikTok', 'https://www.tiktok.com'],
  ] },
  fun: { name: 'Fun', icon: '🎮', links: [
    ['Roblox', 'https://www.roblox.com'],
    ['Steam', 'https://store.steampowered.com'],
    ['Epic Games', 'https://store.epicgames.com'],
    ['Minecraft', 'https://www.minecraft.net'],
    ['itch.io', 'https://itch.io'],
    ['CrazyGames', 'https://www.crazygames.com'],
    ['Poki', 'https://poki.com'],
    ['Chess.com', 'https://www.chess.com'],
    ['Xbox Cloud', 'https://www.xbox.com/play'],
    ['YouTube', 'https://www.youtube.com'],
    ['Twitch', 'https://www.twitch.tv'],
    ['Netflix', 'https://www.netflix.com'],
    ['Spotify', 'https://open.spotify.com'],
    ['IMDb', 'https://www.imdb.com'],
  ] },
  study: { name: 'Study', icon: '📚', links: [
    ['Wikipedia', 'https://www.wikipedia.org'],
    ['Khan Academy', 'https://www.khanacademy.org'],
    ['Google Scholar', 'https://scholar.google.com'],
    ['Quizlet', 'https://quizlet.com'],
    ['Coursera', 'https://www.coursera.org'],
    ['Desmos', 'https://www.desmos.com/calculator'],
  ] },
  dev: { name: 'Dev', icon: '⌨️', links: [
    ['GitHub', 'https://github.com'],
    ['Stack Overflow', 'https://stackoverflow.com'],
    ['MDN', 'https://developer.mozilla.org'],
    ['npm', 'https://www.npmjs.com'],
    ['Can I Use', 'https://caniuse.com'],
    ['CodePen', 'https://codepen.io'],
  ] },
  news: { name: 'News', icon: '📰', links: [
    ['BBC', 'https://www.bbc.com/news'],
    ['Reuters', 'https://www.reuters.com'],
    ['AP', 'https://apnews.com'],
    ['Hacker News', 'https://news.ycombinator.com'],
    ['The Verge', 'https://www.theverge.com'],
    ['Ars Technica', 'https://arstechnica.com'],
  ] },
  shopping: { name: 'Shopping', icon: '🛒', links: [
    ['Amazon', 'https://www.amazon.com'],
    ['eBay', 'https://www.ebay.com'],
    ['Etsy', 'https://www.etsy.com'],
    ['Best Buy', 'https://www.bestbuy.com'],
    ['AliExpress', 'https://www.aliexpress.com'],
  ] },
};

/* ---------------- countdown targets ----------------
   Each holiday resolves its own next occurrence, so the widget rolls over on
   its own instead of going stale the day after. */

/* A holiday counts as "not yet passed" for the whole of its own day, not just
   until midnight. Comparing a midnight target against the current time rolled
   over as the day began, so on Christmas morning the widget read "364d until
   Christmas" and the countdown's "it's here" state was unreachable. */
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);

const nextFixed = (month, day) => from => {
  const y = from.getFullYear();
  const d = new Date(y, month, day, 0, 0, 0);
  return d >= startOfDay(from) ? d : new Date(y + 1, month, day, 0, 0, 0);
};

/** e.g. the 4th Thursday of November. weekday: 0=Sun. */
const nextNthWeekday = (month, weekday, n) => from => {
  const on = y => {
    const first = new Date(y, month, 1);
    const shift = (weekday - first.getDay() + 7) % 7;
    return new Date(y, month, 1 + shift + (n - 1) * 7, 0, 0, 0);
  };
  const y = from.getFullYear();
  const d = on(y);
  return d >= startOfDay(from) ? d : on(y + 1);
};

/** Anonymous Gregorian algorithm. */
function easterFor(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day, 0, 0, 0);
}
const nextEaster = from => {
  const y = from.getFullYear();
  const d = easterFor(y);
  return d >= startOfDay(from) ? d : easterFor(y + 1);
};

export const HOLIDAYS = {
  newyear:      { name: 'New Year',        next: nextFixed(0, 1) },
  valentines:   { name: 'Valentine’s Day', next: nextFixed(1, 14) },
  stpatricks:   { name: 'St Patrick’s Day',next: nextFixed(2, 17) },
  easter:       { name: 'Easter',          next: nextEaster },
  mothersday:   { name: 'Mother’s Day',    next: nextNthWeekday(4, 0, 2) },
  fathersday:   { name: 'Father’s Day',    next: nextNthWeekday(5, 0, 3) },
  july4:        { name: 'Independence Day',next: nextFixed(6, 4) },
  halloween:    { name: 'Halloween',       next: nextFixed(9, 31) },
  thanksgiving: { name: 'Thanksgiving',    next: nextNthWeekday(10, 4, 4) },
  christmas:    { name: 'Christmas',       next: nextFixed(11, 25) },
  newyearseve:  { name: 'New Year’s Eve',  next: nextFixed(11, 31) },
};

export const QUOTES = [
  ['Simplicity is the ultimate sophistication.', 'Leonardo da Vinci'],
  ['The way to get started is to quit talking and begin doing.', 'Walt Disney'],
  ['Everything should be made as simple as possible, but no simpler.', 'Albert Einstein'],
  ['It always seems impossible until it is done.', 'Nelson Mandela'],
  ['Perfection is achieved when there is nothing left to take away.', 'Antoine de Saint-Exupéry'],
  ['Slow is smooth, and smooth is fast.', 'Proverb'],
  ['You do not rise to the level of your goals. You fall to the level of your systems.', 'James Clear'],
  ['The best time to plant a tree was 20 years ago. The second best time is now.', 'Proverb'],
  ['Make it work, make it right, make it fast.', 'Kent Beck'],
  ['What we do now echoes in eternity.', 'Marcus Aurelius'],
  ['Amateurs sit and wait for inspiration. The rest of us just get up and go to work.', 'Stephen King'],
  ['Done is better than perfect.', 'Sheryl Sandberg'],
];

/** Widget defaults: position is a % of the viewport (top-left anchor). */
export const DEFAULTS = {
  version: 1,

  // appearance
  scheme: 'dark',
  accent: '#7cc6ff',
  blur: 18,
  saturation: 180,
  brightness: 108,
  tintAlpha: 10,        // %
  edgeAlpha: 55,        // %
  radius: 26,
  refract: 42,          // displacement strength; 0 disables
  sheen: true,
  animateBg: true,
  grain: 5,             // %
  vignette: 100,        // %
  mesh: 85,             // %
  wallpaper: 'aurora',
  wallpaperCustom: '',    // data URL or remote URL
  wallpaperVideo: '',     // 'local' (IndexedDB) | http(s) URL | '' for none
  wallpaperVideoName: '', // shown in settings
  videoDim: 25,           // % black overlay, keeps widgets readable
  stillDim: 0,            // same, for a photo wallpaper. 0 = show it as it is
  videoSpeed: 100,        // % playback rate
  videoPauseHidden: true, // pause decoding when the tab isn't visible
  fontScale: 100,

  // dock
  dockEdge: 'bottom',
  dockSize: 56,
  dockMagnify: 1.55,
  dockLabels: true,
  dockAutohide: false,
  dockHover: 'magnify',   // magnify | lift | pop | bounce | wiggle | jelly | none
  dockGap: 6,
  dockVibrancy: 135,    // saturation % applied to favicons
  dockContrast: 108,
  iconSource: 'auto',   // auto | chrome | sharp
  dockFolder: '1',      // '1' = bookmarks bar
  dockShowTopSites: false,
  dockMaxItems: 24,

  // behaviour
  widgetScaleMode: 'window',   // 'window' shrinks widgets to fit a small window, 'fixed' never does
  editMode: false,
  searchEngine: 'google',
  suggestions: true,
  userName: '',
  temperatureUnit: 'celsius',
  windUnit: 'kmh',
  clock24: false,
  showSeconds: true,
  clockSize: 76,

  // location (weather)
  place: null,              // {name, lat, lon, country}
  weatherPrivacy: 'hidden', // full | country | hidden — decreasing specificity

  // private search
  searchIncognito: false,   // search bar opens results in a private window
  searchIncognitoEngine: '', // '' = whichever engine is normally selected

  // news
  feeds: FEEDS,
  newsCount: 12,

  // spotify
  spotifyClientId: '',
  vizSource: 'sim',       // sim | mic | system | tab
  vizMode: 'bars',        // bars | radial
  vizSensitivity: 100,    // % gain applied to captured audio
  vizVocal: 55,           // % vocal/transient emphasis over raw bass energy
  vizSplit: true,         // beat in the centre, vocals on the flanks
  vizBpm: 120,
  lyricsOffset: 0,      // ms

  // misc widgets
  worldClocks: [
    { label: 'New York', tz: 'America/New_York' },
    { label: 'London',   tz: 'Europe/London' },
    { label: 'Tokyo',    tz: 'Asia/Tokyo' },
  ],
  countdownMode: 'holiday',   // holiday | custom
  countdownHoliday: 'christmas',
  countdownLabel: '',         // custom mode only
  countdownDate: '',          // custom mode only, YYYY-MM-DD
  coins: 'bitcoin,ethereum,solana',

  // The light switch's own state and where it sits, as percentages of the
   // viewport so it lands in the same place on any monitor. Both belong to the
   // scene rather than to the theme: turning the scene off leaves the lights
   // where they were, and turning it back on picks them up again.
  fxLights: false,
  fxSwitch: { x: 50, y: 72 },
  // How far the lights lift the wallpaper, as a percentage. The glass takes a
  // fraction of this rather than the whole of it — matching them makes the
  // panels look washed out well before the wallpaper looks bright.
  fxLightLift: 114,

  // Interactive background. '' is none; anything else is an id in
  // js/fx/index.js SCENES. An unknown id resolves to nothing rather than
  // throwing, so removing a scene in a later version cannot brick a tab.
  fxScene: '',
  // Pong's all-time record.
  pongBest: 0,

  // homescreens. Widgets are shared across all of them by design; only the
  // dock's bookmark folder changes. Seeded on first run from dockFolder.
  spaces: [],
  activeSpace: '',
  settingsPos: null,      // {x, y, h} once the panel has been dragged

  // layout: id -> {on, x, y}
  widgets: {
    clock:      { on: true,  x: 50,   y: 16, anchor: 'center' },
    search:     { on: true,  x: 50,   y: 40, anchor: 'center' },
    weather:    { on: true,  x: 3.5,  y: 8 },
    news:       { on: true,  x: 3.5,  y: 52 },
    spotify:    { on: true,  x: 74,   y: 8 },
    visualizer: { on: true,  x: 74,   y: 30 },
    lyrics:     { on: true,  x: 74,   y: 50 },
    tasks:      { on: false, x: 46,   y: 58 },
    notes:      { on: false, x: 24,   y: 58 },
    pomodoro:   { on: false, x: 46,   y: 8 },
    quote:      { on: false, x: 34,   y: 74 },
    speeddial:  { on: false, x: 34,   y: 58 },
    worldclock: { on: false, x: 3.5,  y: 74 },
    countdown:  { on: false, x: 62,   y: 74 },
    crypto:     { on: false, x: 3.5,  y: 62 },
    calendar:   { on: false, x: 62,   y: 8 },
    battery:    { on: false, x: 3.5,  y: 84 },
  },
};

/** Per-widget size, as a percentage of the widget's natural size.
 *  Stored per widget as `size`; absent means 100.
 *
 *  Bounded at both ends on purpose. An imported settings file is untrusted
 *  input and this number becomes a CSS zoom, so an unchecked one is either
 *  NaN (the panel disappears) or large enough to bury the settings button
 *  that would let you undo it. `state.js` clamps to these on load and import. */
export const WIDGET_SIZE = { min: 50, max: 200, step: 5, default: 100 };

/** Shrink-to-fit bounds for the layout pass in `app.js`.
 *
 *  Widgets are only ever scaled DOWN, never up. Scaling up was the first
 *  attempt and it was wrong twice over: it keyed off window *width*, so a wide
 *  short window made everything bigger in the one dimension that had no room,
 *  and enlarging does not suit every widget anyway — a bigger clock is fine, a
 *  bigger news list is just a news list with fewer stories visible.
 *
 *  `min` is a readability floor. Past it the layout pass stops shrinking and
 *  starts pushing widgets apart instead. */
export const WIDGET_SCALE = { min: 0.5, gap: 14 };

/** The viewport the shipped default layout was arranged for.
 *
 *  A widget's x/y are percentages, but a percentage only means something
 *  against a size. This is that size for any widget the user has never moved;
 *  a widget they have dragged records the viewport it was dropped in as vw/vh.
 *  Resolving against the size a position was authored at is what lets gaps be
 *  preserved in pixels, which is what stops the layout stretching when the
 *  window changes shape. */
export const CANON = { w: 1920, h: 1080 };
// Not 1440: the default visualiser sits at x=74% and is 440px wide, so it needs
// a 1786px viewport before it fits at all. Resolving the shipped defaults
// against a width they overflow put the right-hand column off the edge before
// anything else had a chance to go wrong.

/** The size of one widget's config entry, as a percentage, always in range. */
export function widgetSize(cfg) {
  const n = Number(cfg?.size);
  if (!Number.isFinite(n)) return WIDGET_SIZE.default;
  return Math.min(WIDGET_SIZE.max, Math.max(WIDGET_SIZE.min, n));
}

export const WIDGET_META = {
  clock:      'Clock & date',
  search:     'Search bar',
  weather:    'Weather',
  news:       'News',
  spotify:    'Spotify player',
  visualizer: 'Audio visualizer',
  lyrics:     'Synced lyrics',
  tasks:      'To-do list',
  notes:      'Notes',
  pomodoro:   'Focus timer',
  quote:      'Quote',
  speeddial:  'Speed dial',
  worldclock: 'World clocks',
  countdown:  'Countdown',
  crypto:     'Crypto prices',
  calendar:   'Calendar',
  battery:    'Battery',
};
