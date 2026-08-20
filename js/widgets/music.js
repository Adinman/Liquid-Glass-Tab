// Spotify player, audio visualiser, and time-synced lyrics.
import { el, msToClock, toast, clamp, escapeHtml, cachedFetch } from '../util.js';
import { S, set } from '../state.js';
import { head } from './core.js';
import * as sp from '../spotify.js';
import { audio, BANDS, BASS_BANDS, VOICE_BAND_LO, VOICE_BAND_HI } from '../audio.js';

/* ============================ SPOTIFY PLAYER ============================ */
export const spotify = {
  id: 'spotify', title: 'Spotify', className: 'w-spotify',
  render(panel) {
    const body = el('div');
    panel.append(head('Now playing'), body);

    let liked = false, seeking = false;

    function renderDisconnected(msg) {
      body.innerHTML = '';
      body.append(el('div', { class: 'sp-connect' },
        el('p', { html: msg || 'Connect Spotify to see what’s playing, control playback, and pull synced lyrics.' }),
        el('button', {
          class: 'btn primary', text: 'Connect Spotify',
          onclick: async e => {
            e.target.textContent = 'Connecting…';
            try { await sp.connect(); toast('Spotify connected'); start(); }
            catch (err) { toast(err.message); renderDisconnected(escapeHtml(err.message)); }
          },
        })));
    }

    const ui = {};
    function buildPlayer() {
      body.innerHTML = '';
      ui.art = el('img', { class: 'sp-art', alt: '' });
      ui.title = el('div', { class: 'sp-title', text: '—' });
      ui.artist = el('div', { class: 'sp-artist', text: '' });
      ui.device = el('div', { class: 'sp-device', text: '' });
      ui.cur = el('span', { class: 'tabular', text: '0:00' });
      ui.dur = el('span', { class: 'tabular', text: '0:00' });
      ui.fill = el('i');
      ui.bar = el('div', { class: 'sp-bar' }, ui.fill);

      ui.shuffle = ctrl(icon(SHUFFLE), 'Shuffle', async () => {
        const on = !sp.playback.raw?.shuffle_state;
        await guard(() => sp.player.shuffle(on));
        sp.playback.patch({ shuffle_state: on });
      });
      ui.prev = ctrl(icon(PREV, { filled: true }), 'Previous', () => guard(() => sp.player.prev(), true));
      ui.play = ctrl(icon(PLAY, { size: SIZE.play, filled: true }), 'Play/pause', togglePlay, 'play');
      ui.next = ctrl(icon(NEXT, { filled: true }), 'Next', () => guard(() => sp.player.next(), true));
      ui.repeat = ctrl(icon(REPEAT), 'Repeat', async () => {
        const order = ['off', 'context', 'track'];
        const cur = sp.playback.raw?.repeat_state || 'off';
        const next = order[(order.indexOf(cur) + 1) % 3];
        await guard(() => sp.player.repeat(next));
        sp.playback.patch({ repeat_state: next });
      });
      ui.like = ctrl(icon(HEART, { size: SIZE.heart, shift: HEART_SHIFT }),
                     'Save to library', toggleLike);

      ui.vol = el('input', { type: 'range', min: 0, max: 100, value: 70 });
      ui.vol.addEventListener('change', () => guard(() => sp.player.volume(+ui.vol.value)));

      ui.bar.addEventListener('pointerdown', e => {
        seeking = true;
        const scrub = ev => {
          const r = ui.bar.getBoundingClientRect();
          const pct = clamp((ev.clientX - r.left) / r.width, 0, 1);
          ui.fill.style.width = pct * 100 + '%';
          ui.cur.textContent = msToClock(pct * sp.playback.duration);
          return pct;
        };
        const move = ev => scrub(ev);
        const up = async ev => {
          const pct = scrub(ev);
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          seeking = false;
          const ms = pct * sp.playback.duration;
          await guard(() => sp.player.seek(ms));
          sp.playback.patch({ progress_ms: ms });
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        move(e);
      });

      body.append(
        el('div', { class: 'sp-head' }, ui.art,
          el('div', { class: 'sp-meta' }, ui.title, ui.artist, ui.device)),
        el('div', { class: 'sp-seek' }, ui.cur, ui.bar, ui.dur),
        el('div', { class: 'sp-ctrls' }, ui.shuffle, ui.prev, ui.play, ui.next, ui.repeat, ui.like),
        el('div', { class: 'sp-vol' }, el('span', { text: '🔈', style: { fontSize: '12px', opacity: .6 } }), ui.vol),
      );
      lastFill = lastCur = '';        // fresh nodes, so nothing is written yet
    }

    /* Every control is inline SVG. Two reasons, both measured.

       They began as emoji — 🔀/🔁 are colour-emoji codepoints, so they painted
       their own background, ignored `color`, and their accent `.on` state was
       invisible. Unicode arrows (⇄/↻) fixed the colour but not the position:
       no installed UI font carries them, so they came from a fallback whose
       line box measures 20.18px against the media glyphs' 19.40px, leaving
       them sitting visibly higher than the row.

       Even matching glyphs don't line up with each other — rasterised, ⏮/⏭
       land 1.5px below the button's midline, ▶ 0.5px, ♡ 0.0px, because each
       block puts its ink somewhere different relative to the baseline. An SVG
       is centred as a grid item by its own geometry, so a row of them is level
       by construction, with no per-glyph nudging. It inherits `currentColor`
       too, so rest and accent states both work. */
    const SVG_NS = 'http://www.w3.org/2000/svg';

    // Stroked: shuffle, repeat, and the unsaved heart.
    const SHUFFLE = ['M16 3h5v5', 'M4 20 21 3', 'M21 16v5h-5', 'm15 15 6 6', 'm4 4 5 5'];
    const REPEAT  = ['m17 2 4 4-4 4', 'M3 11v-1a4 4 0 0 1 4-4h14',
                     'm7 22-4-4 4-4', 'M21 13v1a4 4 0 0 1-4 4H3'];
    const REPEAT_ONE = [...REPEAT, 'M11 10h1v4'];
    const HEART = ['M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2'
                 + '-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z'];

    // Filled: the transport controls, which read as solid in every player.
    const PREV  = ['M19 4.5v15L8.5 12z', 'M5 4.5h2.6v15H5z'];
    const NEXT  = ['M5 4.5v15L15.5 12z', 'M16.4 4.5H19v15h-2.6z'];
    const PLAY  = ['M8 5.2v13.6L19 12z'];
    const PAUSE = ['M7.4 5h3.4v14H7.4z', 'M13.2 5h3.4v14h-3.4z'];

    // Sizes are matched by ink area rather than box, which is what the eye
    // actually reads: a heart is wide and short, so at a matched box it looks
    // smaller than the arrows. At 16 its ink measures 82px² against shuffle's
    // 81 and repeat's 84 — and 74% more than the ♡ glyph it replaces, which
    // was the one that looked undersized.
    const SIZE = { default: 15, play: 20, heart: 16 };
    // 1.7 viewBox units = 1.13px at size 16, the heart's measured mass-vs-box
    // offset, so its centre of mass lands on the button's midline.
    const HEART_SHIFT = 1.7;

    /** `shift` moves the artwork down inside the viewBox, in viewBox units so
     *  the correction scales with `size` instead of being a fixed pixel fudge.
     *  Only the heart needs it: every other icon here is vertically symmetric,
     *  so its centre of mass and its bounding box coincide and box-centring is
     *  already optically right. A heart is heavy at the lobes and tapers to a
     *  thin point, putting its mass 1.13px above its box centre at size 16 —
     *  centred by the box it reads as sitting high, which is what it did. */
    function icon(paths, { size = SIZE.default, filled = false, shift = 0 } = {}) {
      const s = document.createElementNS(SVG_NS, 'svg');
      s.setAttribute('viewBox', '0 0 24 24');
      s.setAttribute('width', String(size));
      s.setAttribute('height', String(size));
      s.setAttribute('aria-hidden', 'true');
      if (filled) {
        s.setAttribute('fill', 'currentColor');
        s.setAttribute('stroke', 'none');
      } else {
        s.setAttribute('fill', 'none');
        s.setAttribute('stroke', 'currentColor');
        s.setAttribute('stroke-width', '2');
        s.setAttribute('stroke-linecap', 'round');
        s.setAttribute('stroke-linejoin', 'round');
      }
      let parent = s;
      if (shift) {
        parent = document.createElementNS(SVG_NS, 'g');
        parent.setAttribute('transform', `translate(0 ${shift})`);
        s.append(parent);
      }
      for (const d of paths) {
        const p = document.createElementNS(SVG_NS, 'path');
        p.setAttribute('d', d);
        parent.append(p);
      }
      return s;
    }
    const setIcon = (btn, paths, opts) => { btn.replaceChildren(icon(paths, opts)); };
    // Saved tracks get a filled heart, unsaved an outline — the old ♥/♡ pair.
    const setHeart = on =>
      setIcon(ui.like, HEART, { size: SIZE.heart, filled: on, shift: HEART_SHIFT });

    const ctrl = (content, title, onclick, cls = '') =>
      el('button', { class: cls, title, onclick }, content);

    async function guard(fn, thenPoll = false) {
      try {
        await fn();
        if (thenPoll) setTimeout(() => sp.playback.poll(), 350);
      } catch (e) {
        // Only the two the user can act on get a toast. Everything else here
        // is transient — a rate limit, a dropped connection, a non-JSON body —
        // and clears itself on the next poll a few seconds later, so raising
        // it just alarms someone about a problem that has already gone. It
        // still goes to the console for anyone debugging.
        if (e.message === 'NO_DEVICE') toast('No active Spotify device — start playback somewhere first.');
        else if (e.message === 'FORBIDDEN') toast('Spotify refused that (remote control needs Premium).');
        else if (e.message === 'NOT_CONNECTED') renderDisconnected();
        else console.warn('[cgt] Spotify request failed (transient):', e.message);
      }
    }

    async function togglePlay() {
      const playing = sp.playback.playing;
      sp.playback.patch({ is_playing: !playing, progress_ms: sp.playback.progress });
      await guard(() => (playing ? sp.player.pause() : sp.player.play()));
    }

    async function toggleLike() {
      const id = sp.playback.track?.id;
      if (!id) return;
      try {
        liked ? await sp.player.unsave(id) : await sp.player.save(id);
        liked = !liked;
        setHeart(liked);
        ui.like.classList.toggle('on', liked);
      } catch { toast('Could not update your library.'); }
    }

    function paint() {
      const st = sp.playback.raw;
      if (!st || !st.item) {
        ui.title.textContent = 'Nothing playing';
        ui.artist.textContent = 'Start Spotify on any device';
        ui.device.textContent = '';
        ui.art.removeAttribute('src');
        ui.fill.style.width = '0%';
        return;
      }
      const t = st.item;
      ui.title.textContent = t.name;
      ui.artist.textContent = (t.artists || []).map(a => a.name).join(', ') || t.show?.name || '';
      ui.device.textContent = st.device ? `${st.device.name} · ${st.device.type}` : '';
      const art = t.album?.images?.[0]?.url || t.images?.[0]?.url;
      if (art && ui.art.src !== art) ui.art.src = art;
      setIcon(ui.play, st.is_playing ? PAUSE : PLAY, { size: SIZE.play, filled: true });
      ui.shuffle.classList.toggle('on', !!st.shuffle_state);
      ui.repeat.classList.toggle('on', st.repeat_state && st.repeat_state !== 'off');
      setIcon(ui.repeat, st.repeat_state === 'track' ? REPEAT_ONE : REPEAT);
      if (st.device && document.activeElement !== ui.vol) ui.vol.value = st.device.volume_percent ?? 70;
      ui.dur.textContent = msToClock(sp.playback.duration);
    }

    // Last values actually written to the DOM. The bar advances by well under
    // a pixel per frame and the clock only changes once a second, so writing
    // both every frame was 60 style invalidations a second to show the same
    // thing. audio.sync still runs every frame — the visualiser needs it.
    let lastFill = '', lastCur = '';

    function frame() {
      if (sp.playback.raw?.item && !seeking) {
        const p = sp.playback.progress, d = sp.playback.duration || 1;
        const fill = (p / d * 100).toFixed(2) + '%';
        if (fill !== lastFill) { ui.fill.style.width = fill; lastFill = fill; }
        const cur = msToClock(p);
        if (cur !== lastCur) { ui.cur.textContent = cur; lastCur = cur; }
      }
      audio.sync({
        playing: sp.playback.playing,
        position: sp.playback.progress,
        trackId: sp.playback.track?.id,
      });
      raf = requestAnimationFrame(frame);
    }

    let raf = null, offState = null, offTrack = null;

    function start() {
      buildPlayer();
      offState = () => sp.playback.removeEventListener('state', onState);
      offTrack = () => sp.playback.removeEventListener('track', onTrack);
      sp.playback.addEventListener('state', onState);
      sp.playback.addEventListener('track', onTrack);
      sp.playback.addEventListener('error', onErr);
      sp.playback.start();
      if (!raf) raf = requestAnimationFrame(frame);
    }
    const onState = () => paint();
    const onTrack = async e => {
      liked = false;
      setHeart(false);
      ui.like.classList.remove('on');
      try { liked = await sp.player.isSaved(e.detail.id); } catch {}
      setHeart(liked);
      ui.like.classList.toggle('on', liked);
      window.dispatchEvent(new CustomEvent('lgt:track', { detail: e.detail }));
    };
    const onErr = e => { if (e.detail?.message === 'NOT_CONNECTED') renderDisconnected(); };

    (async () => {
      if (await sp.isConnected()) start();
      else if (!S.spotifyClientId)
        renderDisconnected('Spotify isn’t set up yet. Add your <b>Client ID</b> in Settings → Music, then connect.');
      else renderDisconnected();
    })();

    return () => {
      cancelAnimationFrame(raf); raf = null;
      sp.playback.stop();
      offState?.(); offTrack?.();
      sp.playback.removeEventListener('error', onErr);
    };
  },
};

/* ============================ VISUALIZER ============================
   A standing spectrum: each bar owns a fixed frequency range and spikes in
   place as that range gets louder — bass on the left, treble on the right.
   Mirrored about the centre line. Bare by design: no panel, no header, no
   controls. Everything configurable lives in Settings → Music. */
export const visualizer = {
  id: 'visualizer', title: 'Visualizer', className: 'w-viz', bare: true,
  render(panel) {
    const canvas = el('canvas');
    panel.append(canvas);

    const ctx = canvas.getContext('2d');
    let raf = 0;

    // Checked every frame rather than on a ResizeObserver: render() runs while
    // the panel is still detached, so any size measured here would be zero.
    function ensureSize() {
      const dpr = devicePixelRatio || 1;
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = w; canvas.height = h;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Gap wider than the bar keeps them reading as discrete ticks.
    const BAR = 2.5, GAP = 3.5;

    // The accent colour was read with getComputedStyle every frame and then
    // pushed through the hex regex five times to build the gradient — all to
    // produce the same strings until the user changes the accent. Resolve it
    // once and rebuild only when it, or the canvas size, actually changes.
    let accent = '', accentAt = 0, barGrad = null, barGradKey = '';
    function currentAccent() {
      // Cheap poll rather than a settings subscription: the widget is torn
      // down and rebuilt on most changes, and this keeps it self-contained.
      const now = performance.now();
      if (now - accentAt > 500) {
        accentAt = now;
        accent = getComputedStyle(document.documentElement)
          .getPropertyValue('--accent').trim() || '#7cc6ff';
      }
      return accent;
    }

    /** Average the spectrum across the slice of bands this bar represents. */
    function bandAt(d, i, count) {
      const lo = Math.floor(i / count * BANDS);
      const hi = Math.max(lo + 1, Math.floor((i + 1) / count * BANDS));
      let sum = 0;
      for (let j = lo; j < hi; j++) sum += d[j];
      return sum / (hi - lo);
    }

    /** Mean over a fractional band range — keeps peaks that interpolation
     *  would skip, and stays smooth while the layout morphs. */
    function bandSpan(d, b0, b1) {
      const lo = Math.max(0, Math.min(BANDS - 1, b0));
      const hi = Math.max(lo + 0.001, Math.min(BANDS, b1));
      const i0 = Math.floor(lo), i1 = Math.ceil(hi);
      let sum = 0, n = 0;
      for (let j = i0; j < i1 && j < BANDS; j++) { sum += d[j]; n++; }
      return n ? sum / n : 0;
    }

    function draw() {
      ensureSize();
      audio.bpm = S.vizBpm || 120;
      audio.sensitivity = (S.vizSensitivity ?? 100) / 100;
      audio.vocalEmphasis = (S.vizVocal ?? 55) / 100;

      // Radial needs a squarer box than the wide waveform strip; CSS keys off this.
      if (panel.dataset.mode !== S.vizMode) panel.dataset.mode = S.vizMode;

      const d = audio.read();
      const w = canvas.clientWidth, h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      const accent = currentAccent();
      if (S.vizMode === 'radial') drawRadial(d, w, h, accent);
      else drawBars(d, w, h, accent);

      raf = requestAnimationFrame(draw);
    }

    function drawBars(d, w, h, accent) {
      const cy = h / 2;
      const maxH = h * 0.47;
      const count = Math.max(8, Math.floor(w / (BAR + GAP)));

      // Faint centre rule, so silence still reads as a waveform.
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(0, cy - 0.5, w, 1);

      // Glass: bright translucent core, accent-tinted tips, soft bloom.
      // Cached: the stops only move when the height or the accent changes.
      const key = accent + '|' + cy.toFixed(1) + '|' + maxH.toFixed(1);
      if (key !== barGradKey) {
        barGrad = ctx.createLinearGradient(0, cy - maxH, 0, cy + maxH);
        barGrad.addColorStop(0.00, withAlpha(accent, 0.55));
        barGrad.addColorStop(0.34, 'rgba(255,255,255,0.95)');
        barGrad.addColorStop(0.50, 'rgba(255,255,255,1)');
        barGrad.addColorStop(0.66, 'rgba(255,255,255,0.95)');
        barGrad.addColorStop(1.00, withAlpha(accent, 0.55));
        barGradKey = key;
      }
      const grad = barGrad;

      ctx.save();
      ctx.shadowColor = withAlpha(accent, 0.75);
      ctx.fillStyle = grad;
      // Mirrored about the vertical centre: bass in the middle, treble pushing
      // out to both edges, so the shape grows outward from the centre.
      const mid = (count - 1) / 2;
      const half = Math.ceil(count / 2);
      // Centre the block: count*(BAR+GAP) rarely divides w exactly, and the
      // leftover would push the mirror axis off the canvas centre.
      const span = count * BAR + (count - 1) * GAP;
      const x0 = (w - span) / 2;

      // Adaptive split. `core` is the fraction of each half given to the beat:
      // 1 during a drum-only passage (bass owns the whole bar), shrinking to
      // MIN_CORE once vocals come in, which pushes them out to the flanks.
      const MIN_CORE = 0.34;
      const split = S.vizSplit !== false;
      const core = split ? 1 - audio.vocalPresence * (1 - MIN_CORE) : 0;

      /** Normalised distance-from-centre -> band position.
       *
       *  Each region is anchored at its own end and grows toward the split
       *  point between them, so they never compete for the same space:
       *
       *    centre |beat --->            <--- vocals| edge
       *
       *  The beat starts at the centre with its lowest frequency and rises
       *  outward. The vocals start at the OUTER EDGE with their lowest
       *  frequency and rise inward — reversed on purpose, because a voice is
       *  loudest in its low formants, and anchoring those at the edge is what
       *  makes the vocals appear to start at the edge and spread inward as
       *  they get louder. Previously the flank ran outward through everything
       *  above 215Hz up to 16kHz, so the silent top of that range occupied the
       *  outermost bars and the vocals never touched the edge. */
      const tToBand = t => {
        if (!split) return t * BANDS;                       // plain full spectrum
        if (t <= core) return core > 0.001 ? (t / core) * BASS_BANDS : 0;
        const u = (1 - t) / Math.max(0.001, 1 - core);      // 0 at the edge, 1 at the split
        return VOICE_BAND_LO + u * (VOICE_BAND_HI - VOICE_BAND_LO);
      };

      for (let i = 0; i < count; i++) {
        const dist = Math.abs(i - mid);
        const t0 = Math.max(0, dist - 0.5) / half;
        const t1 = Math.min(1, (dist + 0.5) / half);
        // The flank runs inward, so its band numbers descend with t. Order
        // them before asking for the span.
        const bA = tToBand(t0), bB = tToBand(t1);
        const a = bandSpan(d, Math.min(bA, bB), Math.max(bA, bB));
        const bh = Math.max(1.25, a * maxH);
        // Blur must stay under the gap width or neighbouring bars bleed
        // together and the whole thing renders as one solid block.
        ctx.shadowBlur = 1 + a * 2.5;
        ctx.globalAlpha = 0.55 + a * 0.45;
        roundRect(ctx, x0 + i * (BAR + GAP), cy - bh, BAR, bh * 2, BAR / 2);
        ctx.fill();
      }
      ctx.restore();
    }

    function drawRadial(d, w, h, accent) {
      const cx = w / 2, cy = h / 2;
      const span = Math.min(w, h);
      const r0 = span * 0.17 * (1 + audio.bass * 0.22);   // ring breathes with the bass
      const reach = span * 0.30;
      const count = 84;

      ctx.save();
      ctx.strokeStyle = withAlpha(accent, 0.28);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, r0, 0, Math.PI * 2);
      ctx.stroke();

      const grad = ctx.createRadialGradient(cx, cy, r0, cx, cy, r0 + reach);
      grad.addColorStop(0, 'rgba(255,255,255,0.98)');
      grad.addColorStop(1, withAlpha(accent, 0.5));

      ctx.strokeStyle = grad;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.6, span * 0.012);
      ctx.shadowColor = withAlpha(accent, 0.7);

      for (let i = 0; i < count; i++) {
        // Mirror the spectrum around the vertical axis so both halves match.
        const half = i < count / 2 ? i : count - 1 - i;
        const a = bandAt(d, half, Math.ceil(count / 2));
        const ang = (i / count) * Math.PI * 2 - Math.PI / 2;
        const len = r0 + Math.max(1.5, a * reach);
        ctx.shadowBlur = 1 + a * 4;
        ctx.globalAlpha = 0.45 + a * 0.55;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
        ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
        ctx.stroke();
      }
      ctx.restore();
    }

    function roundRect(c, x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      c.beginPath();
      c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r);
      c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r);
      c.arcTo(x, y, x + w, y, r); c.closePath();
    }

    /** #rrggbb -> rgba(). Accent is user-set, so tolerate odd values. */
    function withAlpha(hex, a) {
      const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
      if (!m) return `rgba(124,198,255,${a})`;
      return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
    }

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  },
};

