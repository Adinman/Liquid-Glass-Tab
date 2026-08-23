/* Runs before the first paint. Deliberately not a module.
 *
 * `js/app.js` is `type="module"`, which is deferred: the browser parses the
 * HTML, applies the stylesheet and is free to paint before a single line of it
 * runs. So `#wp-image` painted its stylesheet default first — a blue/purple
 * gradient — and the real wallpaper only arrived once modules had loaded and
 * chrome.storage had answered. That is the flash, and no amount of doing it
 * earlier *inside* the module could fix it, because the paint had already
 * happened.
 *
 * A classic script with a src and no defer/async blocks parsing and executes
 * before the body exists, so this lands ahead of the first paint. It is a few
 * hundred bytes and same-origin, and it must stay that way: anything slow here
 * delays the paint it is trying to fix.
 *
 * It cannot import the registries in config.js — modules are the thing being
 * avoided — so it does not resolve ids. `rememberWallpaper` in js/theme.js
 * writes the already-resolved filename, and everything read back is validated
 * against a tight pattern before it reaches CSS, because a value out of storage
 * that lands in a `url()` is exactly where an injection would go.
 */
(function () {
  'use strict';
  try {
    var raw = localStorage.getItem('lgt:wp');
    if (!raw) return;
    var v = JSON.parse(raw);
    if (!v || typeof v !== 'object') return;

    var root = document.documentElement;
    var css = null;

    if (typeof v.file === 'string' && /^[A-Za-z0-9._-]+$/.test(v.file)) {
      // A packaged still or a clip's poster, by filename.
      css = 'url("assets/bg/' + v.file + '")';
    } else if (v.localVideo) {
      // An uploaded video's own first frame, kept separately because it is a
      // ~50 KB data URL and has no business in the small cache.
      try {
        var p = JSON.parse(localStorage.getItem('lgt:wp:poster') || 'null');
        if (p && p.name === v.localVideo && typeof p.url === 'string'
            && /^data:image\/webp;base64,[A-Za-z0-9+/=]+$/.test(p.url)) {
          css = 'url("' + p.url + '")';
        }
      } catch (e) { /* fall through to the stylesheet default */ }
    } else if (typeof v.grad === 'string'
               && /^linear-gradient\([#%\w\s,.()-]+\)$/.test(v.grad)) {
      css = v.grad;
    }

    if (css) root.style.setProperty('--wp-first', css);

    // The colour blobs are hidden by :root[data-wp="custom"|"video"], and that
    // attribute was also only set after settings loaded — so they washed over
    // the whole screen until then.
    if (v.wp === 'video' || v.wp === 'custom' || v.wp === 'preset') {
      root.dataset.wp = v.wp;
    }
    if (typeof v.mesh === 'number' && v.mesh >= 0 && v.mesh <= 1) {
      root.style.setProperty('--mesh-op', v.mesh);
    }
    if (typeof v.dim === 'number' && v.dim >= 0 && v.dim <= 1) {
      root.style.setProperty('--wp-dim', v.dim);
    }
    if (v.scheme === 'light' || v.scheme === 'dark') {
      root.dataset.scheme = v.scheme;
    }
    // See rememberWallpaper: without this the wallpaper paints unlit and then
    // brightens once the modules have loaded.
    if (v.lights === 1) {
      root.dataset.lights = 'on';
      if (typeof v.lift === 'number' && v.lift >= 1 && v.lift <= 2) {
        root.style.setProperty('--wp-lift', v.lift.toFixed(3));
      }
    }
  } catch (e) {
    /* Never let this break the page. Worst case is the flash it was added to
       remove, which is what happened before it existed. */
  }
})();
