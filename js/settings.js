// The settings drawer. Every control writes straight to state and re-applies.
import { $, el, toast, dropCache, debounce, clamp, hostOf } from './util.js';
import { WALLPAPERS, WIDGET_META, DEFAULTS, HOLIDAYS,
         WIDGET_SIZE, PHOTOS, CLIPS, BG_PREFIX, bgThumb,
         ARCADE } from './config.js';
import { countdownTarget } from './widgets/core.js';
import { S, set, setWidget, resetAll, exportSettings, importSettings,
         isHttpURL, bestScore, levelFor } from './state.js';
import { applyTheme, applyVideoWallpaper, cssImageURL,
         invalidateLocalImage, invalidateLocalVideo, clearLocalPoster,
         clearStillThumb } from './theme.js';
import { putBlob, getBlob, delBlob, storageEstimate, fmtBytes,
         WALLPAPER_IMAGE_KEY, WALLPAPER_VIDEO_KEY } from './media.js';
import { audio } from './audio.js';
import { activeFolder, activeSpace, spaceList } from './spaces.js';
import { applyDockSettings, renderDock, importBookmarks,
         parseBookmarksFile, parseLinkList, IMPORT_CAP } from './dock.js';
import { searchPlaces, detectPlace } from './widgets/index.js';
import * as sp from './spotify.js';
import { play, drawPreview } from './arcade.js';
import { t, changeLocale, wanted } from './i18n.js';
import { ACTIONS, DEFAULT_KEYS, bindingFrom, bindingProblem, findConflict,
         keyLabel, resolve as resolveKey } from './keys.js';
import { LOCALES } from './locales/index.js';

let rebuild = () => {};
let activeTab = 'look';
let query = '';               // the settings search; '' means the normal tabbed view

const TABS = {
  look: 'Look',
  glass: 'Glass',
  dock: 'Dock',
  widgets: 'Widgets',
  arcade: 'Arcade',
  weather: 'Weather',
  news: 'News',
  music: 'Music',
  data: 'Data',
  keys: 'Shortcuts',
};

/* ---------- control factories ---------- */
/** A settings row: label on the left, control on the right.
 *  Rows used to render an explanatory grey subtitle underneath. They are no
 *  longer shown. Call sites still pass that text as a third argument — JS
 *  ignores extra arguments, and keeping it means the reasoning behind each
 *  setting stays in the source rather than being lost. */
function row(label, control) {
  return el('div', { class: 'set-row' },
    el('label', {}, el('span', { text: label })),
    control);
}

function toggle(key, after) {
  const sw = el('div', { class: 'switch' + (S[key] ? ' on' : ''), role: 'switch' }, el('i'));
  sw.addEventListener('click', async () => {
    sw.classList.toggle('on');
    await set({ [key]: sw.classList.contains('on') });
    applyTheme(); after?.();
  });
  return sw;
}

/** One rebindable shortcut: a chip showing the current keys, which becomes a
 *  capture field when clicked.
 *
 *  The capture listener is on window in the capture phase so it runs before
 *  anything else — otherwise pressing the key you are trying to bind would
 *  also *do* the thing, and binding "open settings" would close the drawer you
 *  are standing in. stopPropagation is what keeps that from happening. */
/** The chip that captures a keypress.
 *
 *  One interaction, two owners. `spec` says where the binding lives:
 *  `read()` gives the current one, `write(b)` stores it (undefined meaning
 *  "back to the default"), `overridden()` decides whether ↺ has anything to
 *  do, and `except` tells the conflict check which entry to ignore — itself.
 *  Actions and bookmarks share one keyboard, so the check has to span both. */
function bindingChip(spec) {
  const chip = el('button', { class: 'btn key-chip', type: 'button' });
  const reset = el('button', {
    class: 'icon-btn key-reset', type: 'button', text: '↺',
    title: t('Back to the default'),
    onclick: async () => { await save(undefined); },
  });
  const clear = el('button', {
    class: 'icon-btn key-clear', type: 'button', text: '✕',
    title: t('Unbind this shortcut'),
    onclick: async () => { await save(''); },
  });
  const wrap = el('div', { class: 'key-cell' }, chip, clear, reset);

  const paint = () => {
    const b = spec.read();
    chip.textContent = keyLabel(b);
    chip.classList.toggle('unset', !b);
    chip.title = t('Click, then press the keys you want');
    // Both buttons are hidden rather than removed, so the rows stay the same
    // width and the chips stay in a column. Each appears only when it has
    // something to do: nothing to clear when the shortcut is already unbound,
    // nothing to reset when it is already the default.
    clear.style.visibility = b ? 'visible' : 'hidden';
    reset.style.visibility = spec.overridden() ? 'visible' : 'hidden';
  };

  let capturing = false;
  const stop = () => {
    if (!capturing) return;
    capturing = false;
    window.removeEventListener('keydown', onKey, true);
    chip.classList.remove('capturing');
    paint();
  };

  async function save(binding) {
    await spec.write(binding);
    stop();
    draw();
  }

  async function onKey(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { stop(); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { await save(''); return; }

    const b = bindingFrom(e);
    if (!b) return;                       // a modifier held on its own — keep waiting

    const problem = bindingProblem(b);
    if (problem) { toast(t(problem)); return; }        // stay in capture, try again

    const clash = findConflict(S.keys, S.bookmarkKeys, b, spec.except);
    if (clash) {
      toast(t('{key} is already {action}.', {
        key: keyLabel(b),
        action: clash.kind === 'action' ? t(clash.label) : clash.label,
      }));
      return;
    }
    await save(b);
  }

  chip.addEventListener('click', () => {
    if (capturing) { stop(); return; }
    capturing = true;
    chip.classList.add('capturing');
    chip.textContent = t('Press a key…');
    window.addEventListener('keydown', onKey, true);
    // Losing focus without a keypress should not leave the row stuck saying
    // "Press a key…" forever.
    chip.addEventListener('blur', stop, { once: true });
  });

  paint();
  return wrap;
}

/** One of the built-in actions. */
function keyBinder(action) {
  return bindingChip({
    except: { actionId: action.id },
    read: () => resolveKey(S.keys, action.id),
    overridden: () => S.keys?.[action.id] !== undefined,
    write: async binding => {
      const next = { ...S.keys };
      // undefined means "back to the default", and a value equal to the default
      // is the same thing — storing it would pin this action to today's default
      // if the default ever changed.
      if (binding === undefined || binding === DEFAULT_KEYS[action.id]) delete next[action.id];
      else next[action.id] = binding;
      await set({ keys: next });
    },
  });
}

/** One bookmark. There is no default to go back to, so ↺ removes the entry
 *  outright — an unbound bookmark shortcut is just a row doing nothing. */
function bookmarkBinder(index) {
  return bindingChip({
    except: { bookmarkIndex: index },
    read: () => (S.bookmarkKeys || [])[index]?.key || '',
    // No default to go back to, so ↺ would only duplicate what ✕ does.
    overridden: () => false,
    write: async binding => {
      const list = (S.bookmarkKeys || []).slice();
      const entry = list[index];
      // The row can disappear between the chip being built and a key being
      // pressed: another tab writing settings reloads them here. Spreading
      // `undefined` would have stored a binding with no URL behind it — a
      // shortcut that does nothing and is then dropped on the next read.
      if (!entry) { toast(t('That shortcut is no longer there.')); draw(); return; }
      if (binding === undefined || binding === '') list.splice(index, 1);
      else list[index] = { ...entry, key: binding };
      await set({ bookmarkKeys: list });
    },
  });
}

/** Every bookmark with a URL, flattened, for the picker. Capped because a
 *  heavy bookmark tree would otherwise build a select with thousands of
 *  options every time this tab is drawn — including once per keystroke while
 *  the settings search is running. */
async function flatBookmarks(limit = 500) {
  try {
    const [root] = await chrome.bookmarks.getTree();
    const out = [];
    (function walk(nodes) {
      for (const n of nodes) {
        if (out.length >= limit) return;
        if (n.url) { if (isHttpURL(n.url)) out.push(n); }
        else if (n.children) walk(n.children);
      }
    })(root.children || []);
    return out;
  } catch { return []; }
}

/** The "put a bookmark on a key" group. */
function bookmarkShortcuts() {
  const wrap = el('div');
  const list = S.bookmarkKeys || [];

  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    wrap.append(row(b.title || hostOf(b.url), bookmarkBinder(i)));
  }
  if (!list.length) {
    wrap.append(el('div', { class: 'hint', style: { lineHeight: 1.55 } },
      'No bookmark shortcuts yet. Pick one below and give it a key.'));
  }

  // The picker is filled asynchronously, so the row exists first and gains its
  // options when the tree arrives — the tab must not wait on the bookmarks API.
  const pick = el('select', { style: { maxWidth: '100%', flex: '1' } },
    el('option', { value: '' }, t('Loading…')));
  const add = el('button', {
    class: 'btn', text: t('Add'), disabled: true,
    onclick: async () => {
      const url = pick.value;
      if (!url) return;
      if ((S.bookmarkKeys || []).some(b => b.url === url)) {
        return toast(t('That bookmark already has a row.'));
      }
      const opt = pick.selectedOptions[0];
      await set({ bookmarkKeys: [...(S.bookmarkKeys || []), { key: '', url, title: opt?.dataset.title || '' }] });
      draw();
      // Straight into capture on the row just added, rather than making the
      // user find it and click it. Adding a shortcut and giving it a key is
      // one intention, and splitting it in two left a row sitting there
      // unbound — which is exactly the state that used to get thrown away.
      const rows = [...$('#settings').querySelectorAll('.key-cell .key-chip')];
      rows[rows.length - 1]?.click();
    },
  });
  flatBookmarks().then(nodes => {
    pick.innerHTML = '';
    if (!nodes.length) {
      pick.append(el('option', { value: '' }, t('No bookmarks found')));
      return;
    }
    for (const n of nodes) {
      pick.append(el('option', { value: n.url, dataset: { title: n.title || '' } },
        (n.title || hostOf(n.url)).slice(0, 70)));
    }
    add.disabled = false;
  });

  wrap.append(el('div', { class: 'set-row' }, pick, add));
  return wrap;
}


