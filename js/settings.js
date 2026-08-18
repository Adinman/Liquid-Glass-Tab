// The settings drawer. Every control writes straight to state and re-applies.
import { $, $$, el, toast, dropCache, debounce, clamp } from './util.js';
import { WALLPAPERS, ENGINES, WIDGET_META, DEFAULTS, HOLIDAYS } from './config.js';
import { countdownTarget } from './widgets/core.js';
import { S, set, setWidget, resetAll, exportSettings, importSettings } from './state.js';
import { applyTheme, applyVideoWallpaper, cssImageURL,
         invalidateLocalImage, invalidateLocalVideo } from './theme.js';
import { putBlob, delBlob, storageEstimate, fmtBytes,
         WALLPAPER_IMAGE_KEY, WALLPAPER_VIDEO_KEY } from './media.js';
import { audio } from './audio.js';
import { activeFolder, activeSpace, spaceList } from './spaces.js';
import { applyDockSettings, renderDock } from './dock.js';
import { searchPlaces, detectPlace } from './widgets/index.js';
import * as sp from './spotify.js';

let rebuild = () => {};
let activeTab = 'look';

const TABS = {
  look: 'Look',
  glass: 'Glass',
  dock: 'Dock',
  widgets: 'Widgets',
  weather: 'Weather',
  news: 'News',
  music: 'Music',
  data: 'Data',
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
  i.addEventListener('change', async () => { await set({ [key]: +i.value }); after?.(); });
  return i;
}

function color(key) {
  const i = el('input', { type: 'color', value: S[key] });
  i.addEventListener('input', debounce(async () => { await set({ [key]: i.value }); applyTheme(); }, 60));
  return i;
}

const group = (title, ...rows) => el('div', { class: 'set-group' }, el('h3', { text: title }), ...rows);

