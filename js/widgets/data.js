// Network-backed widgets: weather (Open-Meteo), news (RSS), crypto (CoinGecko).
import { el, cachedFetch, relTime, toast, escapeHtml, hostOf } from '../util.js';
import { S, set } from '../state.js';
import { head } from './core.js';
import { t } from '../i18n.js';

/* ---------- WMO weather codes ---------- */
const WMO = {
  0:  ['Clear sky', '☀️', '🌙'],      1:  ['Mainly clear', '🌤️', '🌙'],
  2:  ['Partly cloudy', '⛅', '☁️'],  3:  ['Overcast', '☁️', '☁️'],
  45: ['Fog', '🌫️', '🌫️'],           48: ['Rime fog', '🌫️', '🌫️'],
  51: ['Light drizzle', '🌦️', '🌧️'], 53: ['Drizzle', '🌦️', '🌧️'],
  55: ['Heavy drizzle', '🌧️', '🌧️'], 56: ['Freezing drizzle', '🌧️', '🌧️'],
  57: ['Freezing drizzle', '🌧️', '🌧️'],
  61: ['Light rain', '🌦️', '🌧️'],    63: ['Rain', '🌧️', '🌧️'],
  65: ['Heavy rain', '🌧️', '🌧️'],    66: ['Freezing rain', '🌧️', '🌧️'],
  67: ['Freezing rain', '🌧️', '🌧️'],
  71: ['Light snow', '🌨️', '🌨️'],    73: ['Snow', '🌨️', '🌨️'],
  75: ['Heavy snow', '❄️', '❄️'],     77: ['Snow grains', '🌨️', '🌨️'],
  80: ['Showers', '🌦️', '🌧️'],       81: ['Showers', '🌧️', '🌧️'],
  82: ['Violent showers', '⛈️', '⛈️'],85: ['Snow showers', '🌨️', '🌨️'],
  86: ['Snow showers', '🌨️', '🌨️'],  95: ['Thunderstorm', '⛈️', '⛈️'],
  96: ['Thunderstorm, hail', '⛈️', '⛈️'], 99: ['Thunderstorm, hail', '⛈️', '⛈️'],
};
const wmo = (code, day = true) => {
  const e = WMO[code] || ['—', '🌡️', '🌡️'];
  // Translated here rather than in the table above: that table is module-level
  // and evaluates before any catalogue is loaded, so translating it in place
  // would freeze whichever language happened to be active at import time.
  return { desc: t(e[0]), icon: day ? e[1] : e[2] };
};

/** Best-effort city guess from IP. Only called when no place is set. */
export async function detectPlace() {
  for (const url of ['https://ipapi.co/json/', 'https://ipwho.is/']) {
    try {
      const r = await fetch(url);
      const j = await r.json();
      const lat = j.latitude, lon = j.longitude;
      if (typeof lat === 'number' && typeof lon === 'number') {
        return { name: j.city || 'Your area', country: j.country_name || j.country || '', lat, lon };
      }
    } catch { /* try the next provider */ }
  }
  return null;
}

export async function searchPlaces(q) {
  const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name='
    + encodeURIComponent(q));
  const j = await r.json();
  return (j.results || []).map(p => ({
    name: p.name, country: [p.admin1, p.country].filter(Boolean).join(', '),
    lat: p.latitude, lon: p.longitude,
  }));
}

/* ============================ WEATHER ============================ */
/** How much of the location to put on screen, in decreasing specificity. Hides
 *  it from anyone looking at the screen; it does not change what is sent to the
 *  weather API, which needs coordinates either way. */
export function placeLabel(place) {
  if (!place) return '';
  const full = `${place.name}${place.country ? ', ' + place.country : ''}`;
  switch (S.weatherPrivacy) {
    case 'hidden': return '';
    // `country` is stored as "Colorado, United States" from the geocoder, so
    // the last segment is the country on its own — the city is what pinpoints
    // you, and it is exactly what this drops.
    case 'country': return (place.country || '').split(',').pop().trim();
    default: return full;
  }
}