function slider(key, min, max, step = 1, after) {
  const out = el('span', { class: 'faint tabular', style: { width: '42px', textAlign: 'right', fontSize: '11px' } });
  const inp = el('input', { type: 'range', min, max, step, value: S[key] });
  const show = () => { out.textContent = inp.value; };
  show();
  inp.addEventListener('input', debounce(async () => {
    show();
    await set({ [key]: +inp.value });
    applyTheme(); after?.();
  }, 40));
  inp.addEventListener('input', show);
  return el('span', { class: 'row' }, inp, out);
}

function select(key, options, after) {
  const s = el('select', {}, ...Object.entries(options).map(([v, label]) =>
    el('option', { value: v, selected: String(S[key]) === v }, label)));
  s.addEventListener('change', async () => { await set({ [key]: s.value }); applyTheme(); after?.(); });
  return s;
}

function text(key, placeholder = '', after) {
  const i = el('input', { type: 'text', value: S[key] ?? '', placeholder });
  i.addEventListener('change', async () => { await set({ [key]: i.value }); applyTheme(); after?.(); });
  return i;
}

function number(key, min, max, after) {
  const i = el('input', { type: 'number', min, max, value: S[key] ?? 0 });
  i.addEventListener('change', async () => {
    // min/max on the element are advisory: the browser will not stop a typed
    // or pasted value, and `+''` for a cleared field is 0. That 0 was written
    // straight through, so emptying "Max items" hid every bookmark in the dock
    // and emptying "Headlines shown" emptied the news panel.
    const raw = i.value.trim();
    const v = raw === '' || !Number.isFinite(+raw) ? (S[key] ?? min) : clamp(+raw, min, max);
    i.value = v;                       // show what was actually stored
    await set({ [key]: v });
    after?.();
  });
  return i;
}

function color(key) {
  const i = el('input', { type: 'color', value: S[key] });
  i.addEventListener('input', debounce(async () => { await set({ [key]: i.value }); applyTheme(); }, 60));
  return i;
}

/** Whether the still layer is what you are actually looking at.
 *
 *  The video layer renders on top of the still one, so while a clip is playing
 *  the still underneath is invisible. Highlighting it anyway is what let a
 *  photo and a clip both appear selected at once.
 *
 *  It stays *set*, though — it is not cleared when a clip is chosen. Turn the
 *  clip off and the wallpaper you had comes back and lights up again, which
 *  also means picking a clip can never quietly discard an uploaded image that
 *  has no other way back into the UI. */
const stillShowing = () => !S.wallpaperVideo;

/** A packaged-background swatch. Draws the small thumbnail file rather than
 *  the full-size background: the picker shows every one of them at once, and
 *  pointing it at the real files would decode ~8 MB apiece to fill a grid of
 *  64px squares. */
function bgSwatch(entry, { clip = false, on, onPick }) {
  return el('div', {
    class: 'wp-sw wp-img' + (clip ? ' wp-clip' : '') + (on ? ' on' : ''),
    style: { backgroundImage: `url("${bgThumb(entry.id)}")` },
    title: on ? `${entry.name} — click to turn off` : `${entry.name} — ${entry.credit}`,
    onclick: onPick,
  });
}

const group = (title, ...rows) => el('div', { class: 'set-group' }, el('h3', { text: title }), ...rows);

/* ---------- interactive background ---------- */

/** Open a page in a new tab. `chrome.tabs` is absent when this runs outside an
 *  extension context, such as the local dev harness, so fall back to window.open. */
function openTab(url) {
  if (chrome?.tabs?.create) chrome.tabs.create({ url });
  else window.open(url, '_blank', 'noopener');
}

/** A locale id as the language's own name, for the 'auto' row. */
const nameOf = id => (LOCALES.find(l => l.id === id) || LOCALES[0]).name;

/* ---------- arcade ----------
   Each card shows a still of the game rather than only its name. The games are
   called Game 1/2/3 on purpose — see ARCADE in js/config.js — so without a
   picture there is nothing on the card that tells you which is which, and a
   blurb alone makes you read three of them to find the one you wanted.

   The previews come from the game modules themselves, so they cannot drift
   away from what the game actually looks like. They are drawn on demand, which
   is also the first thing that loads js/games/ at all — a new tab that never
   opens this panel never pays for any of it. */
function arcadeGroup() {
  const launch = async id => {
    // The drawer covers a third of the screen and a game needs all of it.
    $('#settings').hidden = true;
    if (!await play(id)) toast(t('Could not start that game'));
  };

  const card = entry => {
    const shot = el('canvas', { class: 'ar-shot', 'aria-hidden': 'true' });
    // Straight away, with no wait for layout. drawPreview uses a fixed backing
    // size for exactly this reason — see the note there — so the canvas does
    // not need to be in the tree yet, and the only asynchrony left is the
    // registry import.
    drawPreview(entry.id, shot);

    // A game with levels files its record per level, so the card shows the
    // record for the level that is actually selected — showing a bare `game1`
    // best would be a key nothing ever writes.
    const key = entry.levels ? `${entry.id}.${levelFor(entry.id).id}` : entry.id;
    const best = bestScore(key);
    return el('button', {
      class: 'ar-card', type: 'button', onclick: () => launch(entry.id),
      title: `Play ${entry.name}`,
    },
      shot,
      el('span', { class: 'ar-name', text: t(entry.name) }),
      el('span', { class: 'ar-blurb', text: t(entry.blurb) }),
      el('span', { class: 'ar-best', text: best
        ? `${t(entry.score)} ${best}${entry.unit || ''}`
        : t('No record yet') }),
    );
  };

  const levelled = ARCADE.filter(g => g.levels);

  return group(t('Arcade'),
    el('div', { class: 'ar-grid' }, ...ARCADE.map(card)),
    // Records only — no control. Difficulty is picked inside the game, on a
    // panel beside the board, because it is something you change between
    // rounds: leaving the game to open a settings tab to restart the thing you
    // are looking at is the wrong shape for it. This is here so the two levels
    // you are not playing still have their records somewhere visible.
    ...levelled.map(g => el('div', { class: 'ar-levels' },
      ...g.levels.map(l => {
        const b = bestScore(`${g.id}.${l.id}`);
        return el('div', {
          class: 'ar-level' + (levelFor(g.id)?.id === l.id ? ' on' : ''),
        },
          // The game is abbreviated from its id, not from its name: "Game 1"
          // shortens to "G1" in English and to nothing sensible in Korean, and
          // the id is the same in every language.
          el('span', { class: 'ar-level-name',
            text: `G${g.id.replace(/\D/g, '')} ${t(l.name)}` }),
          el('span', { class: 'ar-level-best', text: b ? `${b}${g.unit || ''}` : '—' }),
        );
      }))),
    el('div', { class: 'hint', style: { lineHeight: 1.55 } },
      'Plays on your wallpaper, with the page dimmed and click-through so a '
      + 'stray click lands on the game rather than a bookmark. Esc leaves at '
      + 'any point and your record is kept.'),
  );
}