/* ============================ LYRICS ============================ */
function parseLRC(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const stamps = [...line.matchAll(/\[(\d+):(\d+)(?:[.:](\d+))?\]/g)];
    const words = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) {
      const frac = m[3] ? Number('0.' + m[3]) : 0;
      out.push({ t: (+m[1] * 60 + +m[2] + frac) * 1000, text: words });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

export const lyrics = {
  id: 'lyrics', title: 'Lyrics', className: 'w-lyrics',
  render(panel) {
    const scroll = el('div', { class: 'lyr-scroll' });
    const box = el('div', { class: 'lyr-box' }, scroll);
    const status = el('span', { class: 'grow', style: { textTransform: 'none', letterSpacing: 0 } });
    panel.append(head('Lyrics', status), box);

    let lines = [], plain = null, current = -1, timer = 0, lastKey = '';

    function empty(msg) {
      lines = []; plain = null; current = -1;
      syncOff();                        // nothing to follow — stop ticking
      scroll.innerHTML = `<div class="lyr-empty">${escapeHtml(msg)}</div>`;
      scroll.style.transform = '';
    }

    async function load(track) {
      if (!track) return empty('Nothing playing.');
      const artist = (track.artists || []).map(a => a.name)[0] || '';
      const name = track.name || '';
      const album = track.album?.name || '';
      const dur = Math.round((track.duration_ms || 0) / 1000);
      const key = `${artist}|${name}|${dur}`;
      if (key === lastKey && lines.length) return;
      lastKey = key;

      status.textContent = 'searching…';
      empty('Looking for lyrics…');

      const q = new URLSearchParams({ artist_name: artist, track_name: name, album_name: album, duration: dur });
      let { data } = await cachedFetch('lrc:' + key, 'https://lrclib.net/api/get?' + q, { ttl: 30 * 864e5 });

      if (!data) {
        const q2 = new URLSearchParams({ artist_name: artist, track_name: name });
        const res = await cachedFetch('lrcs:' + key, 'https://lrclib.net/api/search?' + q2, { ttl: 7 * 864e5 });
        data = Array.isArray(res.data) ? res.data.find(r => r.syncedLyrics) || res.data[0] : null;
      }

      if (!data) { status.textContent = 'not found'; return empty('No lyrics found for this track.'); }

      if (data.syncedLyrics) {
        lines = parseLRC(data.syncedLyrics);
        status.textContent = 'synced';
        scroll.innerHTML = '';
        lines.forEach(l => scroll.append(el('div', { class: 'lyr-line', text: l.text || '♪' })));
        current = -1;
        syncOn();                       // only synced lyrics need a ticker
      } else if (data.plainLyrics) {
        plain = data.plainLyrics;
        status.textContent = 'unsynced';
        syncOff();                      // no timestamps to follow
        scroll.innerHTML = '';
        plain.split('\n').forEach(t => scroll.append(el('div', { class: 'lyr-line near', text: t || ' ' })));
      } else {
        status.textContent = 'instrumental';
        empty('Instrumental.');
      }
    }

    // A timer rather than requestAnimationFrame, and only while there is
    // something to sync. The old loop ran at 60fps unconditionally — including
    // with Spotify disconnected, when it had no work at all. Highlighting a
    // line needs nowhere near that: the scroll itself is a CSS transition, so
    // 10/s is indistinguishable and does a sixth of the work.
    function frame() {
      if (!lines.length) return;
      const t = sp.playback.progress + (S.lyricsOffset || 0);
      let idx = -1;
      for (let i = 0; i < lines.length; i++) { if (lines[i].t <= t) idx = i; else break; }
      if (idx === current) return;

      current = idx;
      const kids = [...scroll.children];
      kids.forEach((n, i) => {
        n.classList.toggle('active', i === idx);
        n.classList.toggle('near', Math.abs(i - idx) === 1);
      });
      const node = kids[idx];
      if (node) {
        const target = node.offsetTop - box.clientHeight / 2 + node.offsetHeight / 2;
        scroll.style.transform = `translateY(${-Math.max(0, target)}px)`;
      }
    }

    function syncOn() { if (!timer) timer = setInterval(frame, 100); }
    function syncOff() { clearInterval(timer); timer = 0; }

    const onTrack = e => load(e.detail);
    window.addEventListener('lgt:track', onTrack);
    if (sp.playback.track) load(sp.playback.track);
    else empty('Connect Spotify to see lyrics.');

    return () => { syncOff(); window.removeEventListener('lgt:track', onTrack); };
  },
};