/* ---------- tab bodies ---------- */
const PANELS = {
  look: () => [
    group('Wallpaper',
      el('div', { class: 'wp-swatches' }, ...WALLPAPERS.map(w =>
        el('div', {
          class: 'wp-sw' + (!S.wallpaperCustom && S.wallpaper === w.id ? ' on' : ''),
          style: { background: w.css }, title: w.name,
          onclick: async () => { await set({ wallpaper: w.id, wallpaperCustom: '' }); applyTheme(); draw(); },
        }))),
      row('Custom image', el('div', { class: 'row' },
        el('button', { class: 'btn', text: 'Upload…', onclick: pickImage }),
        el('button', { class: 'btn', text: 'Clear', onclick: clearImage })),
        'A local file is stored inside the extension — it never leaves your machine.'),
      row('Image URL', (() => {
        const i = el('input', { type: 'text', placeholder: 'https://…',
          value: S.wallpaperCustom?.startsWith('http') ? S.wallpaperCustom : '' });
        i.addEventListener('change', async () => {
          const v = i.value.trim();
          // Rejected here rather than silently ignored later, so a typo or a
          // javascript:/data: paste says so instead of quietly doing nothing.
          if (v && !cssImageURL(v)) { toast('Enter an http(s) image URL'); return; }
          if (v) await delBlob(WALLPAPER_IMAGE_KEY).catch(() => {});
          await set({ wallpaperCustom: v }); applyTheme(); draw();
        });
        return i;
      })()),
    ),
    group('Live wallpaper (video)',
      row('Current', el('span', { class: 'faint', style: { fontSize: '12px' },
        text: S.wallpaperVideo === 'local' ? (S.wallpaperVideoName || 'local file')
          : S.wallpaperVideo ? 'from URL' : 'none' })),
      row('Video file', el('div', { class: 'row' },
        el('button', { class: 'btn', text: 'Choose MP4…', onclick: pickVideo }),
        el('button', { class: 'btn danger', text: 'Remove', onclick: clearVideo })),
        'MP4 or WebM. Stored locally in the extension — never uploaded. '
        + 'It is muted and loops; Chrome blocks autoplay for anything with sound.'),
      row('Video URL', (() => {
        const i = el('input', { type: 'text', placeholder: 'https://…/clip.mp4',
          value: /^https?:/.test(S.wallpaperVideo || '') ? S.wallpaperVideo : '' });
        i.addEventListener('change', async () => {
          await set({ wallpaperVideo: i.value.trim(), wallpaperVideoName: '' });
          applyTheme(); draw();
        });
        return i;
      })()),
      row('Dim', slider('videoDim', 0, 80, 1), 'Darkens the video so widgets stay readable.'),
      row('Playback speed', slider('videoSpeed', 25, 200, 5, applyVideoWallpaper)),
      row('Pause when tab hidden', toggle('videoPauseHidden'), 'Saves battery. Recommended.'),
    ),
    group('Motion',
      row('Animated colour blobs', toggle('animateBg')),
      row('Blob intensity', slider('mesh', 0, 100, 1),
        (S.wallpaperCustom || S.wallpaperVideo)
          ? 'Blobs are hidden while a custom image or video is set, so they don’t veil it.' : null),
      row('Film grain', slider('grain', 0, 20, 1)),
      row('Vignette', slider('vignette', 0, 100, 5)),
    ),
    group('Theme',
      row('Colour scheme', select('scheme', { dark: 'Dark', light: 'Light' })),
      row('Accent colour', color('accent')),
      row('UI scale', slider('fontScale', 80, 130, 1)),
    ),
    group('Clock & greeting',
      row('Your name', text('userName', 'shown in the greeting')),
      row('24-hour clock', toggle('clock24')),
      row('Show seconds', toggle('showSeconds', rebuild)),
      row('Clock size', slider('clockSize', 40, 140, 2)),
    ),
    group('Private search',
      row('Search privately by default', toggle('searchIncognito', rebuild)),
      row('Engine for private searches', select('searchIncognitoEngine',
        { '': 'Same as normal', ...Object.fromEntries(Object.entries(ENGINES).map(([k, v]) => [k, v.name])) },
        rebuild)),
      el('div', { class: 'hint', style: { lineHeight: 1.55 } },
        'Results open in a private window instead of this tab. The ◐ button in '
        + 'the search bar toggles it, Ctrl+Enter does it once without toggling, '
        + 'and I opens an empty private window. Some people prefer a different '
        + 'engine for these — DuckDuckGo, say — which is what the second setting '
        + 'is for.'),
    ),
    group('Search',
      row('Search engine', select('searchEngine', Object.fromEntries(
        Object.entries(ENGINES).map(([k, v]) => [k, v.name])), rebuild)),
      row('Live suggestions', toggle('suggestions'), 'Queries go to DuckDuckGo’s autocomplete endpoint as you type.'),
    ),
  ],

  glass: () => [
    group('Liquid glass',
      row('Backdrop blur', slider('blur', 0, 40, 1)),
      row('Saturation', slider('saturation', 100, 300, 5)),
      row('Brightness', slider('brightness', 80, 140, 1)),
      row('Tint opacity', slider('tintAlpha', 0, 40, 1)),
      row('Edge light', slider('edgeAlpha', 0, 100, 1)),
      row('Corner radius', slider('radius', 0, 48, 1)),
      row('Refraction', slider('refract', 0, 120, 1),
        'Bends the backdrop near panel edges. 0 turns it off for a flatter, faster look.'),
      row('Pointer sheen', toggle('sheen')),
    ),
    group('Presets',
      el('div', { class: 'chips' },
        preset('Apple-ish', { blur: 18, saturation: 180, brightness: 108, tintAlpha: 10, edgeAlpha: 55, radius: 26, refract: 42 }),
        preset('Frosted', { blur: 34, saturation: 130, brightness: 104, tintAlpha: 22, edgeAlpha: 40, radius: 22, refract: 8 }),
        preset('Thick lens', { blur: 10, saturation: 220, brightness: 112, tintAlpha: 6, edgeAlpha: 80, radius: 34, refract: 96 }),
        preset('Barely there', { blur: 8, saturation: 140, brightness: 102, tintAlpha: 4, edgeAlpha: 30, radius: 20, refract: 16 }),
        preset('Solid', { blur: 0, saturation: 100, brightness: 100, tintAlpha: 38, edgeAlpha: 20, radius: 18, refract: 0 }),
      )),
  ],

  dock: () => [
    group('Bookmark dock',
      row('Position', select('dockEdge', { bottom: 'Bottom', top: 'Top' }, applyDockSettings)),
      row('Icon size', slider('dockSize', 34, 84, 1)),
      row('Icon spacing', slider('dockGap', 0, 22, 1)),
      row('Hover effect', select('dockHover', {
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
      row('Hover scale', slider('dockMagnify', 1, 2.4, 0.05),
        'Used by Magnify and Pop & hold.'),
      row('Icon quality', select('iconSource', {
        auto: 'Auto — sharpen when blurry',
        chrome: 'Chrome only (never leaves PC)',
        sharp: 'Always high-res',
      }, async () => { await dropCache('icon:'); renderDock(); }),
        'Chrome usually stores icons at 16px, which look blurry at dock size. '
        + 'Auto fetches a sharper icon from Google/DuckDuckGo only when Chrome’s is too small.'),
      row('Icon vibrancy', slider('dockVibrancy', 100, 220, 5),
        'Boosts saturation on favicons so brand colours read at dock size.'),
      row('Icon contrast', slider('dockContrast', 90, 150, 2)),
      row('Show labels on hover', toggle('dockLabels')),
      row('Auto-hide until hover', toggle('dockAutohide', applyDockSettings)),
      row('Max items', number('dockMaxItems', 4, 60, renderDock)),
      row('Append top sites', toggle('dockShowTopSites', renderDock)),
    ),
    group('Source folder', folderPicker()),
  ],

  widgets: () => [
    group('Enabled widgets', ...Object.entries(WIDGET_META).map(([id, label]) => {
      const sw = el('div', { class: 'switch' + (S.widgets[id]?.on ? ' on' : '') }, el('i'));
      sw.addEventListener('click', async () => {
        sw.classList.toggle('on');
        await setWidget(id, { on: sw.classList.contains('on') });
        rebuild();
      });
      return row(label, sw);
    })),
    group('Layout',
      row('Edit mode', (() => {
        const b = el('button', { class: 'btn', text: 'Toggle drag mode',
          onclick: () => window.dispatchEvent(new Event('lgt:edit')) });
        return b;
      })(), 'Drag panels anywhere. Press E to toggle.'),
      row('Reset positions', el('button', {
        class: 'btn danger', text: 'Reset layout',
        onclick: async () => {
          // anchor and placed have to go back too. Resetting only x/y left a
          // dragged panel with anchor:null, so a centre-anchored default like
          // the clock came back half its width off-centre, and `placed` kept
          // it exempt from the dock reserve it should have again.
          for (const [id, w] of Object.entries(DEFAULTS.widgets)) {
            await setWidget(id, { x: w.x, y: w.y, anchor: w.anchor ?? null, placed: false });
          }
          rebuild(); toast('Layout reset');
        },
      })),
    ),
  ],

  weather: () => {
    const results = el('div', { style: { marginTop: '6px' } });
    const input = el('input', { type: 'text', placeholder: 'City name…', style: { maxWidth: '100%', width: '100%' } });
    input.addEventListener('keydown', async e => {
      if (e.key !== 'Enter' || !input.value.trim()) return;
      results.innerHTML = '<div class="hint">Searching…</div>';
      try {
        const places = await searchPlaces(input.value.trim());
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
      group('Location',
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
          class: 'btn', text: 'Detect',
          onclick: async () => {
            const p = await detectPlace();
            if (!p) return toast('Detection failed — enter a city instead.');
            await set({ place: p }); await dropCache('wx:');
            toast(`Detected ${p.name}`); window.dispatchEvent(new Event('lgt:reload')); draw();
          },
        }), 'Uses a public IP-geolocation service. Roughly city-accurate.'),
      ),
      group('Privacy',
        row('Show location', select('weatherPrivacy', {
          full: 'City and country',
          country: 'Country only',
          hidden: 'Don’t show it',
        }, () => { rebuild(); draw(); })),
        el('div', { class: 'hint', style: { lineHeight: 1.6 } },
          'Controls what appears on the new tab — useful when screen sharing. '
          + 'The weather API still needs your coordinates to return a forecast, '
          + 'so this hides the location from view rather than from the request.'),
      ),
      group('Units',
        row('Temperature', select('temperatureUnit', { celsius: 'Celsius', fahrenheit: 'Fahrenheit' },
          async () => { await dropCache('wx:'); window.dispatchEvent(new Event('lgt:reload')); })),
        row('Wind', select('windUnit', { kmh: 'km/h', mph: 'mph', ms: 'm/s', kn: 'knots' },
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
          class: 'icon-btn', text: '✕', title: 'Remove',
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

    const nameI = el('input', { type: 'text', placeholder: 'Name' });
    const urlI = el('input', { type: 'text', placeholder: 'https://example.com/feed.xml' });

    return [
      group('Feeds', list),
      group('Add a feed',
        row('Name', nameI), row('RSS / Atom URL', urlI),
        row('', el('button', {
          class: 'btn primary', text: 'Add feed',
          onclick: async () => {
            const url = urlI.value.trim(), name = nameI.value.trim() || 'Custom';
            if (!/^https?:\/\//.test(url)) return toast('Enter a full http(s) URL');
            // Custom hosts need permission granted at runtime.
            const granted = await chrome.permissions.request({ origins: [new URL(url).origin + '/*'] });
            if (!granted) return toast('Permission denied for that host');
            const feeds = [...S.feeds, { id: 'c' + Date.now(), name, url, on: true }];
            await set({ feeds });
            nameI.value = urlI.value = '';
            drawFeeds();
            window.dispatchEvent(new Event('lgt:reload'));
            toast('Feed added');
          },
        })),
      ),
      group('Display', row('Headlines shown', number('newsCount', 3, 40, () => window.dispatchEvent(new Event('lgt:reload'))))),
    ];
  },

  music: () => {
    const uri = sp.redirectURI();
    const status = el('span', { class: 'faint', style: { fontSize: '12px' }, text: 'checking…' });
    sp.isConnected().then(c => { status.textContent = c ? 'connected' : 'not connected'; });

    return [
      group('Spotify setup',
        el('div', { class: 'hint', style: { lineHeight: 1.6, marginBottom: '10px' } },
          '1. Create an app at developer.spotify.com/dashboard  ·  2. Paste its Client ID below  ·  '
          + '3. Add this exact Redirect URI to the app  ·  4. Click Connect.'),
        row('Redirect URI', ''),
        el('div', { class: 'code', text: uri }),
        el('button', { class: 'btn', style: { marginTop: '6px' }, text: 'Copy redirect URI',
          onclick: () => navigator.clipboard.writeText(uri).then(() => toast('Copied')) }),
        row('Client ID', text('spotifyClientId', 'e.g. 3f9a…')),
        row('Status', status),
        el('div', { class: 'row', style: { marginTop: '8px' } },
          el('button', {
            class: 'btn primary', text: 'Connect Spotify',
            onclick: async () => {
              try { await sp.connect(); toast('Connected'); status.textContent = 'connected'; rebuild(); }
              catch (e) { toast(e.message); }
            },
          }),
          el('button', {
            class: 'btn danger', text: 'Disconnect',
            onclick: async () => { await sp.disconnect(); status.textContent = 'not connected'; toast('Disconnected'); rebuild(); },
          })),
      ),
      group('Visualizer audio', ...vizSourceControls(),
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
      group('Visualizer style',
        row('Shape', select('vizMode', { bars: 'Bars', radial: 'Radial' })),
        row('Split beat & vocals', toggle('vizSplit'),
          'Beat sits in the centre and vocals spread to the flanks. During a '
          + 'drums-only passage the beat expands to fill the whole bar, then '
          + 'gives ground back when the vocals return. Bars shape only.'),
      ),
      group('Lyrics',
        row('Timing offset (ms)', number('lyricsOffset', -5000, 5000),
          'Negative shows lines earlier. Lyrics come from LRCLIB, a free community database.'),
      ),
    ];
  },

  data: () => [
    group('World clocks',
      ...S.worldClocks.map((z, i) => row(z.label, el('button', {
        class: 'icon-btn', text: '✕',
        onclick: async () => {
          await set({ worldClocks: S.worldClocks.filter((_, j) => j !== i) }); draw(); rebuild();
        },
      }), z.tz)),
      (() => {
        const l = el('input', { type: 'text', placeholder: 'Label' });
        const t = el('input', { type: 'text', placeholder: 'Area/City (IANA)' });
        return el('div', {},
          row('Label', l), row('Time zone', t),
          row('', el('button', {
            class: 'btn', text: 'Add clock',
            onclick: async () => {
              if (!l.value.trim() || !t.value.trim()) return toast('Fill both fields');
              try { new Date().toLocaleString(undefined, { timeZone: t.value.trim() }); }
              catch { return toast('Unknown time zone'); }
              await set({ worldClocks: [...S.worldClocks, { label: l.value.trim(), tz: t.value.trim() }] });
              draw(); rebuild();
            },
          })));
      })()),
    group('Countdown',
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
        const t = countdownTarget();
        return t ? t.date.toLocaleDateString(undefined,
          { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }) : 'not set';
      })() }))),
    group('Crypto',
      row('CoinGecko IDs', text('coins', 'bitcoin,ethereum,solana', rebuild), 'Comma separated, lowercase.')),
    group('Backup',
      el('div', { class: 'row' },
        el('button', {
          class: 'btn', text: 'Export settings',
          onclick: () => {
            const blob = new Blob([exportSettings()], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = el('a', { href: url, download: 'liquid-glass-tab.json' });
            a.click();
            // Revoking in the same turn can cancel the download before it has
            // started reading the blob.
            setTimeout(() => URL.revokeObjectURL(url), 30e3);
            toast('Exported');
          },
        }),
        el('button', {
          class: 'btn', text: 'Import…',
          onclick: () => {
            const f = el('input', { type: 'file', accept: 'application/json' });
            f.addEventListener('change', async () => {
              try {
                await importSettings(await f.files[0].text());
                applyTheme(); applyDockSettings(); renderDock(); rebuild(); draw();
                toast('Settings imported');
              } catch (e) { toast('Import failed: ' + e.message); }
            });
            f.click();
          },
        })),
      row('Clear cached data', el('button', {
        class: 'btn', text: 'Clear cache',
        onclick: async () => { await dropCache(); window.dispatchEvent(new Event('lgt:reload')); toast('Cache cleared'); },
      }), 'Weather, news, crypto and lyrics are cached locally.'),
      row('Reset everything', el('button', {
        class: 'btn danger', text: 'Factory reset',
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
      tabs = (await chrome.tabs.query({ audible: true })).filter(t => /^https?:/.test(t.url || ''));
    } catch { /* no tabs permission in preview */ }
    if (!tabs.length) {
      tabList.append(el('div', { class: 'hint', text: 'Tab audio: no tab is playing sound right now.' }));
      return;
    }
    tabList.append(el('div', { class: 'hint', style: { marginBottom: '5px' }, text: 'Or capture a tab that’s playing:' }));
    for (const t of tabs) {
      tabList.append(el('button', {
        class: 'btn',
        style: { display: 'block', width: '100%', textAlign: 'left', marginBottom: '4px' },
        text: '▶ ' + (t.title || t.url).slice(0, 46),
        title: t.url,
        onclick: async () => {
          // tabCapture needs access to that tab; ask for just its origin.
          try {
            const origin = new URL(t.url).origin + '/*';
            const has = await chrome.permissions.contains({ origins: [origin] });
            if (!has && !(await chrome.permissions.request({ origins: [origin] }))) {
              return toast('Permission denied for that site.');
            }
          } catch { /* fall through and let getMediaStreamId report */ }

          const res = await chrome.runtime.sendMessage({ type: 'lgt:tabStreamId', targetTabId: t.id });
          if (!res?.streamId) {
            toast('Tab capture failed: ' + (res?.error || 'no stream id') + ' — try System audio.');
            return draw();
          }
          const ok = await audio.useTab(res.streamId, t.title || 'Tab audio');
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
    wrap.append(row('Folder', s,
      `Which bookmark folder fills the dock for “${activeSpace()?.name || 'this homescreen'}”.`));
  });
  return wrap;
}

/* ---------- shell ---------- */
function draw() {
  const tabs = $('#settings-tabs'), body = $('#settings-body');
  tabs.innerHTML = '';
  for (const [id, label] of Object.entries(TABS)) {
    tabs.append(el('button', {
      class: activeTab === id ? 'on' : '', text: label,
      onclick: () => { activeTab = id; draw(); },
    }));
  }
  body.innerHTML = '';
  body.append(...PANELS[activeTab]());
}

/** Drag the panel by its header. Switches from the default right/bottom
 *  anchoring to explicit left/top the first time it moves. */
function initSettingsDrag(panel) {
  const header = panel.querySelector('header');

  const place = pos => {
    panel.classList.add('dragged');
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.height = pos.h + 'px';
    panel.style.left = pos.x + 'px';
    panel.style.top = pos.y + 'px';
  };
  // A stored size of zero would pin the panel to 0x0 at the corner, so treat
  // anything degenerate as "never dragged".
  const valid = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.h > 120;
  if (valid(S.settingsPos)) place(S.settingsPos);
  else if (S.settingsPos) set({ settingsPos: null });

  header.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;              // let the close button work
    const r = panel.getBoundingClientRect();
    if (r.height < 120) return;                          // panel isn't actually open
    e.preventDefault();
    const offX = e.clientX - r.left, offY = e.clientY - r.top;
    place({ x: r.left, y: r.top, h: r.height });
    // Must not be able to abort the handler before the move/up listeners are
    // attached, or a failed capture leaves the drag permanently dead.
    try { header.setPointerCapture(e.pointerId); } catch {}

    const move = ev => {
      const x = clamp(ev.clientX - offX, 8 - r.width * 0.6, innerWidth - r.width * 0.4);
      const y = clamp(ev.clientY - offY, 8, innerHeight - 60);
      panel.style.left = x + 'px';
      panel.style.top = y + 'px';
    };
    const up = async () => {
      header.removeEventListener('pointermove', move);
      header.removeEventListener('pointerup', up);
      await set({ settingsPos: {
        x: parseFloat(panel.style.left), y: parseFloat(panel.style.top),
        h: parseFloat(panel.style.height),
      } });
    };
    header.addEventListener('pointermove', move);
    header.addEventListener('pointerup', up);
  });

  // A resized window can strand it off-screen.
  window.addEventListener('resize', () => {
    if (!S.settingsPos) return;
    const r = panel.getBoundingClientRect();
    const x = clamp(r.left, 8 - r.width * 0.6, Math.max(8, innerWidth - r.width * 0.4));
    const y = clamp(r.top, 8, Math.max(8, innerHeight - 60));
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
  });
}

export function initSettings(onRebuild) {
  rebuild = onRebuild;
  const panel = $('#settings');
  initSettingsDrag(panel);
  $('#settings-close').addEventListener('click', () => { panel.hidden = true; });
  window.addEventListener('lgt:settings', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) draw();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !panel.hidden) panel.hidden = true;
  });
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
  await delBlob(WALLPAPER_VIDEO_KEY).catch(() => {});
  await set({ wallpaperVideo: '', wallpaperVideoName: '' });
  applyTheme();
  draw();
  toast('Live wallpaper removed');
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
  await set({ wallpaperCustom: 'local' });
  applyTheme(); draw();
  toast('Wallpaper set' + note);
}

async function clearImage() {
  await delBlob(WALLPAPER_IMAGE_KEY).catch(() => {});
  await set({ wallpaperCustom: '' });
  applyTheme(); draw(); toast('Wallpaper cleared');
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