/* ---------- tab bodies ---------- */
const PANELS = {
  look: () => [
    group(t('Language'),
      row(t('Language'), (() => {
        // Rebuilt through changeLocale rather than draw(), because every other
        // surface on the page holds translated strings too — the dock, the
        // homescreen bar and every widget were all built from text.
        const sel = el('select', {},
          el('option', { value: 'auto', selected: (S.language || 'auto') === 'auto' },
            `${t('Follow the browser')} — ${nameOf(wanted())}`),
          ...LOCALES.map(l => el('option', {
            value: l.id, selected: S.language === l.id,
          // Each language in its own script, with the English name alongside so
          // the list is searchable by someone who cannot read the script yet.
          }, l.id === 'en' ? l.name : `${l.name} · ${l.en}`)));
        sel.addEventListener('change', async () => {
          await set({ language: sel.value });
          await changeLocale(wanted());
          draw();
        });
        return sel;
      })())),
    group(t('Wallpaper'),
      el('div', { class: 'wp-swatches' }, ...WALLPAPERS.map(w =>
        el('div', {
          class: 'wp-sw' + (stillShowing() && !S.wallpaperCustom && S.wallpaper === w.id ? ' on' : ''),
          // The longhand, not `background:`. The shorthand resets every
          // background longhand it does not mention — including the
          // background-origin and background-repeat that stop the swatch
          // tiling its own edge into the 2px transparent border.
          style: { backgroundImage: w.css }, title: w.name,
          onclick: () => pickStill({ wallpaper: w.id, wallpaperCustom: '' }),
        }))),
      el('div', { class: 'set-sub', text: 'Photos' }),
      el('div', { class: 'wp-swatches' }, ...PHOTOS.map(ph => {
        const on = stillShowing() && S.wallpaperCustom === BG_PREFIX + ph.id;
        return bgSwatch(ph, {
          on,
          // Clicking the active one turns it off, back to the gradient
          // underneath. Without this a photo could only ever be swapped for
          // another photo, never removed — the Clear button next to it is for
          // an uploaded file and deletes that file's blob, which is the wrong
          // thing entirely for a built-in.
          onPick: () => pickStill({ wallpaperCustom: on ? '' : BG_PREFIX + ph.id }),
        });
      })),
      row(t('Dim'), slider('stillDim', 0, 80, 5),
        'Darkens a photo wallpaper so widgets stay readable over a bright one. '
        + 'Gradients are unaffected.'),
      row(t('Custom image'), el('div', { class: 'row' },
        el('button', { class: 'btn', text: t('Upload…'), onclick: pickImage }),
        el('button', { class: 'btn', text: t('Clear'), onclick: clearImage })),
        'A local file is stored inside the extension — it never leaves your machine.'),
      row(t('Image URL'), (() => {
        const i = el('input', { type: 'text', placeholder: 'https://…',
          value: S.wallpaperCustom?.startsWith('http') ? S.wallpaperCustom : '' });
        i.addEventListener('change', async () => {
          const v = i.value.trim();
          // Rejected here rather than silently ignored later, so a typo or a
          // javascript:/data: paste says so instead of quietly doing nothing.
          // isHttpURL as well as cssImageURL: the latter resolves against the
          // page, so it accepted a scheme-less "example.com/a.jpg" that
          // sanitize() then wiped on the next load.
          if (v && (!isHttpURL(v) || !cssImageURL(v))) {
            toast(t('Enter an http(s) image URL')); return;
          }
          if (v) await delBlob(WALLPAPER_IMAGE_KEY).catch(() => {});
          // Same as the upload path: setting a still wallpaper turns off a
          // running clip. Emptying the field is not choosing a wallpaper, so
          // that case must not reach through and stop the video too.
          if (v) await pickStill({ wallpaperCustom: v }, 'Wallpaper set');
          else { await set({ wallpaperCustom: '' }); applyTheme(); draw(); }
        });
        return i;
      })()),
    ),
    group(t('Live wallpaper (video)'),
      el('div', { class: 'wp-swatches' }, ...CLIPS.map(cl => {
        const on = S.wallpaperVideo === BG_PREFIX + cl.id;
        return bgSwatch(cl, {
          clip: true,
          on,
          // Turning a built-in clip off is not the same as the Remove button
          // below, which deletes an uploaded file from IndexedDB. This only
          // unsets the choice; there is no blob to delete.
          onPick: async () => {
            await set(on ? { wallpaperVideo: '', wallpaperVideoName: '' }
                         : { wallpaperVideo: BG_PREFIX + cl.id, wallpaperVideoName: cl.name });
            applyTheme(); draw();
          },
        });
      })),
      row('Current', el('span', { class: 'faint', style: { fontSize: '12px' },
        text: S.wallpaperVideo === 'local' ? (S.wallpaperVideoName || 'local file')
          : S.wallpaperVideo?.startsWith(BG_PREFIX) ? (S.wallpaperVideoName || 'built in')
          : S.wallpaperVideo ? 'from URL' : 'none' })),
      row(t('Video file'), el('div', { class: 'row' },
        el('button', { class: 'btn', text: t('Choose MP4…'), onclick: pickVideo }),
        el('button', { class: 'btn danger', text: t('Remove'), onclick: clearVideo })),
        'MP4 or WebM. Stored locally in the extension — never uploaded. '
        + 'It is muted and loops; Chrome blocks autoplay for anything with sound.'),
      row(t('Video URL'), (() => {
        const i = el('input', { type: 'text', placeholder: 'https://…/clip.mp4',
          value: /^https?:/.test(S.wallpaperVideo || '') ? S.wallpaperVideo : '' });
        i.addEventListener('change', async () => {
          const v = i.value.trim();
          // The same test sanitize() applies on the way back in. This field
          // used to accept anything at all — a bare host, ftp:, javascript: —
          // and the next load quietly wiped whatever sanitize did not
          // recognise, so a typo looked accepted, played nothing, and had
          // disappeared by the time you came back to check.
          if (v && !isHttpURL(v)) { toast(t('Enter an http(s) video URL')); return; }
          await set({ wallpaperVideo: v, wallpaperVideoName: '' });
          applyTheme(); draw();
        });
        return i;
      })()),
      row(t('Dim'), slider('videoDim', 0, 80, 1), 'Darkens the video so widgets stay readable.'),
      row(t('Playback speed'), slider('videoSpeed', 25, 200, 5, applyVideoWallpaper)),
      row(t('Pause when tab hidden'), toggle('videoPauseHidden'), 'Saves battery. Recommended.'),
    ),
    group(t('Motion'),
      row(t('Animated colour blobs'), toggle('animateBg')),
      row(t('Blob intensity'), slider('mesh', 0, 100, 1),
        (S.wallpaperCustom || S.wallpaperVideo)
          ? 'Blobs are hidden while a custom image or video is set, so they don’t veil it.' : null),
      row(t('Film grain'), slider('grain', 0, 20, 1)),
      row(t('Vignette'), slider('vignette', 0, 100, 5)),
    ),
    group(t('Theme'),
      row(t('Colour scheme'), select('scheme', { dark: t('Dark'), light: t('Light') })),
      row(t('Accent colour'), color('accent')),
      row(t('UI scale'), slider('fontScale', 80, 130, 1)),
    ),
    group(t('Clock & greeting'),
      row(t('Your name'), text('userName', 'shown in the greeting')),
      row(t('24-hour clock'), toggle('clock24')),
      row(t('Show seconds'), toggle('showSeconds', rebuild)),
      row(t('Clock size'), slider('clockSize', 40, 140, 2)),
    ),
    group(t('Search'),
      row(t('Live suggestions'), toggle('suggestions'), 'Queries go to DuckDuckGo’s autocomplete endpoint as you type.'),
      el('div', { class: 'hint', style: { lineHeight: 1.55 } },
        'Searches go to whichever engine Chrome itself is set to use. To change '
        + 'it, open Chrome’s settings and look under Search engine — this box '
        + 'follows whatever you pick there, and so does the address bar, so the '
        + 'two can no longer disagree. CGT used to keep its own list, which meant '
        + 'a new tab could quietly send you somewhere you had not chosen.'),
      el('div', { class: 'hint', style: { lineHeight: 1.55 } },
        'The ◐ button beside the search box opens an empty private window, and '
        + 'so does pressing I.'),
    ),
  ],

  glass: () => [
    group(t('Performance'),
      row(t('Low performance mode'), toggle('lowPerf', () => {
        applyDockSettings();     // the magnify loop reads this on its next frame
        draw();                  // the drawer's own re-render, so the note below
                                 // appears now rather than next time it is opened.
                                 // `rebuild` is the widget layout, which is a
                                 // different thing and does not need rebuilding.
      })),
      el('div', { class: 'hint', style: { lineHeight: 1.55 } },
        'For older or slower machines. Panels turn solid instead of frosted, the '
        + 'background stops drifting, a live wallpaper holds on its first frame, '
        + 'and the dock stops magnifying.'),
      el('div', { class: 'hint', style: { lineHeight: 1.55 } },
        'Nothing below is changed. These settings are overridden while the mode '
        + 'is on and come back exactly as you left them when you turn it off.'),
    ),
    group(t('Glass material'),
      // Sliders that currently do nothing look broken. Saying so costs one line
      // and is the difference between "this setting is dead" and "I turned this
      // off myself a minute ago".
      ...(S.lowPerf ? [el('div', { class: 'hint', style: { lineHeight: 1.55 } },
        t('Low performance mode is on, so these are not in effect right now.'))] : []),
      row(t('Backdrop blur'), slider('blur', 0, 40, 1)),
      row(t('Saturation'), slider('saturation', 100, 300, 5)),
      row(t('Brightness'), slider('brightness', 80, 140, 1)),
      row(t('Tint opacity'), slider('tintAlpha', 0, 40, 1)),
      row(t('Edge light'), slider('edgeAlpha', 0, 100, 1)),
      row(t('Corner radius'), slider('radius', 0, 48, 1)),
      row(t('Refraction'), slider('refract', 0, 120, 1),
        'Bends the backdrop near panel edges. 0 turns it off for a flatter, faster look.'),
      row(t('Pointer sheen'), toggle('sheen')),
    ),
    group(t('Presets'),
      el('div', { class: 'chips' },
        preset('Signature', { blur: 18, saturation: 180, brightness: 108, tintAlpha: 10, edgeAlpha: 55, radius: 26, refract: 42 }),
        preset('Frosted', { blur: 34, saturation: 130, brightness: 104, tintAlpha: 22, edgeAlpha: 40, radius: 22, refract: 8 }),
        preset('Thick lens', { blur: 10, saturation: 220, brightness: 112, tintAlpha: 6, edgeAlpha: 80, radius: 34, refract: 96 }),
        preset('Barely there', { blur: 8, saturation: 140, brightness: 102, tintAlpha: 4, edgeAlpha: 30, radius: 20, refract: 16 }),
        preset('Solid', { blur: 0, saturation: 100, brightness: 100, tintAlpha: 38, edgeAlpha: 20, radius: 18, refract: 0 }),
      )),
  ],

  dock: () => [
    group(t('Bookmark dock'),
      row(t('Position'), select('dockEdge', {
        bottom: t('Bottom'), top: t('Top'), left: t('Left'), right: t('Right'),
      }, () => { applyDockSettings(); window.dispatchEvent(new Event('lgt:rescale')); })),
      row(t('Icon size'), slider('dockSize', 34, 84, 1)),
      row(t('Icon spacing'), slider('dockGap', 0, 22, 1)),
      row(t('Hover effect'), select('dockHover', {
        magnify: 'Magnify (macOS dock)',
        lift:    'Lift up',
        pop:     'Pop & hold',
        bounce:  'Bounce',
        wiggle:  'Wiggle',
        jelly:   'Jelly (squash & stretch)',
        none:    'None',
      }, applyDockSettings),
        'Pop & hold stays raised while you’re on an icon and drops the moment '
        + 'you leave. Jelly wobbles only the icon you point at; the rest ripple '
        + 'out to their neighbours.'),
      row(t('Hover scale'), slider('dockMagnify', 1, 2.4, 0.05),
        'Used by Magnify and Pop & hold.'),
      row(t('Icon quality'), select('iconSource', {
        auto: 'Auto — sharpen when blurry',
        chrome: 'Chrome only (never leaves PC)',
        sharp: 'Always high-res',
      }, async () => { await dropCache('icon:'); renderDock(); }),
        'Chrome usually stores icons at 16px, which look blurry at dock size. '
        + 'Auto fetches a sharper icon from Google/DuckDuckGo only when Chrome’s is too small.'),
      row(t('Icon vibrancy'), slider('dockVibrancy', 100, 220, 5),
        'Boosts saturation on favicons so brand colours read at dock size.'),
      row(t('Icon contrast'), slider('dockContrast', 90, 150, 2)),
      row(t('Show labels on hover'), toggle('dockLabels')),
      row(t('Auto-hide until hover'), toggle('dockAutohide', applyDockSettings)),
      row(t('Max items'), number('dockMaxItems', 4, 60, renderDock)),
      row(t('Append top sites'), toggle('dockShowTopSites', renderDock)),
    ),
    group(t('Source folder'), folderPicker()),
    group(t('Bulk import'), ...bulkImportControls()),
  ],

  widgets: () => [
    group(t('Enabled widgets'), ...Object.entries(WIDGET_META).map(([id, label]) => {
      const sw = el('div', { class: 'switch' + (S.widgets[id]?.on ? ' on' : '') }, el('i'));
      sw.addEventListener('click', async () => {
        sw.classList.toggle('on');
        await setWidget(id, { on: sw.classList.contains('on') });
        rebuild();
      });
      // Size is not here on purpose: it belongs to the grip in edit mode, where
      // you can see the widget you are sizing.
      //
      // Slightly larger label than a normal settings row. These rows hold only
      // a name and a toggle pinned to the right edge, so at the default size
      // the two sit a long way apart with nothing between them.
      const r = row(t(label), sw);
      r.classList.add('wtoggle');
      return r;
    })),
    group(t('Layout'),
      row(t('Shrink to fit'), (() => {
        const sw = el('div', { class: 'switch' + (S.widgetScaleMode === 'window' ? ' on' : ''), role: 'switch' }, el('i'));
        sw.addEventListener('click', async () => {
          sw.classList.toggle('on');
          await set({ widgetScaleMode: sw.classList.contains('on') ? 'window' : 'fixed' });
          // Sizes are re-applied from the live panels rather than by rebuilding,
          // for the same reason the size slider does it that way.
          window.dispatchEvent(new Event('lgt:rescale'));
        });
        return sw;
      })(), 'Scales every widget down together when the window is too small for them. Never scales up.'),
      row(t('Edit mode'), (() => {
        const b = el('button', { class: 'btn', text: 'Toggle drag mode',
          onclick: () => window.dispatchEvent(new Event('lgt:edit')) });
        return b;
      })(), 'Drag panels anywhere. Press E to toggle.'),
      row(t('Reset positions and sizes'), el('button', {
        class: 'btn danger', text: t('Reset layout'),
        onclick: async () => {
          // anchor and placed have to go back too. Resetting only x/y left a
          // dragged panel with anchor:null, so a centre-anchored default like
          // the clock came back half its width off-centre, and `placed` kept
          // it exempt from the dock reserve it should have again.
          for (const [id, w] of Object.entries(DEFAULTS.widgets)) {
            await setWidget(id, {
              x: w.x, y: w.y, anchor: w.anchor ?? null, placed: false,
              size: WIDGET_SIZE.default,
              // The viewport a drag was recorded in has to go as well. Left
              // behind, a widget restored to its default position still
              // resolves that position against the window it was last dragged
              // in — so "Reset layout" put every widget you had ever moved
              // somewhere that was neither where you left it nor the default.
              vw: undefined, vh: undefined,
            });
          }
          rebuild(); toast(t('Layout reset'));
        },
      })),
    ),
  ],

  arcade: () => [arcadeGroup()],

  weather: () => {
    const results = el('div', { style: { marginTop: '6px' } });
    const input = el('input', { type: 'text', placeholder: 'City name…', style: { maxWidth: '100%', width: '100%' } });
    // Enter can be pressed again before the first lookup returns, and the two
    // do not come back in order. Without this the earlier city's matches can
    // land under the later city's name.
    let lookups = 0;
    input.addEventListener('keydown', async e => {
      if (e.key !== 'Enter' || !input.value.trim()) return;
      const mine = ++lookups;
      results.innerHTML = '<div class="hint">Searching…</div>';
      try {
        const places = await searchPlaces(input.value.trim());
        if (mine !== lookups) return;
        results.innerHTML = '';
        if (!places.length) { results.innerHTML = '<div class="hint">No matches.</div>'; return; }
        for (const p of places) {
          results.append(el('button', {
            class: 'btn', style: { display: 'block', width: '100%', textAlign: 'left', marginBottom: '4px' },
            text: `${p.name} — ${p.country}`,
            onclick: async () => {
              await set({ place: p });
              await dropCache('wx:');
              toast(`Weather set to ${p.name}`);
              window.dispatchEvent(new Event('lgt:reload'));
              draw();
            },
          }));
        }
      } catch { results.innerHTML = '<div class="hint">Search failed.</div>'; }
    });

    return [
      group(t('Location'),
        // Masked here too, or opening settings during a screen share would
        // undo the point of hiding it on the new tab. Click to reveal.
        row('Current', (() => {
          if (!S.place) return el('span', { class: 'faint', style: { fontSize: '12px' }, text: 'not set' });
          const full = `${S.place.name}${S.place.country ? ', ' + S.place.country : ''}`;
          if (S.weatherPrivacy === 'full') {
            return el('span', { class: 'faint', style: { fontSize: '12px' }, text: full });
          }
          const shown = S.weatherPrivacy === 'country'
            ? (S.place.country || '').split(',').pop().trim() || '•••• hidden'
            : '•••• hidden';
          const span = el('span', { class: 'faint', style: { fontSize: '12px', cursor: 'pointer' },
            title: 'Click to reveal', text: shown });
          span.addEventListener('click', () => { span.textContent = full; span.style.cursor = ''; });
          return span;
        })()),
        input, results,
        row('Detect from IP', el('button', {
          class: 'btn', text: t('Detect'),
          onclick: async () => {
            const p = await detectPlace();
            if (!p) return toast('Detection failed — enter a city instead.');
            await set({ place: p }); await dropCache('wx:');
            toast(`Detected ${p.name}`); window.dispatchEvent(new Event('lgt:reload')); draw();
          },
        }), 'Uses a public IP-geolocation service. Roughly city-accurate.'),
      ),
      group(t('Privacy'),
        row(t('Show location'), select('weatherPrivacy', {
          full: 'City and country',
          country: 'Country only',
          hidden: 'Don’t show it',
        }, () => { rebuild(); draw(); })),
        el('div', { class: 'hint', style: { lineHeight: 1.6 } },
          'Controls what appears on the new tab — useful when screen sharing. '
          + 'The weather API still needs your coordinates to return a forecast, '
          + 'so this hides the location from view rather than from the request.'),
      ),
      group(t('Units'),
        row(t('Temperature'), select('temperatureUnit', { celsius: t('Celsius'), fahrenheit: t('Fahrenheit') },
          async () => { await dropCache('wx:'); window.dispatchEvent(new Event('lgt:reload')); })),
        row(t('Wind'), select('windUnit', { kmh: 'km/h', mph: 'mph', ms: 'm/s', kn: 'knots' },
          async () => { await dropCache('wx:'); window.dispatchEvent(new Event('lgt:reload')); })),
      ),
    ];
  },

  news: () => {
    const list = el('div');
    const drawFeeds = () => {
      list.innerHTML = '';
      S.feeds.forEach((f, i) => {
        const sw = el('div', { class: 'switch' + (f.on ? ' on' : '') }, el('i'));
        sw.addEventListener('click', async () => {
          sw.classList.toggle('on');
          const feeds = structuredClone(S.feeds);
          feeds[i].on = sw.classList.contains('on');
          await set({ feeds });
          window.dispatchEvent(new Event('lgt:reload'));
        });
        const del = el('button', {
          class: 'icon-btn', text: '✕', title: t('Remove'),
          onclick: async () => {
            const feeds = S.feeds.filter((_, j) => j !== i);
            await set({ feeds }); drawFeeds(); window.dispatchEvent(new Event('lgt:reload'));
          },
        });
        list.append(el('div', { class: 'set-row' },
          el('label', {}, el('span', { text: f.name }), el('span', { class: 'hint', text: f.url })),
          sw, del));
      });
    };
    drawFeeds();

    const nameI = el('input', { type: 'text', placeholder: t('Name') });
    const urlI = el('input', { type: 'text', placeholder: 'https://example.com/feed.xml' });

    return [
      group(t('Feeds'), list),
      group(t('Add a feed'),
        row(t('Name'), nameI), row('RSS / Atom URL', urlI),
        row('', el('button', {
          class: 'btn primary', text: t('Add feed'),
          onclick: async () => {
            const url = urlI.value.trim(), name = nameI.value.trim() || 'Custom';
            if (!/^https?:\/\//.test(url)) return toast(t('Enter a full http(s) URL'));
            // Custom hosts need permission granted at runtime.
            const granted = await chrome.permissions.request({ origins: [new URL(url).origin + '/*'] });
            if (!granted) return toast('Permission denied for that host');
            const feeds = [...S.feeds, { id: 'c' + Date.now(), name, url, on: true }];
            await set({ feeds });
            nameI.value = urlI.value = '';
            drawFeeds();
            window.dispatchEvent(new Event('lgt:reload'));
            toast(t('Feed added'));
          },
        })),
      ),
      group(t('Display'), row(t('Headlines shown'), number('newsCount', 3, 40, () => window.dispatchEvent(new Event('lgt:reload'))))),
    ];
  },

  music: () => {
    const uri = sp.redirectURI();
    const status = el('span', { class: 'faint', style: { fontSize: '12px' }, text: 'checking…' });
    sp.isConnected().then(c => { status.textContent = c ? 'connected' : 'not connected'; });

    return [
      group(t('Spotify setup'),
        el('div', { class: 'hint', style: { lineHeight: 1.6, marginBottom: '8px' } },
          '1. Create an app on the Spotify dashboard  ·  2. Paste its Client ID below  ·  '
          + '3. Add this exact Redirect URI to the app  ·  4. Click Connect.'),
        // A button rather than a bare URL in the text. The dashboard address was
        // written out for people to retype into the address bar, which is a
        // silly thing to ask when the page can just open it.
        el('div', { class: 'row', style: { marginBottom: '10px' } },
          el('button', { class: 'btn', text: 'Open Spotify dashboard ↗',
            onclick: () => openTab('https://developer.spotify.com/dashboard') })),
        row(t('Redirect URI'), ''),
        el('div', { class: 'code', text: uri }),
        el('button', { class: 'btn', style: { marginTop: '6px' }, text: t('Copy redirect URI'),
          onclick: () => navigator.clipboard.writeText(uri)
            .then(() => toast(t('Copied')))
            // Clipboard writes are refused when the document is not focused,
            // which happens if the click lands while another window has focus.
            // Silently doing nothing looks like a broken button.
            .catch(() => toast('Could not copy — select the URI above instead')) }),
        row(t('Client ID'), text('spotifyClientId', 'e.g. 3f9a…')),
        row(t('Status'), status),
        el('div', { class: 'row', style: { marginTop: '8px' } },
          el('button', {
            class: 'btn primary', text: t('Connect Spotify'),
            onclick: async () => {
              try { await sp.connect(); toast('Connected'); status.textContent = 'connected'; rebuild(); }
              catch (e) { toast(e.message); }
            },
          }),
          el('button', {
            class: 'btn danger', text: t('Disconnect'),
            onclick: async () => { await sp.disconnect(); status.textContent = 'not connected'; toast('Disconnected'); rebuild(); },
          })),
      ),
      group(t('Visualizer audio'), ...vizSourceControls(),
        row('Sensitivity', slider('vizSensitivity', 20, 250, 5),
          'Lower this if the bars sit pinned at full height. Only affects captured audio.'),
        row('Vocal emphasis', slider('vizVocal', 0, 100, 5),
          'Lifts the 300 Hz–5 kHz range where voices sit, and reacts to sudden '
          + 'changes, so words and syllables spike instead of only the beat. '
          + '0 = raw spectrum (bass dominates).'),
        // row() drops its third argument (subtitles were retired), so anything
        // that has to be on screen needs its own .hint element.
        row('Assumed BPM', slider('vizBpm', 60, 200, 1)),
        el('div', { class: 'hint', style: { marginTop: '-2px', lineHeight: 1.55 } },
          'Simulated source only — it has no audio to measure, so it animates '
          + 'to this tempo. Ignored by Microphone, Tab audio and System audio, '
          + 'which use the real beat.'),
      ),
      group(t('Visualizer style'),
        row('Shape', select('vizMode', { bars: 'Bars', radial: 'Radial' })),
        row('Split beat & vocals', toggle('vizSplit'),
          'Beat sits in the centre and vocals spread to the flanks. During a '
          + 'drums-only passage the beat expands to fill the whole bar, then '
          + 'gives ground back when the vocals return. Bars shape only.'),
      ),
      group(t('Lyrics'),
        row('Timing offset (ms)', number('lyricsOffset', -5000, 5000),
          'Negative shows lines earlier. Lyrics come from LRCLIB, a free community database.'),
      ),
    ];
  },

  data: () => [
    group(t('World clocks'),
      ...S.worldClocks.map((z, i) => row(z.label, el('button', {
        class: 'icon-btn', text: '✕',
        onclick: async () => {
          await set({ worldClocks: S.worldClocks.filter((_, j) => j !== i) }); draw(); rebuild();
        },
      }), z.tz)),
      (() => {
        const l = el('input', { type: 'text', placeholder: 'Label' });
        // Not `t`: this file imports t() from i18n, and a local of that name
        // shadows it. t('Add clock') below then called this <input>, which
        // threw while the Data tab was being built and left the tab blank.
        const tz = el('input', { type: 'text', placeholder: 'Area/City (IANA)' });
        return el('div', {},
          row('Label', l), row('Time zone', tz),
          row('', el('button', {
            class: 'btn', text: t('Add clock'),
            onclick: async () => {
              if (!l.value.trim() || !tz.value.trim()) return toast('Fill both fields');
              try { new Date().toLocaleString(undefined, { timeZone: tz.value.trim() }); }
              catch { return toast('Unknown time zone'); }
              await set({ worldClocks: [...S.worldClocks, { label: l.value.trim(), tz: tz.value.trim() }] });
              draw(); rebuild();
            },
          })));
      })()),
    group(t('Countdown'),
      row('Counting to', select('countdownMode', { holiday: 'A holiday', custom: 'A custom date' },
        () => { rebuild(); draw(); })),
      ...(S.countdownMode === 'custom' ? [
        row('Date', (() => {
          const i = el('input', { type: 'date', value: S.countdownDate || '' });
          i.addEventListener('change', async () => { await set({ countdownDate: i.value }); rebuild(); });
          return i;
        })()),
        row('Label', text('countdownLabel', 'e.g. my birthday', rebuild)),
      ] : [
        row('Holiday', select('countdownHoliday',
          Object.fromEntries(Object.entries(HOLIDAYS).map(([id, h]) => [id, h.name])), rebuild)),
      ]),
      row('Next', el('span', { class: 'faint', style: { fontSize: '12px' }, text: (() => {
        const next = countdownTarget();
        return next ? next.date.toLocaleDateString(undefined,
          { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }) : 'not set';
      })() }))),
    group(t('Calendar'),
      row(t('Week starts on'), select('weekStart', {
        auto: 'Automatic', sun: 'Sunday', mon: 'Monday',
      }, rebuild), 'Automatic follows the language the interface is set to.')),
    group(t('Crypto'),
      row('CoinGecko IDs', text('coins', 'bitcoin,ethereum,solana', rebuild), 'Comma separated, lowercase.')),
    group(t('Backup'),
      el('div', { class: 'row' },
        el('button', {
          class: 'btn', text: t('Export settings'),
          onclick: () => {
            const blob = new Blob([exportSettings()], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = el('a', { href: url, download: 'cgt-settings.json' });
            a.click();
            // Revoking in the same turn can cancel the download before it has
            // started reading the blob.
            setTimeout(() => URL.revokeObjectURL(url), 30e3);
            toast('Exported');
          },
        }),
        el('button', {
          class: 'btn', text: t('Import…'),
          onclick: () => {
            const f = el('input', { type: 'file', accept: 'application/json' });
            f.addEventListener('change', async () => {
              try {
                await importSettings(await f.files[0].text());
                applyTheme(); applyDockSettings(); renderDock(); rebuild(); draw();
                toast(t('Settings imported'));
              } catch (e) { toast('Import failed: ' + e.message); }
            });
            f.click();
          },
        })),
      row('Clear cached data', el('button', {
        class: 'btn', text: t('Clear cache'),
        onclick: async () => { await dropCache(); window.dispatchEvent(new Event('lgt:reload')); toast(t('Cache cleared')); },
      }), 'Weather, news, crypto and lyrics are cached locally.'),
      row('Reset everything', el('button', {
        class: 'btn danger', text: t('Factory reset'),
        onclick: async () => {
          if (!confirm('Reset every setting to defaults? Notes and tasks are kept.')) return;
          // The wallpaper blobs are not part of settings, so a reset would
          // otherwise strand them in IndexedDB with nothing pointing at them.
          await Promise.all([
            delBlob(WALLPAPER_IMAGE_KEY).catch(() => {}),
            delBlob(WALLPAPER_VIDEO_KEY).catch(() => {}),
          ]);
          await resetAll(); applyTheme(); applyDockSettings(); renderDock(); rebuild(); draw();
          toast('Reset complete');
        },
      })),
    ),
    group('About',
      el('div', { class: 'hint', style: { lineHeight: 1.6, marginBottom: '10px' } },
        `CGT — Customizable Glass Tab v${chrome.runtime.getManifest?.().version ?? ''} — free, no ads, `
        + 'no analytics, and no server of its own. Supporting it is entirely '
        + 'optional and changes nothing about how it works.'),
      // rel is not optional alongside target=_blank: without noopener the
      // opened page gets a handle back to this one through window.opener.
      el('a', {
        class: 'btn', href: 'https://www.patreon.com/cw/CEASEprod',
        target: '_blank', rel: 'noopener noreferrer',
        text: 'Support on Patreon',
      }),
    ),
  ],

  keys: () => [
    group(t('Shortcuts'),
      ...ACTIONS.map(a => row(t(a.label), keyBinder(a))),
      el('div', { class: 'hint', style: { lineHeight: 1.55 } },
        'Click a shortcut, then press the keys you want. Escape leaves it '
        + 'alone. ✕ unbinds it, ↺ puts the default back, and a shortcut showing '
        + '— has no key: it does nothing until you give it one.'),
      el('div', { class: 'hint', style: { lineHeight: 1.55 } },
        'A shortcut without Ctrl or Alt is ignored while you are typing in a '
        + 'box, so a plain letter cannot fire mid-sentence. Escape, Tab, Enter, '
        + 'Space and the arrow keys are not available — they already move focus '
        + 'and work the dock, and taking one would leave no way back.'),
      row('', el('button', {
        class: 'btn', text: t('Reset shortcuts'),
        onclick: async () => { await set({ keys: {} }); draw(); toast(t('Shortcuts reset')); },
      })),
    ),
    group(t('Bookmark shortcuts'),
      bookmarkShortcuts(),
      el('div', { class: 'hint', style: { lineHeight: 1.55 } },
        'Put any bookmark on a key. Give it a modifier — Ctrl or Alt — unless you '
        + 'want it to fire from a bare letter, which will not work while you are '
        + 'typing in a box. ✕ removes the row.'),
      el('div', { class: 'hint', style: { lineHeight: 1.55 } },
        'The address is remembered rather than the bookmark itself, so renaming '
        + 'or moving it in Chrome does not break the shortcut — but deleting the '
        + 'bookmark leaves the shortcut working on the old address.'),
    ),
  ],
};

/* ---------- visualizer audio source ----------
   Capture needs a user gesture, so these are real buttons rather than a
   <select>. Each returns whether it actually got a stream. */
function vizSourceControls() {
  const chips = el('div', { class: 'chips' });
  const status = el('div', {
    class: 'hint',
    style: { marginTop: '2px', color: audio.live ? 'var(--accent)' : '' },
    text: audio.error ? 'Last attempt failed: ' + audio.error
      : audio.live ? `Live — ${audio.label}`
      : 'Simulated — not real audio analysis',
  });

  const chip = (id, label, run) => el('button', {
    class: 'pill' + (audio.mode === id ? ' on' : ''),
    text: label,
    onclick: async () => {
      const ok = await run();
      if (ok) await set({ vizSource: id });
      if (audio.error) toast(audio.error);
      draw();
    },
  });

  chips.append(
    chip('sim', 'Simulated', async () => { audio.useSim(); return true; }),
    chip('mic', 'Microphone', () => audio.useMic()),
    chip('system', 'System audio', () => audio.useSystem()),
  );

  const rows = [
    row('Source', chips),
    status,
    el('div', { class: 'hint', style: { marginTop: '8px', lineHeight: 1.55 } },
      el('b', { text: 'System audio' }),
      ' is the one that works with Spotify. It captures at the OS mixer, so DRM '
      + 'does not block it and it hears the desktop app too. Pick ',
      el('b', { text: 'Entire Screen' }),
      ' in the dialog and tick ', el('b', { text: 'Also share system audio' }), '.'),
  ];

  // Tab capture: list whatever is currently making noise.
  const tabList = el('div', { style: { marginTop: '8px' } });
  rows.push(tabList);
  (async () => {
    let tabs = [];
    try {
      tabs = (await chrome.tabs.query({ audible: true })).filter(x => /^https?:/.test(x.url || ''));
    } catch { /* no tabs permission in preview */ }
    if (!tabs.length) {
      tabList.append(el('div', { class: 'hint', text: 'Tab audio: no tab is playing sound right now.' }));
      return;
    }
    tabList.append(el('div', { class: 'hint', style: { marginBottom: '5px' }, text: 'Or capture a tab that’s playing:' }));
    for (const tab of tabs) {
      tabList.append(el('button', {
        class: 'btn',
        style: { display: 'block', width: '100%', textAlign: 'left', marginBottom: '4px' },
        text: '▶ ' + (tab.title || tab.url).slice(0, 46),
        title: tab.url,
        onclick: async () => {
          // tabCapture needs access to that tab; ask for just its origin.
          try {
            const origin = new URL(tab.url).origin + '/*';
            const has = await chrome.permissions.contains({ origins: [origin] });
            if (!has && !(await chrome.permissions.request({ origins: [origin] }))) {
              return toast('Permission denied for that site.');
            }
          } catch { /* fall through and let getMediaStreamId report */ }

          const res = await chrome.runtime.sendMessage({ type: 'lgt:tabStreamId', targetTabId: tab.id });
          if (!res?.streamId) {
            toast('Tab capture failed: ' + (res?.error || 'no stream id') + ' — try System audio.');
            return draw();
          }
          const ok = await audio.useTab(res.streamId, tab.title || 'Tab audio');
          if (ok) await set({ vizSource: 'tab' });
          else toast(audio.error || 'Could not capture that tab.');
          draw();
        },
      }));
    }
  })();

  return rows;
}

function preset(name, values) {
  return el('button', {
    class: 'pill', text: name,
    onclick: async () => { await set(values); applyTheme(); draw(); },
  });
}

/* ---------- bulk import ----------
   Two ways in, one outcome: everything lands in the folder that feeds the dock
   for the homescreen you are on. That is stated in the UI rather than left to
   be discovered, because it is the one thing about this that can surprise you —
   the folder is per-homescreen, so importing on the wrong one puts a few
   hundred bookmarks somewhere you were not looking. */
function bulkImportControls() {
  const status = el('div', { class: 'hint', style: { lineHeight: 1.55 } });

  /** One sentence for whatever just happened. Counts rather than a bare
   *  "Done", because "added 0, skipped 412" and "added 412" are the same
   *  screen otherwise, and the first one needs explaining. */
  const report = r => {
    const bits = [`Added ${r.added}`];
    if (r.skipped) bits.push(`${r.skipped} already there`);
    if (r.failed) bits.push(`${r.failed} rejected`);
    if (r.overflow) bits.push(`${r.overflow} over the ${IMPORT_CAP} limit, not imported`);
    let msg = bits.join(' · ') + '.';
    // The dock truncates at dockMaxItems and says nothing about it, so an
    // import of 300 into a dock showing 24 looks like it mostly failed.
    const cap = S.dockMaxItems || 24;
    if (r.added && r.shown >= cap) {
      msg += ` The dock is showing ${cap} of them — raise “Max items” above to see more.`;
    }
    status.textContent = msg;
    toast(`Added ${r.added} bookmark${r.added === 1 ? '' : 's'}`);
    renderDock();
  };

  const busy = msg => { status.textContent = msg; };

  const fileBtn = el('button', {
    class: 'btn', text: t('Choose bookmarks file…'),
    onclick: () => {
      const f = el('input', { type: 'file', accept: '.html,.htm,text/html' });
      f.addEventListener('change', async () => {
        const file = f.files[0];
        if (!file) return;
        // A bookmarks export is text. Anything of this size is not one, and
        // reading it would just be a way to run the tab out of memory.
        if (file.size > 20e6) { status.textContent = 'That file is over 20 MB — it is probably not a bookmarks export.'; return; }
        busy('Reading…');
        try {
          const entries = parseBookmarksFile(await file.text());
          if (!entries.length) {
            status.textContent = 'No links found in that file. It should be the HTML file a browser exports, not a folder or a .json.';
            return;
          }
          busy(`Importing ${Math.min(entries.length, IMPORT_CAP)}…`);
          report(await importBookmarks(entries, (done, total) => busy(`Importing ${done} of ${total}…`)));
        } catch (e) {
          status.textContent = 'Could not read that file: ' + e.message;
        }
      });
      f.click();
    },
  });

  const box = el('textarea', {
    class: 'dp-field bulk-paste', rows: 4, spellcheck: 'false',
    placeholder: 'One link per line\ngithub.com\nhttps://news.ycombinator.com',
  });

  const pasteBtn = el('button', {
    class: 'btn', text: t('Add pasted links'),
    onclick: async () => {
      const { entries, invalid } = parseLinkList(box.value);
      if (!entries.length) {
        status.textContent = invalid
          ? `None of those ${invalid} lines look like links.`
          : 'Paste some links first.';
        return;
      }
      busy(`Importing ${entries.length}…`);
      const r = await importBookmarks(entries, (done, total) => busy(`Importing ${done} of ${total}…`));
      box.value = '';
      report({ ...r, failed: r.failed + invalid });
    },
  });

  return [
    el('div', { class: 'hint', style: { lineHeight: 1.55, marginBottom: '8px' } },
      'Adds to the dock folder for ',
      el('b', { text: activeSpace()?.name || 'this homescreen' }),
      '. Links already in it are skipped, so running the same import twice is safe. '
      + 'Folders in the file are flattened — the dock is one row.'),
    row(t('Bookmarks file'), fileBtn),
    box,
    el('div', { class: 'row', style: { marginTop: '6px' } }, pasteBtn),
    status,
  ];
}

function folderPicker() {
  const wrap = el('div');
  chrome.bookmarks.getTree().then(([root]) => {
    const opts = {};
    (function walk(nodes, depth) {
      for (const n of nodes) {
        if (n.url) continue;
        if (n.id !== '0') opts[n.id] = '  '.repeat(depth) + (n.title || 'Folder');
        if (n.children) walk(n.children, depth + 1);
      }
    })(root.children || [], 0);
    const current = activeFolder();
    const s = el('select', { style: { maxWidth: '100%' } }, ...Object.entries(opts).map(([v, l]) =>
      el('option', { value: v, selected: current === v }, l)));
    s.addEventListener('change', async () => {
      // Folders belong to homescreens now, so repoint the active one.
      const active = activeSpace();
      if (active) {
        const spaces = spaceList().map(sp => (sp.id === active.id ? { ...sp, folderId: s.value } : sp));
        await set({ spaces, dockFolder: s.value });
      } else {
        await set({ dockFolder: s.value });
      }
      renderDock();
    });
    wrap.append(row(t('Folder'), s,
      `Which bookmark folder fills the dock for “${activeSpace()?.name || 'this homescreen'}”.`));
  });
  return wrap;
}

/* ---------- search ----------
   Eight tabs is enough that "which tab is the blur slider on" is a real
   question, so the search deliberately spans all of them rather than filtering
   the one you happen to be looking at — filtering the visible tab would only
   help once you had already found the right tab, which is the hard part.

   It matches against rendered text rather than a hand-written index of setting
   names. An index would be faster and would drift the first time somebody adds
   a row without remembering to list it; PANELS is the only description of what
   a tab contains, so the search reads that. It also means the text of a
   control counts: "fahrenheit" finds Units, because the option is in the DOM.

   The cost is that every panel is built to be searched, and a few of them have
   side effects — folderPicker reads the bookmark tree, the visualiser lists
   audible tabs, Spotify checks for a stored token. All are local calls, and the
   input is debounced, so a burst of typing builds once rather than per key. */
const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Which tab a group came from, as a heading that jumps back to it. */
function crumb(tabId, tabLabel, title) {
  return el('h3', {}, el('button', {
    class: 'set-crumb', type: 'button', title: t('Go to {tab}', { tab: t(tabLabel) }),
    onclick: () => { activeTab = tabId; resetSearch(); },
  },
    el('span', { class: 'crumb-tab', text: t(tabLabel) }),
    el('span', { class: 'crumb-sep', text: '›' }),
    el('span', { text: t(title) }),
  ));
}

/** Every tab, built and then cut down to the rows that match. */
function searchResults(q) {
  const needle = norm(q);
  const out = [];

  for (const [tabId, tabLabel] of Object.entries(TABS)) {
    let groups;
    // One broken panel must not take the whole search down with it — the same
    // reasoning as the per-widget try/catch in app.js.
    try { groups = PANELS[tabId](); }
    catch (e) { console.error('[cgt] settings search', tabId, e); continue; }

    for (const g of groups) {
      if (!(g instanceof HTMLElement)) continue;          // panels may hold falsy entries
      const title = g.querySelector(':scope > h3')?.textContent || '';
      // A group whose own name matches keeps everything in it. Searching
      // "backup" should show the whole Backup group, not the one button inside
      // it whose label happens to repeat the word.
      //
      // The tab name counts too, and that is not cosmetic: without it
      // "weather" returned the Privacy group alone, because the rows that
      // actually configure the weather are called Location and Units and none
      // of them says the word. Searching for the name on the tab should hand
      // back the tab.
      const whole = norm(tabLabel).includes(needle) || norm(title).includes(needle);
      const keep = [...g.children].filter(c =>
        c.tagName !== 'H3' && (whole || norm(c.textContent).includes(needle)));
      if (!keep.length) continue;
      // Appending moves the nodes out of `g`, which is then discarded. They are
      // the live controls with their listeners already attached, so the results
      // are not copies — editing one here is editing the real setting.
      out.push(el('div', { class: 'set-group' }, crumb(tabId, tabLabel, title), ...keep));
    }
  }

  if (!out.length) {
    out.push(el('div', { class: 'hint', style: { lineHeight: 1.6 } },
      t('Nothing matches “{q}”.', { q })));
  }
  return out;
}

function resetSearch() {
  const input = $('#settings-search-input');
  if (input) input.value = '';
  query = '';
  syncClear();
  draw();
}

function syncClear() {
  const btn = $('#settings-search-clear');
  if (btn) btn.hidden = !query;
}

/* ---------- shell ---------- */
function draw() {
  const tabs = $('#settings-tabs'), body = $('#settings-body');
  // The tab strip is meaningless while a search spans all of them, and leaving
  // one pill lit would suggest the results came from that tab alone.
  tabs.hidden = !!query;
  tabs.innerHTML = '';
  if (!query) {
    for (const [id, label] of Object.entries(TABS)) {
      tabs.append(el('button', {
        // Translated here, not in TABS: that table is built at module load,
        // long before a catalogue exists.
        class: activeTab === id ? 'on' : '', text: t(label),
        onclick: () => { activeTab = id; draw(); },
      }));
    }
  }
  body.innerHTML = '';
  body.append(...(query ? searchResults(query) : PANELS[activeTab]()));
}

/** Drag the panel by its header. Switches from the default right/bottom
 *  anchoring to explicit left/top the first time it moves. */
function initSettingsDrag(panel) {
  const header = panel.querySelector('header');

  // Only a position, never a size. `h` is still read out of older entries by
  // sanitize but nothing applies it any more — see applyPos.
  const valid = p => p && Number.isFinite(p.y)
    && (Number.isFinite(p.x) || Number.isFinite(p.fx));

  /** The horizontal position is stored as a RATIO of the free space, not as a
   *  pixel column: 0 is flush left, 1 is flush right.
   *
   *  It used to be an absolute x, which is fine until the window changes width.
   *  The panel defaults to `right: 14px`, so a user who nudged it to the right
   *  edge at 1280px got x≈870 written down — and at 1920px, which is what F11
   *  fullscreen gives you, that column is nowhere near the right edge and the
   *  panel appears stranded towards the middle-left. A ratio keeps a
   *  right-docked panel docked right at every width. */
  const ratioOf = p => {
    if (Number.isFinite(p.fx)) return clamp(p.fx, 0, 1);
    const span = Math.max(1, innerWidth - (panel.offsetWidth || 396));
    return clamp(p.x / span, 0, 1);            // migrate a legacy absolute x
  };

  const applyPos = () => {
    const p = S.settingsPos;
    if (!valid(p)) return;
    const w = panel.offsetWidth || 396;
    const span = Math.max(1, innerWidth - w);
    panel.classList.add('dragged');
    panel.style.right = 'auto';
    // Height and bottom are deliberately left to the stylesheet, which pins
    // both edges (top:14 / bottom:14) so the panel spans the screen. This used
    // to set bottom:auto and an explicit height taken from the drag, and there
    // is no resize handle — so that height was only ever "whatever it happened
    // to be when you last moved it", frozen for good. On a taller screen, and
    // most obviously in fullscreen, the panel then stopped short of the bottom.
    panel.style.bottom = '';
    panel.style.height = '';
    panel.style.left = Math.round(ratioOf(p) * span) + 'px';
    panel.style.top = clamp(p.y, 8, Math.max(8, innerHeight - 60)) + 'px';
  };

  /** Give the panel back to the stylesheet, which docks it top-right. */
  const unpin = () => {
    panel.classList.remove('dragged');
    for (const k of ['right', 'bottom', 'height', 'left', 'top']) panel.style[k] = '';
  };

  if (valid(S.settingsPos)) applyPos();
  else if (S.settingsPos) set({ settingsPos: null });

  header.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;              // let the close button work
    const r = panel.getBoundingClientRect();
    if (r.height < 120) return;                          // panel isn't actually open
    e.preventDefault();
    const offX = e.clientX - r.left, offY = e.clientY - r.top;
    const wasPinned = valid(S.settingsPos);
    let moved = false;

    // Switch to absolute positioning so the panel can be dragged at all. This
    // is NOT persisted until the pointer actually moves — it used to be written
    // on every pointerup, so one stray click on the header silently converted
    // the panel from "docked to the right edge" to "pinned to this pixel
    // column" for good, and nothing about clicking a header suggests that.
    panel.classList.add('dragged');
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.height = r.height + 'px';
    panel.style.left = r.left + 'px';
    panel.style.top = r.top + 'px';

    // Must not be able to abort the handler before the move/up listeners are
    // attached, or a failed capture leaves the drag permanently dead.
    try { header.setPointerCapture(e.pointerId); } catch {}

    const move = ev => {
      if (Math.abs(ev.clientX - e.clientX) > 3 || Math.abs(ev.clientY - e.clientY) > 3) moved = true;
      const x = clamp(ev.clientX - offX, 8 - r.width * 0.6, innerWidth - r.width * 0.4);
      const y = clamp(ev.clientY - offY, 8, innerHeight - 60);
      panel.style.left = x + 'px';
      panel.style.top = y + 'px';
    };
    const up = async () => {
      header.removeEventListener('pointermove', move);
      header.removeEventListener('pointerup', up);
      header.removeEventListener('pointercancel', up);
      // The height was frozen on pointerdown so the panel would not resize
      // under the cursor mid-drag. Hand it back to the stylesheet now.
      panel.style.height = '';
      panel.style.bottom = '';
      if (!moved) {
        // A click, not a drag. Leave the stored position exactly as it was —
        // and if there wasn't one, hand the panel back to the stylesheet.
        if (wasPinned) applyPos(); else unpin();
        return;
      }
      const span = Math.max(1, innerWidth - panel.offsetWidth);
      await set({ settingsPos: {
        fx: clamp(parseFloat(panel.style.left) / span, 0, 1),
        y: parseFloat(panel.style.top),
      } });
      applyPos();          // re-assert the stylesheet's full-height geometry
    };
    header.addEventListener('pointermove', move);
    header.addEventListener('pointerup', up);
  });

  // A resized window — including entering or leaving fullscreen — re-resolves
  // the ratio rather than just dragging the old pixel column back on screen.
  window.addEventListener('resize', () => { if (S.settingsPos) applyPos(); });
}

