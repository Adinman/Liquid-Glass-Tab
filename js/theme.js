// Turns settings into pixels: CSS variables, wallpaper, grain, and the
// SVG displacement map that gives the glass its edge refraction.
import { $ } from './util.js';
import { setIconMode } from './icons.js';
import { getBlob, WALLPAPER_IMAGE_KEY, WALLPAPER_VIDEO_KEY } from './media.js';
import { WALLPAPERS, PHOTOS, CLIPS, BG_PREFIX,
         bundled, photoFile, clipFile, bgThumb, clipPoster } from './config.js';
import { S } from './state.js';

/* ---------- refraction map ----------
   `assets/refract-map.png`: an RGB image where red encodes horizontal sampling
   offset and green vertical (128 = no shift). Near a panel edge the sample
   bends outward, which is what makes the backdrop stretch and bloom like thick
   glass. The film grain tile lives beside it and is applied straight from
   base.css.

   Both used to be drawn into a canvas and turned into data URLs here, on every
   new tab: ~28 ms of blocking work per tab, a 100 KB string for the grain, and
   a separate decode per tab because a data URL is a new resource each time. As
   files they cost no JS at all and Chrome shares one decode across every open
   tab. The map is also 256² rather than 512² — feDisplacementMap shifts by
   scale*(ch/255 - 0.5), so at the default scale of 42 the extra quantisation
   is 0.33 px worst case. Regenerate with `python assets/make_assets.py`. */
const MAP_URL = 'assets/refract-map.png';

let refractSupported = true;

/* ---------- first paint ----------
   The stylesheet paints #wp-image's default gradient the moment the document
   has layout. Which wallpaper you actually chose lives in chrome.storage,
   which is asynchronous, so on every single new tab there is a window where
   the default gradient is on screen and your wallpaper is not — the flash.

   localStorage is synchronous and available on an extension page, so the last
   resolved wallpaper is mirrored there and repainted here at module-evaluation
   time, before loadSettings() has even been called. chrome.storage stays the
   only source of truth: this is a cache, applyWallpaper overwrites whatever it
   painted a few milliseconds later, and a stale or missing entry costs nothing
   but the flash it was there to avoid.

   Nothing is read out of the cache as CSS. Only ids and a scheme name come
   back, and each is resolved through the same registry lookup the live code
   uses, so a tampered entry can name something that does not exist and that is
   the whole of what it can do. A remote URL goes back through cssImageURL.

   This runs at import, which the performance invariants forbid for anything
   heavy. It is a localStorage read, a JSON.parse of ~60 bytes and one style
   write — microseconds, and it is on the critical path precisely because that
   is the path being fixed. */
const WP_CACHE = 'lgt:wp';

function paintCachedWallpaper() {
  let v;
  try { v = JSON.parse(localStorage.getItem(WP_CACHE) || 'null'); }
  catch { return; }
  if (!v || typeof v !== 'object') return;

  const node = document.getElementById('wp-image');
  if (!node) return;

  let bg = null;
  if (v.thumb) {
    // A clip was playing. Its own first frame stands in until the video
    // decodes, exactly as paintStill does once settings arrive.
    const clip = bundled(CLIPS, BG_PREFIX + v.thumb);
    if (clip) {
      bg = `url("${clipPoster(clip.id)}")`;
      // And start the video here too. It used to get its src inside
      // applyVideoWallpaper, which runs after `await loadSettings()`, so the
      // poster sat on screen for the storage read AND the fetch AND the first
      // frame decode. Same file every time, so there is nothing to wait to
      // find out. applyVideoWallpaper compares dataset.src and will leave this
      // alone rather than reloading it.
      const vid = document.getElementById('wp-video');
      if (vid && !vid.dataset.src) {
        vid.hidden = false;
        vid.muted = true;                 // or autoplay is refused
        vid.loop = true;
        vid.dataset.src = clipFile(clip.id);
        vid.src = clipFile(clip.id);
        vid.play?.().catch(() => { /* autoplay can still be refused */ });
      }
    }
  } else if (v.photo) {
    const photo = bundled(PHOTOS, BG_PREFIX + v.photo);
    if (photo) bg = `url("${photoFile(photo.id)}")`;
  } else if (v.url) {
    const safe = cssImageURL(v.url);
    if (safe) bg = `url("${safe}")`;
  } else if (v.preset) {
    const w = WALLPAPERS.find(x => x.id === v.preset);
    if (w) bg = w.css;
  }
  if (!bg) return;

  node.style.backgroundImage = bg;
  node.style.backgroundSize = 'cover';
  node.style.backgroundPosition = 'center';
  node.style.backgroundRepeat = 'no-repeat';
  if (Number.isFinite(v.dim)) {
    document.documentElement.style.setProperty('--wp-dim', v.dim.toFixed(2));
  }
  if (v.scheme === 'light' || v.scheme === 'dark') {
    document.documentElement.dataset.scheme = v.scheme;
  }
}

