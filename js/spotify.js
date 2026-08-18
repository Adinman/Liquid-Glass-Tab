// Spotify Web API client.
//
// Auth is Authorization Code + PKCE via chrome.identity.launchWebAuthFlow, so
// no client secret is ever stored. Playback is controlled on whatever device
// the user already has open (desktop app, phone, web player) — the Web
// Playback SDK can't be used here because MV3 forbids loading remote scripts.

import { store } from './util.js';
import { S } from './state.js';

const AUTH = 'https://accounts.spotify.com/authorize';
const TOKEN = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
const TOKEN_KEY = 'spotify_tokens';

const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-library-read',
  'user-library-modify',
  'user-read-recently-played',
].join(' ');

export const redirectURI = () => chrome.identity.getRedirectURL('spotify');

/* ---------------- PKCE helpers ---------------- */

/** The alphabet is 66 characters, which does not divide 256, so mapping a
 *  random byte with `% 66` would make the first 58 characters ~33% likelier
 *  than the last 8. Rejecting the bytes above the last whole multiple keeps
 *  the distribution flat, which is the whole point of a PKCE verifier. */
function randomString(len = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const limit = Math.floor(256 / chars.length) * chars.length;   // 198
  let out = '';
  while (out.length < len) {
    // getRandomValues refuses more than 65536 bytes in one call.
    const want = Math.min(65536, len - out.length + 8);
    const bytes = crypto.getRandomValues(new Uint8Array(want));
    for (const b of bytes) {
      if (b >= limit) continue;                  // reject, to keep it unbiased
      out += chars[b % chars.length];
      if (out.length === len) break;
    }
  }
  return out;
}

async function challenge(verifier) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ---------------- token lifecycle ---------------- */
async function tokens() { return store.get(TOKEN_KEY, null); }

export async function isConnected() { return !!(await tokens())?.refresh_token; }

export async function connect() {
  const clientId = S.spotifyClientId?.trim();
  if (!clientId) throw new Error('Add your Spotify Client ID in Settings → Music first.');

  const verifier = randomString(64);
  const url = new URL(AUTH);
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectURI(),
    code_challenge_method: 'S256',
    code_challenge: await challenge(verifier),
    scope: SCOPES,
    show_dialog: 'false',
  }).toString();

  const redirect = await chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive: true });
  if (!redirect) throw new Error('Authorization was cancelled.');

  const returned = new URL(redirect);
  const err = returned.searchParams.get('error');
  if (err) throw new Error(`Spotify returned "${err}".`);
  const code = returned.searchParams.get('code');
  if (!code) throw new Error('No authorization code came back.');

  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectURI(),
      code_verifier: verifier,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || 'Token exchange failed.');

  await save(data);
  return true;
}

async function save(data) {
  const prev = await tokens();
  await store.set(TOKEN_KEY, {
    access_token: data.access_token,
    refresh_token: data.refresh_token || prev?.refresh_token,
    expires_at: Date.now() + (data.expires_in - 60) * 1000,
  });
}

export async function disconnect() { await store.remove(TOKEN_KEY); }

// Spotify rotates the refresh token on use, so two refreshes racing means the
// second presents a token the first already spent — Spotify rejects it and the
// old code responded by calling disconnect(), silently logging the user out.
// The widgets poll independently, so this was reachable whenever a token
// expired with more than one consumer active.
let refreshing = null;