export function initSettings(onRebuild) {
  rebuild = onRebuild;
  const panel = $('#settings');
  initSettingsDrag(panel);
  $('#settings-close').addEventListener('click', () => { panel.hidden = true; });

  const search = $('#settings-search-input');
  const clear = $('#settings-search-clear');
  // Debounced, because a keystroke rebuilds all eight panels to search them.
  // Short enough to feel immediate, long enough that typing a word is one pass.
  const run = debounce(() => { query = search.value.trim(); syncClear(); draw(); }, 120);
  search?.addEventListener('input', run);
  clear?.addEventListener('click', () => { resetSearch(); search?.focus(); });

  window.addEventListener('lgt:settings', () => {
    panel.hidden = !panel.hidden;
    // Reopening starts clean rather than resuming a filter set minutes ago,
    // which would look like a drawer with most of its settings missing.
    // resetSearch draws, so there is no second draw here.
    if (!panel.hidden) resetSearch();
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || panel.hidden) return;
    // A search in progress owns Escape first: clearing the filter is nearly
    // always what was meant, and the drawer is one more press away.
    if (query || search?.value) { resetSearch(); return; }
    panel.hidden = true;
  });
}

/** Apply a still wallpaper — gradient or packaged photo — and turn off any
 *  running clip.
 *
 *  The video layer sits on top of the still one, so picking a wallpaper while
 *  a clip is playing would change nothing you can see, which reads as a dead
 *  button rather than as "the video is in front". Nothing is destroyed: a
 *  local clip stays in IndexedDB and a packaged one is a file, so re-picking
 *  either is one click. */