export const weather = {
  id: 'weather', title: 'Weather', className: 'w-weather',
  render(panel) {
    const body = el('div');
    const refresh = el('button', { class: 'icon-btn', text: '⟳', title: t('Refresh'),
      onclick: () => load(true) });
    panel.append(head('Weather', refresh), body);
    let timer;

    async function load(force = false) {
      body.innerHTML = '<div class="muted" style="font-size:13px">Loading…</div>';

      let place = S.place;
      if (!place) {
        place = await detectPlace();
        if (place) await set({ place }, { silent: true });
      }
      if (!place) {
        body.innerHTML = '<div class="muted" style="font-size:13px;line-height:1.5">'
          + 'Couldn’t detect your location.<br>Set a city in Settings → Weather.</div>';
        return;
      }

      const unit = S.temperatureUnit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
      const deg = unit === 'fahrenheit' ? '°F' : '°C';
      const url = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
        latitude: place.lat, longitude: place.lon,
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m',
        hourly: 'temperature_2m,weather_code,precipitation_probability',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max',
        timezone: 'auto', forecast_days: 6,
        temperature_unit: unit, wind_speed_unit: S.windUnit,
      });

      const key = `wx:${(+place.lat).toFixed(2)},${(+place.lon).toFixed(2)}:${unit}:${S.windUnit}`;
      const { data, stale, error } = await cachedFetch(key, url, { ttl: force ? 0 : 15 * 60e3 });
      if (!data) {
        body.innerHTML = `<div class="muted" style="font-size:13px">Weather unavailable (${escapeHtml(error?.message || 'offline')})</div>`;
        return;
      }

      const c = data.current, day = c.is_day === 1;
      const now = wmo(c.weather_code, day);
      body.innerHTML = '';

      body.append(
        el('div', { class: 'wx-now' },
          el('div', { class: 'wx-icon', text: now.icon }),
          el('div', {},
            el('div', { class: 'wx-temp tabular', text: Math.round(c.temperature_2m) + '°' }),
            el('div', { class: 'wx-desc', text: now.desc }),
            (label => label ? el('div', { class: 'wx-place', text: label }) : '')(placeLabel(place)))),
        el('div', { class: 'wx-stats' },
          el('span', { text: `Feels ${Math.round(c.apparent_temperature)}${deg}` }),
          el('span', { text: `💧 ${c.relative_humidity_2m}%` }),
          el('span', { text: `🌬 ${Math.round(c.wind_speed_10m)} ${S.windUnit === 'mph' ? 'mph' : 'km/h'}` }),
          el('span', { text: `UV ${Math.round(data.daily.uv_index_max?.[0] ?? 0)}` })),
      );

      // next 8 hours, starting from the current hour
      const hours = el('div', { class: 'wx-hours' });
      const nowIso = new Date().getHours();
      const startIdx = data.hourly.time.findIndex(iso => new Date(iso).getHours() === nowIso
        && new Date(iso).getDate() === new Date().getDate());
      const from = startIdx < 0 ? 0 : startIdx;
      for (let i = from; i < from + 8 && i < data.hourly.time.length; i++) {
        const d = new Date(data.hourly.time[i]);
        const isDay = d.getHours() > 6 && d.getHours() < 20;
        hours.append(el('div', { class: 'h' },
          el('div', { text: i === from ? 'Now' : (S.clock24 ? d.getHours() + 'h' : ((d.getHours() % 12) || 12) + (d.getHours() < 12 ? 'a' : 'p')) }),
          el('div', { text: wmo(data.hourly.weather_code[i], isDay).icon, style: { fontSize: '15px' } }),
          el('b', { class: 'tabular', text: Math.round(data.hourly.temperature_2m[i]) + '°' })));
      }
      body.append(hours);

      // 5-day range bars, scaled across the whole week
      const dd = data.daily;
      const lo = Math.min(...dd.temperature_2m_min), hi = Math.max(...dd.temperature_2m_max);
      const span = Math.max(1, hi - lo);
      const days = el('div', { class: 'wx-days' });
      for (let i = 0; i < Math.min(5, dd.time.length); i++) {
        const d = new Date(dd.time[i]);
        const l = dd.temperature_2m_min[i], h = dd.temperature_2m_max[i];
        const bar = el('div', { class: 'bar' }, el('i', { style: {
          left: ((l - lo) / span * 100).toFixed(1) + '%',
          width: Math.max(6, (h - l) / span * 100).toFixed(1) + '%' } }));
        days.append(el('div', { class: 'd' },
          el('span', { class: 'n', text: i === 0 ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' }) }),
          el('span', { text: wmo(dd.weather_code[i]).icon }),
          el('span', { class: 'tabular faint', text: Math.round(l) + '°' }),
          bar,
          el('span', { class: 'tabular', text: Math.round(h) + '°' })));
      }
      body.append(days);

      if (stale) body.append(el('div', { class: 'faint', style: { fontSize: '11px', marginTop: '8px' },
        text: t('Showing cached data — refresh failed.') }));
    }

    load();
    timer = setInterval(load, 15 * 60e3);
    panel._reload = load;
    return () => clearInterval(timer);
  },
};

/* ============================ NEWS ============================ */

/** Feeds are user-supplied, and their links end up as href on a page running
 *  at the extension's own origin. Anything but http(s) — javascript:, data: —
 *  is dropped rather than rendered. */
