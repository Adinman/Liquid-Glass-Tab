// Service worker: keeps caches warm so a new tab paints instantly, and
// refreshes the Spotify token in the background.

const ALARM = 'lgt-refresh';

// Opened once, the first time the extension is installed. Guarded on
// `reason === 'install'` on purpose: without it this fires on every automatic
// update too, which turns a one-off into a recurring interruption and is the
// thing that gets extensions uninstalled.
const SUPPORT_URL = 'https://www.patreon.com/cw/CEASEprod';

chrome.runtime.onInstalled.addListener(details => {
  chrome.alarms.create(ALARM, { periodInMinutes: 10 });
  if (details.reason === 'install') {
    chrome.tabs.create({ url: SUPPORT_URL }).catch(() => {
      /* Never let a failed tab block the install. */
    });
  }
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: 10 });
});

// Clicking the toolbar icon opens a new tab (which is our page).
chrome.action.onClicked.addListener(() => chrome.tabs.create({}));

// Tab audio capture. chrome.tabCapture.capture() can't run in a service
// worker, so the documented MV3 route is to mint a stream id here and let the
// new tab page turn it into a MediaStream via getUserMedia.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'lgt:tabStreamId') return;
  try {
    chrome.tabCapture.getMediaStreamId(
      { targetTabId: msg.targetTabId, consumerTabId: sender.tab?.id },
      streamId => sendResponse({ streamId, error: chrome.runtime.lastError?.message }),
    );
  } catch (e) {
    sendResponse({ error: e.message });
  }
  return true;                     // keep the channel open for the async reply
});

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== ALARM) return;
  // One read, passed down. Each of these used to fetch and deserialise the
  // whole settings object for itself — three copies per alarm, to read one
  // field each.
  const s = await settings();
  await Promise.allSettled([warmWeather(s), warmNews(s), refreshSpotify(s)]);
  await pruneCache();
});

/* ---------------- bounded response cache ----------------
   `cachedFetch` writes one `cache:` entry per key, and its TTL only decides
   when a value is considered stale — never when it is removed. A key that is
   never requested again is never deleted.

   That is fine for weather and news, which reuse a handful of fixed keys, and
   not fine for lyrics, which key per track: `lrc:<artist>|<title>|<duration>`.
   Measured on a real LRCLIB response, one entry carries ~1,100 characters of
   plainLyrics plus ~2,200 of syncedLyrics — about 3.5 KB. Twenty new tracks a
   day is roughly 25 MB a year, and it only ever grows.

   Pruned here rather than in the page. This worker already wakes on the alarm
   to do storage work, while enumerating every key is far too expensive to put
   anywhere near the new-tab path. Oldest first, so the entries the warm calls
   above just wrote are the last to go. */
const CACHE_MAX = 400;            // ~1.4 MB at the measured entry size

async function pruneCache() {
  try {
    // Cheap check first where it exists: getKeys avoids deserialising every
    // value just to find out there is nothing to do, which is the common case.
    if (typeof chrome.storage.local.getKeys === 'function') {
      const keys = await chrome.storage.local.getKeys();
      if (keys.filter(k => k.startsWith('cache:')).length <= CACHE_MAX) return;
    }
    const all = await chrome.storage.local.get(null);
    const entries = Object.keys(all)
      .filter(k => k.startsWith('cache:'))
      .map(k => [k, Number(all[k]?.at) || 0]);
    if (entries.length <= CACHE_MAX) return;
    entries.sort((a, b) => a[1] - b[1]);
    const kill = entries.slice(0, entries.length - CACHE_MAX).map(e => e[0]);
    if (kill.length) await chrome.storage.local.remove(kill);
  } catch { /* pruning is housekeeping; never let it break the refresh */ }
}

async function settings() {
  const { settings } = await chrome.storage.local.get('settings');
  return settings || {};
}

async function cache(key, data) {
  await chrome.storage.local.set({ ['cache:' + key]: { at: Date.now(), data } });
}

async function warmWeather(s) {
  if (!s.place) return;
  const unit = s.temperatureUnit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
  const url = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
    latitude: s.place.lat, longitude: s.place.lon,
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m',
    hourly: 'temperature_2m,weather_code,precipitation_probability',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max',
    timezone: 'auto', forecast_days: 6,
    temperature_unit: unit, wind_speed_unit: s.windUnit || 'kmh',
  });
  const res = await fetch(url);
  if (!res.ok) return;
  const key = `wx:${(+s.place.lat).toFixed(2)},${(+s.place.lon).toFixed(2)}:${unit}:${s.windUnit || 'kmh'}`;
  await cache(key, await res.json());
}

async function warmNews(s) {
  for (const f of (s.feeds || []).filter(f => f.on)) {
    try {
      const res = await fetch(f.url);
      if (res.ok) await cache('news:' + f.id, await res.text());
    } catch { /* a dead feed shouldn't stop the others */ }
  }
}

async function refreshSpotify(s) {
  const { spotify_tokens: t } = await chrome.storage.local.get('spotify_tokens');
  if (!t?.refresh_token || !s.spotifyClientId) return;
  if (Date.now() < t.expires_at - 5 * 60e3) return;

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: s.spotifyClientId.trim(),
      grant_type: 'refresh_token',
      refresh_token: t.refresh_token,
    }),
  });
  if (!res.ok) return;
  const d = await res.json();
  await chrome.storage.local.set({
    spotify_tokens: {
      access_token: d.access_token,
      refresh_token: d.refresh_token || t.refresh_token,
      expires_at: Date.now() + (d.expires_in - 60) * 1000,
    },
  });
}