async function pickStill(patch, note = '') {
  const hadVideo = !!S.wallpaperVideo;
  if (hadVideo) { patch = { ...patch, wallpaperVideo: '', wallpaperVideoName: '' }; }
  await set(patch);
  applyTheme();
  draw();
  // `note` is the caller's own message. Combined rather than toasted
  // separately, because two toasts in the same turn replace each other and
  // whichever lost would be the one the user needed.
  const msg = note && hadVideo ? `${note} · live wallpaper turned off`
    : note || (hadVideo ? 'Live wallpaper turned off' : '');
  if (msg) toast(msg);
}

async function pickVideo() {
  const f = el('input', { type: 'file', accept: 'video/mp4,video/webm,video/*' });
  f.addEventListener('change', async () => {
    const file = f.files[0];
    if (!file) return;

    const { usage, quota } = await storageEstimate();
    if (quota && file.size > quota - usage) {
      return toast(`Not enough space — ${fmtBytes(file.size)} needed, ${fmtBytes(quota - usage)} free.`);
    }
    if (file.size > 300e6) return toast('Please pick a video under 300 MB.');

    toast(`Saving ${fmtBytes(file.size)}…`);
    try {
      await putBlob(WALLPAPER_VIDEO_KEY, file);
      // Replacing an existing local video leaves the setting on 'local', so
      // the cached object URL has to be dropped or the old clip keeps playing.
      invalidateLocalVideo();
      // The old video's frame is keyed by the old name, so it would simply be
      // ignored — but there is no reason to leave a stale megabyte in
      // localStorage when the video it belonged to is gone.
      clearLocalPoster();
      await set({ wallpaperVideo: 'local', wallpaperVideoName: `${file.name} (${fmtBytes(file.size)})` });
      applyTheme();
      draw();
      toast('Live wallpaper set');
    } catch (e) {
      toast('Could not store that video: ' + e.message);
    }
  });
  f.click();
}