/** Record what was just painted, so the next new tab can paint it instantly. */
function rememberWallpaper() {
  const v = {
    dim: parseFloat(document.documentElement.style.getPropertyValue('--wp-dim')) || 0,
    scheme: document.documentElement.dataset.scheme,
  };
  const clip = bundled(CLIPS, S.wallpaperVideo || '');
  const photo = bundled(PHOTOS, S.wallpaperCustom || '');
  if (clip) v.thumb = clip.id;
  else if (photo) v.photo = photo.id;
  else if (S.wallpaperCustom && /^https?:/i.test(S.wallpaperCustom)) v.url = S.wallpaperCustom;
  // An uploaded image lives in IndexedDB and cannot be read synchronously, so
  // the preset underneath it is cached instead — a plain gradient for one frame
  // beats a wallpaper that is not yours.
  else v.preset = S.wallpaper;

  try { localStorage.setItem(WP_CACHE, JSON.stringify(v)); } catch { /* private mode, full disk */ }
}

paintCachedWallpaper();

export function initTheme() {
  $('#lg-map').setAttribute('href', MAP_URL);

  // Chrome supports url() filters in backdrop-filter; anything else falls back.
  refractSupported = CSS.supports('backdrop-filter', 'url(#lg-refract)') ||
                     CSS.supports('-webkit-backdrop-filter', 'url(#lg-refract)');

  initVideoWallpaper();
  applyTheme();
  trackSheen();
}

export function applyTheme() {
  const r = document.documentElement;
  const st = r.style;

  st.setProperty('--blur', S.blur + 'px');
  st.setProperty('--sat', S.saturation + '%');
  st.setProperty('--bri', S.brightness + '%');
  st.setProperty('--tint-a', (S.tintAlpha / 100).toFixed(3));
  st.setProperty('--edge-a', (S.edgeAlpha / 100).toFixed(3));
  st.setProperty('--radius', S.radius + 'px');
  st.setProperty('--accent', S.accent);
  st.setProperty('--dock-size', S.dockSize + 'px');
  st.setProperty('--dock-mag', S.dockMagnify);
  st.setProperty('--dock-gap', (S.dockGap ?? 6) + 'px');
  r.dataset.dockHover = S.dockHover || 'magnify';
  st.setProperty('--icon-sat', (S.dockVibrancy ?? 135) + '%');
  st.setProperty('--icon-con', (S.dockContrast ?? 108) + '%');
  setIconMode(S.iconSource);
  st.setProperty('--clock-size', S.clockSize + 'px');
  st.setProperty('--grain', (S.grain / 100).toFixed(3));
  st.setProperty('--vignette', (S.vignette / 100).toFixed(2));
  st.setProperty('--mesh-op', (S.mesh / 100).toFixed(2));
  st.fontSize = (16 * S.fontScale / 100).toFixed(2) + 'px';

  r.dataset.scheme = S.scheme;
  r.dataset.sheen = S.sheen ? 'on' : 'off';
  r.dataset.animate = S.animateBg ? 'on' : 'off';
  r.dataset.dockLabels = S.dockLabels ? 'on' : 'off';
  // Refraction 0 has to take the SVG filter out of the backdrop chain, not
  // just zero its displacement. Leaving `url(#lg-refract)` in `backdrop-filter`
  // still makes the compositor run the feImage + feDisplacementMap pass on
  // every panel every frame, for a result that is a no-op — so the setting
  // gave you the flat look without the GPU saving it advertises.
  const refractOn = refractSupported && S.refract > 0;
  r.dataset.refract = refractOn ? 'on' : 'off';
  $('#lg-disp').setAttribute('scale', refractOn ? S.refract : 0);

  applyWallpaper();
}

/* ---------- custom wallpaper image ----------
   `wallpaperCustom` is '' (use a preset), 'local' (a Blob in IndexedDB), or a
   remote http(s) URL. It used to hold the whole image as a base64 data URL,
   which put a multi-megabyte string in the settings object — re-serialised on
   every settings write, and held in memory by every open tab. */
let imageURL = null;         // object URL for the locally stored image
let imageWanted = false;     // whether 'local' is what we should be showing

function releaseLocalImage() {
  imageWanted = false;
  if (imageURL) { URL.revokeObjectURL(imageURL); imageURL = null; }
}

/** Drop the cached object URL so the next apply re-reads IndexedDB. Uploading
 *  a replacement leaves `wallpaperCustom` as 'local', so without this the
 *  cache below would decide it was already showing the right thing and the
 *  new image would never appear. */