const isSafeLink = url => {
  try { return /^https?:$/.test(new URL(url, location.href).protocol); }
  catch { return false; }
};

function parseFeed(xmlText, sourceName) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) return [];
  const nodes = [...doc.querySelectorAll('item'), ...doc.querySelectorAll('entry')];
  return nodes.map(n => {
    const get = sel => n.querySelector(sel)?.textContent?.trim() || '';
    const link = n.querySelector('link')?.getAttribute?.('href') || get('link') || get('guid');
    const dateStr = get('pubDate') || get('updated') || get('published') || get('date');
    const ts = dateStr ? Date.parse(dateStr) : NaN;
    return { title: get('title'), url: link, source: sourceName, ts: isNaN(ts) ? Date.now() : ts };
  }).filter(a => a.title && a.url && isSafeLink(a.url));
}

export const news = {
  id: 'news', title: 'News', className: 'w-news',
  render(panel) {
    const tabs = el('div', { class: 'src-tabs' });
    const list = el('div', { class: 'news-list scroll' });
    const refresh = el('button', { class: 'icon-btn', text: '⟳', title: t('Refresh'), onclick: () => load(true) });
    panel.append(head('News', refresh), tabs, list);

    let all = [], filter = 'all', timer;

    async function load(force = false) {
      const feeds = (S.feeds || []).filter(f => f.on);
      if (!feeds.length) { list.innerHTML = '<div class="muted" style="font-size:13px">No feeds enabled.</div>'; return; }
      list.innerHTML = '<div class="muted" style="font-size:13px">Loading…</div>';

      const results = await Promise.all(feeds.map(async f => {
        const { data } = await cachedFetch('news:' + f.id, f.url,
          { ttl: force ? 0 : 10 * 60e3, parse: 'text' });
        return data ? parseFeed(data, f.name) : [];
      }));

      all = results.flat().sort((a, b) => b.ts - a.ts);
      drawTabs(feeds);
      draw();
    }

    function drawTabs(feeds) {
      tabs.innerHTML = '';
      const mk = (id, name) => el('button', {
        class: 'pill' + (filter === id ? ' on' : ''), text: name,
        onclick: () => { filter = id; drawTabs(feeds); draw(); },
      });
      tabs.append(mk('all', 'All'), ...feeds.map(f => mk(f.name, f.name)));
    }

    function draw() {
      const items = (filter === 'all' ? all : all.filter(a => a.source === filter)).slice(0, S.newsCount);
      list.innerHTML = '';
      if (!items.length) { list.innerHTML = '<div class="muted" style="font-size:13px">Nothing to show.</div>'; return; }
      for (const a of items) {
        list.append(el('a', { class: 'news-item', href: a.url, title: a.title },
          el('div', { class: 't', text: a.title }),
          el('div', { class: 'm', text: `${a.source} · ${relTime(a.ts)}` })));
      }
    }

    load();
    timer = setInterval(load, 10 * 60e3);
    panel._reload = load;
    return () => clearInterval(timer);
  },
};

/* ============================ CRYPTO ============================ */
export const crypto_ = {
  id: 'crypto', title: 'Crypto', className: 'w-crypto',
  render(panel) {
    const list = el('div');
    panel.append(head('Markets', el('button', { class: 'icon-btn', text: '⟳', onclick: () => load(true) })), list);
    let timer;

    async function load(force = false) {
      const ids = (S.coins || 'bitcoin').split(',').map(s => s.trim()).filter(Boolean).join(',');
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd&include_24hr_change=true`;
      const { data } = await cachedFetch('crypto:' + ids, url, { ttl: force ? 0 : 5 * 60e3 });
      list.innerHTML = '';
      if (!data) { list.innerHTML = '<div class="muted" style="font-size:13px">Prices unavailable.</div>'; return; }
      for (const [id, v] of Object.entries(data)) {
        const ch = v.usd_24h_change ?? 0;
        list.append(el('div', { class: 'cr-row' },
          el('span', { text: id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }),
          el('span', { class: 'row' },
            el('span', { class: 'tabular', text: '$' + v.usd.toLocaleString(undefined, { maximumFractionDigits: v.usd < 5 ? 4 : 2 }) }),
            el('span', { class: 'tabular ' + (ch >= 0 ? 'up' : 'dn'), style: { fontSize: '11.5px', width: '56px', textAlign: 'right' },
              text: (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%' }))));
      }
    }

    load();
    // Weather and news both publish this; without it the crypto panel is the
    // one thing "clear cache" and the reload event leave showing stale prices.
    panel._reload = load;
    timer = setInterval(load, 5 * 60e3);
    return () => clearInterval(timer);
  },
};