async function clearVideo() {
  // Delete the uploaded file only when it is not some *other* video that is
  // playing. With a built-in clip on screen this button reads as "stop this
  // clip", and it was silently destroying an upload that can be hundreds of
  // megabytes and has no second copy anywhere.
  //
  // Deliberately not "only when 'local' is playing": with nothing playing at
  // all, an orphaned upload would then have no way to be deleted, which is a
  // worse trade than the one being fixed. So it is protected exactly when
  // something else is on screen, and turning that off first still gets you
  // back to a Remove that removes.
  const playingSomethingElse = !!S.wallpaperVideo && S.wallpaperVideo !== 'local';
  let kept = false;

  if (playingSomethingElse) {
    kept = !!(await getBlob(WALLPAPER_VIDEO_KEY).catch(() => null));
  } else {
    await delBlob(WALLPAPER_VIDEO_KEY).catch(() => {});
    clearLocalPoster();
    invalidateLocalVideo();
  }

  await set({ wallpaperVideo: '', wallpaperVideoName: '' });
  applyTheme();
  draw();
  toast(kept ? 'Live wallpaper off · your uploaded video is kept'
    : playingSomethingElse ? 'Live wallpaper turned off'
    : 'Live wallpaper removed');
}

/** Wallpapers are stored as Blobs in IndexedDB, not as base64 in settings.
 *
 *  Anything larger than the screen is also re-encoded down to it. A wallpaper
 *  is drawn at `background-size: cover`, so pixels beyond the display are
 *  decoded and thrown away — and the decoded bitmap is the dominant cost
 *  either way (a 2560x1440 image is 14 MB decoded regardless of its file
 *  format). Measured on a 2560x1440 photo, PNG was 6.09 MB and the same image
 *  as JPEG was 0.5 MB, so this is much the larger saving of the two. */