export function invalidateLocalImage() {
  if (imageURL) { URL.revokeObjectURL(imageURL); imageURL = null; }
}

async function ensureLocalImage(node) {
  imageWanted = true;
  if (imageURL) return;                       // already resolved and showing
  const blob = await getBlob(WALLPAPER_IMAGE_KEY);
  // Settings can change while the read is in flight.
  if (!imageWanted) return;
  if (!blob) { node.style.backgroundImage = presetCSS(); return; }
  imageURL = URL.createObjectURL(blob);
  node.style.backgroundImage = `url("${imageURL}")`;
}

const presetCSS = () => (WALLPAPERS.find(w => w.id === S.wallpaper) || WALLPAPERS[0]).css;

/** A value safe to interpolate into `url("…")` in an inline style.
 *  The wallpaper URL can arrive from a pasted field or an imported settings
 *  file, and it lands in a style attribute — an unescaped quote or paren would
 *  close the url() and let the rest inject further declarations. Only http(s)
 *  and blob: get through, and quotes/backslashes are escaped even then. */
export function cssImageURL(raw) {
  try {
    const u = new URL(String(raw), location.href);
    if (!/^(https?|blob):$/.test(u.protocol)) return null;
    return u.toString().replace(/[\\"]/g, m => '\\' + m);
  } catch { return null; }
}

/** Paint the still layer.
 *
 *  While a clip is the wallpaper this is deliberately NOT the stored photo.
 *  `#wp-video` sits on top at opacity 0 and only fades in once it has decoded,
 *  so for that window — every single new tab — the still layer is the only
 *  thing on screen. Painting the photo there made every new tab flash an
 *  unrelated picture before the video arrived.
 *
 *  A packaged clip already ships its own first frame: the picker thumbnail.
 *  Using it makes the hand-off colour-matched and effectively invisible, for
 *  about 3 KB that is already in the package. A local or remote video has no
 *  such frame, and a neutral gradient is a better stand-in than a photograph.
 *
 *  The photo is only hidden, never forgotten — `wallpaperCustom` still holds
 *  it, so turning the clip off brings it straight back.
 *
 *  `ignoreVideo` is for the case where the video failed: the still layer has
 *  to go back to the real wallpaper rather than be left showing a 192x108
 *  thumbnail stretched across the screen.
 *
 *  Longhands, not the `background` shorthand: the shorthand interacts badly
 *  with the element's transition and leaves background-position at 0% 0%,
 *  which crops photos from the top-left instead of the centre. */
function paintStill(node, { ignoreVideo = false } = {}) {
  const custom = S.wallpaperCustom || '';
  const video = ignoreVideo ? '' : (S.wallpaperVideo || '');

  if (video) {
    releaseLocalImage();
    const clip = bundled(CLIPS, video);
    node.style.backgroundImage = clip ? `url("${clipPoster(clip.id)}")` : presetCSS();
  } else if (custom === 'local') {
    // Resolved asynchronously; whatever is on screen stays until the blob lands
    // rather than flashing the preset gradient in between.
    ensureLocalImage(node);
  } else {
    releaseLocalImage();
    // A packaged still. The path is built from our own table, not from the
    // stored string, so there is nothing here for cssImageURL to defend
    // against — an id that isn't in the table simply isn't one of ours and
    // falls through to the checks below.
    const packed = bundled(PHOTOS, custom);
    if (packed) {
      node.style.backgroundImage = `url("${photoFile(packed.id)}")`;
    } else {
      const safe = custom ? cssImageURL(custom) : null;
      node.style.backgroundImage = safe ? `url("${safe}")` : presetCSS();
    }
  }
  node.style.backgroundSize = 'cover';
  node.style.backgroundPosition = 'center';
  node.style.backgroundRepeat = 'no-repeat';
}

export function applyWallpaper() {
  const node = $('#wp-image');
  paintStill(node);

  document.documentElement.dataset.wp =
    S.wallpaperVideo ? 'video' : S.wallpaperCustom ? 'custom' : 'preset';
  // The dim belongs to whichever layer is actually on screen. This used to be
  // videoDim unconditionally, which put a 25% black sheet over a photo — every
  // pixel multiplied by 0.75 — from a slider that lives under Live wallpaper
  // and is documented as darkening video. A photo now shows as it is unless
  // you ask for otherwise.
  //
  // A gradient deliberately keeps the old behaviour. The presets were designed,
  // shipped and screenshotted with that dim on them, and quietly brightening
  // all ten of them is not a bug fix.
  const dim = S.wallpaperVideo ? (S.videoDim ?? 0)
    : S.wallpaperCustom ? (S.stillDim ?? 0)
    : (S.videoDim ?? 0);
  document.documentElement.style.setProperty('--wp-dim', (dim / 100).toFixed(2));

  // Light presets want dark text.
  const light = !S.wallpaperCustom && !S.wallpaperVideo && ['dawn', 'paper'].includes(S.wallpaper);
  if (light && S.scheme === 'dark') document.documentElement.dataset.scheme = 'light';

  applyVideoWallpaper();
  rememberWallpaper();
}

/* ---------- live video wallpaper ---------- */
let objectURL = null;

/** Drop the cached video object URL so the next apply re-reads IndexedDB.
 *  Same reasoning as invalidateLocalImage: choosing a replacement leaves
 *  `wallpaperVideo` as 'local', so nothing else would signal the change. */
export function invalidateLocalVideo() {
  if (objectURL) { URL.revokeObjectURL(objectURL); objectURL = null; }
}

export async function applyVideoWallpaper() {
  const v = $('#wp-video');
  if (!v) return;

  const want = S.wallpaperVideo || '';
  if (!want) {
    v.pause();
    v.classList.remove('ready');
    v.hidden = true;
    v.removeAttribute('src');
    delete v.dataset.src;
    v.load();
    invalidateLocalVideo();
    return;
  }

  v.hidden = false;
  v.muted = true;                       // required, or autoplay is refused
  v.loop = true;

  // 'local' means the file lives in IndexedDB; anything else is a URL.
  let src = want;
  if (want === 'local') {
    // Reuse the object URL we already have. Minting a fresh one each time
    // changes v.src, which reloads the video and restarts it from the first
    // frame — and this runs on every settings change, so nudging any slider
    // used to jump the live wallpaper back to the beginning.
    if (!objectURL) {
      const blob = await getBlob(WALLPAPER_VIDEO_KEY);
      if (!blob) { v.hidden = true; return; }
      objectURL = URL.createObjectURL(blob);
    }
    src = objectURL;
  } else {
    invalidateLocalVideo();
    // A packaged clip: a plain extension-relative path, so no object URL to
    // mint or revoke, and Chrome caches the one decode across tabs.
    const packed = bundled(CLIPS, want);
    if (packed) src = clipFile(packed.id);
  }

  if (v.dataset.src !== src) {
    v.dataset.src = src;
    v.classList.remove('ready');
    v.src = src;
  }
  // Must come after the src assignment: loading a new resource resets
  // playbackRate to defaultPlaybackRate, so setting it first is thrown away.
  setRate(v);
  v.play().catch(() => { /* autoplay can still be refused; poster stays visible */ });
}

function setRate(v) {
  const rate = Math.max(0.1, (S.videoSpeed ?? 100) / 100);
  v.defaultPlaybackRate = rate;
  v.playbackRate = rate;
}

/** Called once at startup. */
function initVideoWallpaper() {
  const v = $('#wp-video');
  if (!v) return;
  v.addEventListener('loadeddata', () => { v.classList.add('ready'); setRate(v); });
  // paintCachedWallpaper may have started the clip before this listener
  // existed. If it already has a frame, loadeddata has been and gone, and
  // without this the class is never added and the video stays invisible at
  // opacity 0 for good.
  if (v.readyState >= 2) { v.classList.add('ready'); setRate(v); }
  v.addEventListener('error', () => {
    v.classList.remove('ready');
    v.hidden = true;
    // The still layer is currently standing in for the video's first frame.
    // With the video dead it has to go back to the actual wallpaper, or a
    // failed clip leaves a 192x108 thumbnail stretched over the whole screen.
    paintStill($('#wp-image'), { ignoreVideo: true });
  });

  // Decoding video in a tab you're not looking at wastes battery for nothing.
  document.addEventListener('visibilitychange', () => {
    if (!S.wallpaperVideo) return;
    if (document.hidden) { if (S.videoPauseHidden !== false) v.pause(); }
    else v.play().catch(() => {});
  });
}

/* ---------- pointer-tracked specular sheen ---------- */
function trackSheen() {
  document.addEventListener('pointermove', e => {
    const panel = e.target.closest?.('.glass');
    if (!panel) return;
    let sheen = panel.querySelector(':scope > .sheen');
    if (!sheen) {
      sheen = document.createElement('div');
      sheen.className = 'sheen';
      panel.prepend(sheen);
    }
    const r = panel.getBoundingClientRect();
    sheen.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
    sheen.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
  }, { passive: true });
}

/** Every .glass panel gets a sheen layer once it exists. */
export function attachSheen(panel) {
  if (panel.querySelector(':scope > .sheen')) return;
  const s = document.createElement('div');
  s.className = 'sheen';
  panel.prepend(s);
}