async function accessToken() {
  const t = await tokens();
  if (!t) return null;
  if (Date.now() < t.expires_at) return t.access_token;
  if (refreshing) return refreshing;

  refreshing = (async () => {
    try {
      const res = await fetch(TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: (S.spotifyClientId || '').trim(),
          grant_type: 'refresh_token',
          refresh_token: t.refresh_token,
        }),
      });
      if (!res.ok) {
        // Only a definitive rejection of the grant should clear the tokens; a
        // 5xx or a flaky network is a reason to try again later, not to make
        // the user re-authorise.
        if (res.status === 400 || res.status === 401) await disconnect();
        return null;
      }
      const data = await res.json();
      await save(data);
      return data.access_token;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/* ---------------- request helper ---------------- */
async function api(path, { method = 'GET', body, query } = {}) {
  const token = await accessToken();
  if (!token) throw new Error('NOT_CONNECTED');

  let url = API + path;
  if (query) url += '?' + new URLSearchParams(query);

  const res = await fetch(url, {
    method,
    headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;                       // nothing playing / command accepted
  if (res.status === 404) throw new Error('NO_DEVICE');      // no active device
  if (res.status === 403) throw new Error('FORBIDDEN');      // usually: not Premium
  if (res.status === 429) throw new Error('RATE_LIMIT');
  if (!res.ok) throw new Error('HTTP ' + res.status);

  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Spotify occasionally answers 200 with a body that isn't JSON — a
    // gateway page, or a truncated response. Tagged rather than allowed to
    // escape as a raw SyntaxError, so callers can recognise it as transient
    // and stay quiet; the next poll a few seconds later returns real data.
    throw new Error('BAD_RESPONSE');
  }
}

/* ---------------- public surface ---------------- */
export const player = {
  state:   () => api('/me/player', { query: { additional_types: 'track,episode' } }),
  devices: () => api('/me/player/devices'),
  play:    () => api('/me/player/play', { method: 'PUT' }),
  pause:   () => api('/me/player/pause', { method: 'PUT' }),
  next:    () => api('/me/player/next', { method: 'POST' }),
  prev:    () => api('/me/player/previous', { method: 'POST' }),
  seek:    ms => api('/me/player/seek', { method: 'PUT', query: { position_ms: Math.round(ms) } }),
  volume:  v => api('/me/player/volume', { method: 'PUT', query: { volume_percent: Math.round(v) } }),
  shuffle: on => api('/me/player/shuffle', { method: 'PUT', query: { state: !!on } }),
  repeat:  mode => api('/me/player/repeat', { method: 'PUT', query: { state: mode } }),
  transfer: id => api('/me/player', { method: 'PUT', body: { device_ids: [id], play: true } }),
  isSaved: id => api('/me/tracks/contains', { query: { ids: id } }).then(r => !!r?.[0]),
  save:    id => api('/me/tracks', { method: 'PUT', query: { ids: id } }),
  unsave:  id => api('/me/tracks', { method: 'DELETE', query: { ids: id } }),
};

/* ---------------- polling with local interpolation ----------------
   Spotify is polled every few seconds; between polls the progress bar is
   advanced locally so it moves at 60fps without hammering the API. */
class Playback extends EventTarget {
  constructor() {
    super();
    this.raw = null;          // last API payload
    this.at = 0;              // when we received it
    this.timer = null;
    this.interval = 4000;
  }

  get track() { return this.raw?.item || null; }
  get playing() { return !!this.raw?.is_playing; }
  get duration() { return this.raw?.item?.duration_ms || 0; }

  /** Progress right now, interpolated from the last poll. */
  get progress() {
    if (!this.raw) return 0;
    const base = this.raw.progress_ms || 0;
    if (!this.raw.is_playing) return base;
    return Math.min(this.duration, base + (Date.now() - this.at));
  }

  async poll() {
    try {
      const st = await player.state();
      const changed = st?.item?.id !== this.raw?.item?.id;
      this.raw = st;
      this.at = Date.now();
      this.dispatchEvent(new CustomEvent('state', { detail: { state: st, trackChanged: changed } }));
      if (changed && st?.item) this.dispatchEvent(new CustomEvent('track', { detail: st.item }));
    } catch (e) {
      this.dispatchEvent(new CustomEvent('error', { detail: e }));
    }
  }

  /** Optimistic local update so the UI reacts before the next poll lands. */
  patch(patch) {
    if (!this.raw) return;
    if ('progress_ms' in patch) this.at = Date.now();
    Object.assign(this.raw, patch);
    this.dispatchEvent(new CustomEvent('state', { detail: { state: this.raw, trackChanged: false } }));
  }

  start(ms = this.interval) {
    this.stop();
    this.poll();
    this.timer = setInterval(() => { if (!document.hidden) this.poll(); }, ms);
  }
  stop() { clearInterval(this.timer); this.timer = null; }
}

export const playback = new Playback();