const MAX_WALLPAPER_PX = 3840;      // enough for a 4K display
const REENCODE_OVER = 1.5e6;        // leave small files alone entirely

async function storeWallpaper(file) {
  let blob = file;
  let note = '';

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (bitmap) {
    const scale = Math.min(1, MAX_WALLPAPER_PX / Math.max(bitmap.width, bitmap.height));
    const oversized = scale < 1;
    if (oversized || (file.size > REENCODE_OVER && file.type !== 'image/jpeg')) {
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(w, h);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
      const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
      // When the image is oversized, take the downscale regardless of file
      // size: it is the pixel count that costs memory, and a highly
      // compressible PNG can be a smaller *file* than its JPEG while still
      // decoding to hundreds of megabytes. Otherwise this is only a re-encode,
      // so it has to earn its place — JPEG-ing a small flat-colour PNG makes
      // it both bigger and worse.
      if (oversized || jpeg.size < file.size) {
        blob = jpeg;
        note = oversized
          ? ` · resized to ${w}×${h}, ${fmtBytes(file.size)} → ${fmtBytes(jpeg.size)}`
          : ` · ${fmtBytes(file.size)} → ${fmtBytes(jpeg.size)}`;
      }
    }
    bitmap.close();
  }

  await putBlob(WALLPAPER_IMAGE_KEY, blob);
  // Replacing an existing local wallpaper leaves the setting unchanged, so the
  // cached object URL has to be dropped explicitly or the old image stays up.
  invalidateLocalImage();
  // Through pickStill, not a bare set: choosing a still wallpaper has to turn
  // off any live one, and this path used to skip that. The video layer renders
  // on top, so uploading an image while a clip was playing changed nothing you
  // could see — while still toasting "Wallpaper set".
  await pickStill({ wallpaperCustom: 'local' }, 'Wallpaper set' + note);
}

async function clearImage() {
  await delBlob(WALLPAPER_IMAGE_KEY).catch(() => {});
  clearStillThumb();
  await set({ wallpaperCustom: '' });
  applyTheme(); draw(); toast(t('Wallpaper cleared'));
}

async function pickImage() {
  const f = el('input', { type: 'file', accept: 'image/*' });
  f.addEventListener('change', async () => {
    const file = f.files[0];
    if (!file) return;
    if (file.size > 40e6) return toast('Please pick an image under 40 MB');
    try { await storeWallpaper(file); }
    catch (e) { toast('Could not use that image: ' + e.message); }
  });
  f.click();
}
