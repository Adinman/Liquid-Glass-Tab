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
