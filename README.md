# Liquid Glass Tab

A new-tab replacement for Chrome: an Apple-style liquid-glass interface with a
bookmark dock along the bottom, weather, news, a Spotify player with an audio
visualizer and time-synced lyrics, and a pile of other widgets you can drag
anywhere and tune to taste.

---

## 1. Install (2 minutes)

1. Open **File Explorer**
2. Go to **Downloads**
3. Right click **Liquid-Glass-Tab-main.zip**
4. Extract it (**Extract All**)
5. Go to `chrome://extensions`
6. Turn on **Developer mode** (top-right toggle)
7. Click **Load unpacked**
8. Select the folder **Liquid-Glass-Tab-main**
9. Open a new tab and that's it.

> **Picking the right folder in step 8.** Windows sometimes nests the extracted
> folder inside another one with the same name. You want the folder that has
> `manifest.json` sitting directly inside it. If Chrome says it can't find a
> manifest, go one level deeper and try again.

> **Keep the folder where it is.** For unpacked extensions Chrome derives the
> extension ID from the folder path. Moving or renaming the folder changes the
> ID, which invalidates the Spotify redirect URI you'll set up in section 3.

On first run the settings drawer opens automatically. Press <kbd>?</kbd> at any
time for the shortcut list.

---

## 2. Weather

Open **⚙ → Weather**, then either:

- Type a city name and press Enter, then pick from the results, or
- Click **Detect** to guess your location from your IP address

Weather data comes from [Open-Meteo](https://open-meteo.com) — free, no API key,
no account. Switch °C/°F and wind units on the same tab.

**Privacy** — **⚙ → Weather → Show location** has three levels, for when you're
screen sharing or streaming:

| Level | On the new tab |
|---|---|
| **Don't show it** (default) | nothing — just the forecast |
| **Country only** | `United States` — drops the city and region |
| **City and country** | `Denver, Colorado, United States` |

The settings readout is masked to match, so opening settings mid-share doesn't
undo it; click it to reveal.

This hides the location **from view**, not from the request — a weather API
needs coordinates to return a forecast. If that matters to you, turn the weather
widget off entirely in ⚙ → Widgets.

*Why not real GPS?* Chrome extension pages can't use the geolocation API without
an offscreen document, and IP lookup is city-accurate anyway. Nothing about your
location leaves your machine except the coordinates sent to the weather API.

---

## 3. Spotify

This takes about 3 minutes because Spotify requires you to register your own
app. You only do it once.

### Create a Spotify app

1. Go to <https://developer.spotify.com/dashboard> and log in
2. Click **Create app**
3. Fill in any name and description (e.g. "Liquid Glass Tab")
4. Under **Which API/SDKs are you planning to use?** tick **Web API**
5. For **Redirect URI**, paste the value from **⚙ → Music → Redirect URI**
   (there's a *Copy redirect URI* button). It looks like:
   ```
   https://<your-extension-id>.chromiumapp.org/spotify
   ```
   It must match **exactly** — no trailing slash, no typos.
6. Save, then open the app's **Settings** and copy the **Client ID**

### Connect

7. Paste the Client ID into **⚙ → Music → Client ID**
8. Click **Connect Spotify** and approve the permission screen

### Things worth knowing

- **Playback control needs Spotify Premium.** Play/pause/skip/seek/volume go
  through Spotify's remote-control API, which returns `403` for free accounts.
  Free accounts can still *see* what's playing, along with artwork and lyrics.
- **The player controls an existing Spotify session.** It does not play audio
  itself — start playback on your phone, desktop app, or
  [open.spotify.com](https://open.spotify.com), and this becomes the remote.
  (Spotify's Web Playback SDK is a remotely-hosted script, which Manifest V3
  forbids extensions from loading, so embedding a player isn't possible.)
- **Your app starts in Development Mode**, meaning only the Spotify account that
  created it can log in. That's fine for personal use. To let others in, add
  their emails under the app's **User Management**.
- No client secret is used or stored anywhere. Auth is Authorization Code with
  PKCE; tokens live in local extension storage and refresh automatically.

---

## 4. The visualizer

A standing spectrum that grows **outward from the centre**: bass in the middle,
treble pushing toward both edges, mirrored left/right and above/below. Each bar
owns a fixed frequency range and spikes in place — nothing scrolls.

Two shapes under **⚙ → Music → Visualizer style**: **Bars** (the wide waveform
strip) and **Radial** (a ring whose spokes push outward, and whose inner circle
breathes with the bass). The widget resizes itself to suit the shape.

The widget is deliberately **bare** — no panel, no border, no controls, just the
canvas. Everything that configures it lives in **⚙ → Music**.

### Adaptive layout: beat in the middle, vocals on the flanks

**⚙ → Music → Split beat & vocals** (on by default, Bars shape only).

Each region is anchored at its own end of the bar and grows toward the split
point between them — they never compete for the same space:

```
centre |beat ───►              ◄─── vocals| edge
```

The beat starts at the centre with its lowest frequency and rises outward. The
vocals start at the **outer edge** with their lowest formants and rise inward.
That reversal is deliberate: a voice is loudest low in its range, so anchoring
that at the edge is what makes the vocals appear to begin at the edge and
spread inward as they get louder.

The flanks carry **300 Hz – 5 kHz**, the formant range. They used to carry
everything above 215 Hz all the way to 16 kHz, and the top of that is silent in
most music — so the outermost bars were showing hi-hats and were completely
blind to the voice. Measured: adding a vocal moved the edge bars **0%** under
the old layout and **+1275%** under this one.

The bar doesn't have a fixed frequency layout. It measures how much of what's
playing right now is voice rather than beat, and hands out width accordingly:

- **Drums/bass only** → the beat expands to fill the **entire** bar
- **Vocals come in** → the beat contracts to the centre (~34% minimum) and the
  vocal range spreads out to both flanks
- **Vocals drop out** → the beat takes the width back

The morph is deliberately slow (roughly a second) — it's a shape, not a meter,
and snapping it every frame would be unreadable.

Measured: with a sub-bass-only source the beat holds 100% of the bar; add
vocals and it settles to 65%, with the vocal region lighting up out on the
flanks where it previously had no space at all.

**A drum kit is not a voice, and frequency alone can't tell you that.** A
snare's body sits at 1–6 kHz and a hi-hat above it — both inside the vocal
window — so measuring level there reported a kick/snare/hat loop with no
singing in it as **78% vocal**, leaving the beat only 49% of the bar instead of
all of it. What separates them is duration: a hit decays in tens of
milliseconds, a sung note holds for hundreds. The vocal band is now gated by a
**crest factor** — its sustained level over its recent peak — which measures
0.26 for percussion against 0.76–0.96 for singing. Measured beat width went
from 49% to **100%** on drums alone, while drums-plus-vocals stays at 35%.

That has to be a peak-hold, not a fast envelope: a fast envelope collapses
between hits, which inverts the ratio and makes a burst train look perfectly
sustained for most of its cycle.

Presence is the ratio of the loudest 500 Hz–4 kHz peak to the loudest bass peak,
in **linear** amplitude. Three things that all had to be right:

- measured from the **raw** spectrum, not the vocal-weighted one, or the
  emphasis counts itself twice and instrumentals read as vocals;
- **peaks, not means** — log band spacing gives a 60 Hz tone only a couple of
  lit bands while a harmonic series lights dozens up top;
- **linear, not dB** — the byte spectrum is dB-scaled, which squashes an
  18 dB-down harmonic into looking nearly as loud as the fundamental.

Get any of those wrong and a plain synth-bass line registers as singing.

### Making it react to vocals, not just the beat

**⚙ → Music → Vocal emphasis** (default 55%). Raw spectrum is all kick drum —
bass carries several times the energy of a voice, so at 0% the display is a beat
meter. The slider does two things:

- **Weights the 300 Hz–5 kHz range** where vowel formants and consonants live,
  toward parity with the bass. Measured on matched-level test tones, voice energy
  goes from 0.30× bass at 0% to 0.52× at 100% — a **1.73×** shift.
- **Adds spectral flux**: bands that just got *louder* get a bonus, so syllable
  onsets punch through while sustained notes sit still. Measured, an onset reads
  **28% above** its own sustain at 100%, versus no difference at all at 0%.

Bands are also spaced logarithmically from 40 Hz–16 kHz rather than by a power
curve, which stops the whole vocal range being crushed into a couple of bars.

### If the bars sit pinned at full height

Drop **⚙ → Music → Sensitivity** (default 100%, range 20–250%). It only affects
captured audio, not the simulated source.

The underlying cause of constant clipping was `AnalyserNode`'s default range of
`-100..-30 dBFS`: mixed music routinely sits above −30 dBFS, so every band
saturates. It now runs `-85..-8 dBFS`, which covers the real dynamic range of
loud audio.

### Getting real audio into it

Four sources, in descending order of "is this actually the music":

| Source | What it really is |
|---|---|
| **System audio** ⭐ | `getDisplayMedia` with system audio. Captured at the OS mixer, so **DRM does not block it and it hears the Spotify desktop app**. This is the one that works with Spotify. |
| **Tab audio** | `chrome.tabCapture` of another tab. Real audio for YouTube, SoundCloud, etc. Spotify's *web* player is Widevine-protected and will capture as silence. |
| **Microphone** | A real FFT of what your mic hears. Works if your speakers are on. |
| **Simulated** (default) | Synthesised from playback position and BPM. Each track gets a stable seed so the same song always animates the same way. Honest label: this is **not** analysis of audio. |

**To get a real Spotify visualization:** ⚙ → Music → **System audio**, choose
**Entire Screen** in Chrome's dialog, and tick **Also share system audio**
(bottom-left of the picker). You'll see a "sharing" indicator while it runs.

Tab capture lists whatever is currently making noise, and asks for permission on
just that one site before capturing. Capturing a tab does not mute it — the audio
is routed back to your speakers.

**The catch:** a capture belongs to the page that started it, so it ends when you
close or navigate that new tab. Chrome gives no way to keep a screen/tab capture
alive across new tabs without re-prompting. Simulated is the default because it
needs no permission and never expires.

**Assumed BPM** only affects the simulated source, which has no audio to
measure and so animates to this tempo instead — set it near the track's. The
three capture sources use the real beat and ignore it entirely. (The setting
says so on screen now; the note used to be passed to a row subtitle that
`settings.js` no longer renders, so it never appeared.)

---

## 5. Lyrics

Fully real and time-synced. Lyrics come from [LRCLIB](https://lrclib.net), a
free community database — no key, no account. The widget matches on
artist + title + duration, falls back to a looser search, and highlights the
current line against Spotify's playback position.

If a track's lyrics run early or late, nudge **⚙ → Music → Timing offset**
(negative = show lines sooner).

---

## 6. News

Three feeds are on by default (BBC World, Hacker News, The Verge) with Ars
Technica and NYT available. Add any RSS or Atom feed under **⚙ → News**; Chrome
will ask permission for that specific host the first time.

---

## 7. Everything else

### Widgets

Toggle any of these under **⚙ → Widgets**:

Clock & date · Search bar · Weather · News · Spotify player · Audio visualizer ·
Synced lyrics · To-do list · Notes · Focus timer (pomodoro) · Quote · Speed dial ·
World clocks · Countdown · Crypto prices · Calendar · Battery

**Countdown** counts to either a **holiday** or a **custom date**. Click the ✎ on
the widget (or use ⚙ → Data). Holidays roll over on their own — pick Christmas
and the day after Christmas it starts counting to next year's. Easter, Mother's
Day, Father's Day and Thanksgiving are computed rather than hard-coded, so they
land on the right day every year. Custom mode gives you a date picker and a
label, for a birthday or anything else.

**Drag any panel anywhere.** Press <kbd>E</kbd> (or click ✥) to unlock the
layout, then drag. Positions are stored as percentages so they survive resizing.
Hold <kbd>Alt</kbd> to drag without unlocking. **⚙ → Widgets → Reset layout**
puts everything back.

### Private search

Four ways in, because the whole point is that it's quicker than opening a
private window yourself:

- **The ◐ button** in the search bar arms it. It stays lit in the accent colour
  so "will this search go somewhere private?" is answerable at a glance, and the
  placeholder changes to *Search … privately*.
- **<kbd>Ctrl</kbd>+<kbd>Enter</kbd>** in the search bar does it once, without
  arming the toggle.
- **<kbd>I</kbd>** opens an empty private window.
- **<kbd>Ctrl</kbd>+<kbd>Enter</kbd>** on any command-palette result — a
  bookmark, a history entry, a search — opens that privately instead. The
  palette also lists *Search … privately* and *Open a private window*
  outright, and right-clicking a dock bookmark offers **Private**.

**⚙ → Look → Private search** has both settings: whether to search privately by
default, and which engine to use when you do. That second one defaults to
*Same as normal*, and exists because plenty of people want DuckDuckGo for
private searches while keeping Google for everything else.

Results open in a new private window rather than this tab, so the tab you're on
stays where it is.

> Chromium calls this different things — Incognito in Chrome, InPrivate in
> Edge, Private in Brave and Opera — but it's the same API, so this works in all
> of them. Opening a *different browser* isn't possible: no extension can start
> another application. If your browser has private browsing disabled by policy,
> the extension says so rather than failing silently.

### The dock

Reads your real bookmarks, so anything you add to the bookmarks bar appears
instantly — and you never have to touch the bookmarks bar to add one.

**Adding bookmarks, four ways:**

- Click the **+** in the dock, type an address (`github.com` is enough — the
  scheme is filled in for you) and hit Enter
- The same sheet lists your **open tabs** — one click adds any of them
- **Drag a link** from any page and drop it on the dock
- Anything you add to the bookmarks bar the normal way still shows up

**Managing them:** right-click any dock item to rename it, change its URL, copy
the link, or delete it. Drag items along the dock to reorder — that writes back
to Chrome's real bookmark store. Middle-click opens in a background tab.

**Hover effects** — **⚙ → Dock → Hover effect**:

| Effect | Behaviour |
|---|---|
| **Magnify** (default) | Icons scale by distance from the cursor and push each other aside |
| **Lift up** | Icons rise off the dock, tallest under the cursor |
| **Pop & hold** | Snaps up past its target and **stays raised** while you're on it, dropping the moment you leave. Neighbours get a brief swell that returns to rest |
| **Bounce** | Springs up and settles, rippling to 3 icons either side |
| **Wiggle** | Decaying rock, staggered along the row |
| **Jelly** | Squash and stretch; neighbours wobble too, but only slightly (≈25% and 4%) |
| **None** | Only the plate brightens |

Bounce, Wiggle and Jelly run on their own clock, so **sweeping quickly across
the dock sets the whole row off** and each icon finishes its animation even
after the cursor has moved past it.

Magnify and Lift grade smoothly with distance from the cursor. Pop & hold is
deliberately all-or-nothing per icon — a smooth distance curve there just
reproduces Magnify.

**Hover scale** drives Magnify, Enlarge and Pop. Everything else is on the same
tab: position (top/bottom), icon size, icon spacing, labels, auto-hide, max
items, top-sites append, source folder, and the icon quality/vibrancy/contrast
controls. New bookmarks go into whichever folder feeds the dock, so if you point
it at a different folder, **+** follows.

**Auto-hide** slides the dock off-screen until you push the cursor into a 26px
strip along that edge.

### Live wallpaper (video)

**⚙ → Look → Live wallpaper** takes an MP4 or WebM and plays it looping behind
everything. Pick a file with **Choose MP4…**, or paste a direct video URL.

The file is stored as a Blob in IndexedDB, not as a data URL, so a 200 MB clip
doesn't have to be base64'd into memory. It never leaves your machine. Limit is
300 MB, and you'll get a warning first if your disk quota can't take it.

- **Dim** (default 25%) darkens the video so widgets stay readable over busy footage
- **Playback speed** 25–200% — slowing a clip down usually looks better as a background
- **Pause when tab hidden** (default on) stops decoding when you're not looking at it, which matters for battery

The video is always muted and looping — Chrome refuses to autoplay anything with
sound. The animated colour blobs turn themselves off while a video is set so
they don't veil it. If the file can't be decoded, it hides itself and your
gradient shows through instead.

### Icon quality

Chrome's favicon store usually only has **16×16** per site, which is a 3× upscale
at dock size: blurry, with muddy colours. **⚙ → Dock → Icon quality** controls this:

| Mode | Behaviour |
|---|---|
| **Auto** (default) | Uses Chrome's local icon, and only fetches a sharper one when Chrome's is too small for the size being drawn |
| **Chrome only** | Never makes a network request. Blurriest, but nothing leaves your PC |
| **Always high-res** | Resolves the sharpest source for every icon immediately |

When it does upgrade, it probes three sources in parallel and keeps the largest,
then caches that choice per-domain for 30 days. No single source wins — measured
on real sites, GitHub's own `apple-touch-icon` is 120px where Google has 32px,
while Hacker News is 256px from DuckDuckGo but 18px from Google. The site's own
icon is preferred on ties, since that request goes to the site you bookmarked
rather than to a third party.

**Icon vibrancy** and **Icon contrast** sliders sit just below, for how punchy
the colours read at dock size.

### Homescreens

The **+** at the top left creates another homescreen. Each one is a separate
bookmark folder feeding the dock, so you get as many docks' worth of bookmarks
as you want. It offers two kinds:

| Kind | What you get |
|---|---|
| **Blank** | An empty dock to fill yourself |
| **Preset** | Pick from a dropdown — Work, Social, Fun, Study, Dev, News or Shopping — and it's created with those bookmarks already in the dock |

- **Widgets are shared.** Same widgets, same positions, on every homescreen —
  only the dock's bookmarks change when you switch.
- **Click a name** to switch. **Click the active name** (or right-click any) to
  rename or delete it.
- **It follows you.** The active homescreen is stored, so every new tab opens on
  it, and switching in one tab updates the others live.
- New homescreens create a folder called `Homescreen — <name>` under **Other
  bookmarks**. Deleting a homescreen never deletes its bookmarks.

The first homescreen is seeded from whatever folder the dock already used, so an
existing setup keeps working and simply gains a name.

### Moving the settings panel

Drag it by its header. It remembers where you put it, and is clamped so it can't
be thrown off-screen. The panel uses a much heavier backdrop blur than the rest
of the glass (60px vs the global setting) so dense text stays readable over any
wallpaper or video.

### Glass tuning

**⚙ → Glass** exposes the whole material: backdrop blur, saturation, brightness,
tint opacity, edge light, corner radius, and **refraction** — an SVG
displacement map that bends the backdrop near panel edges, which is what makes
it read as thick glass rather than frosted plastic. Five presets included
(Apple-ish, Frosted, Thick lens, Barely there, Solid).

Set refraction to 0 if you prefer a flatter look or want to save GPU. At 0 the
SVG filter is taken out of the backdrop chain entirely rather than just having
its displacement zeroed, so the compositor genuinely stops running that pass —
the blur, saturation and brightness all still apply.

### Accessibility

**Reduced motion.** If your system asks for less motion, the decorative
animation stops: the drifting colour blobs, the entry animation on every panel,
the settings and palette slide-ins, the edit-mode pulse, and the dock's hover
effects (that last one is a rAF loop, so it checks the media query itself
rather than relying on CSS). Two things deliberately keep moving — the audio
visualizer, because motion *is* what that widget is, and a live video
wallpaper, because you chose it and pointed it at a file. Both have their own
off switches.

**Keyboard.** The dock is a single Tab stop with arrow-key navigation inside
it, which is the standard toolbar pattern:

| Key | In the dock |
|---|---|
| <kbd>Tab</kbd> | Move into or out of the dock |
| <kbd>←</kbd> <kbd>→</kbd> | Move between bookmarks (wraps) |
| <kbd>Home</kbd> / <kbd>End</kbd> | First / last item |
| <kbd>Enter</kbd> or <kbd>Space</kbd> | Open it |
| <kbd>Menu</kbd> or <kbd>Shift</kbd>+<kbd>F10</kbd> | The right-click sheet — rename, edit, copy, private, delete |

Focusing an auto-hidden dock slides it back into view. The command palette has
always been fully keyboard-driven.

### Keyboard shortcuts

| Key | Action |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>K</kbd> | Command palette — bookmarks, history, open tabs, commands |
| <kbd>/</kbd> | Focus the search bar |
| <kbd>I</kbd> | Open an empty private window |
| <kbd>E</kbd> | Toggle layout edit mode |
| <kbd>,</kbd> | Settings |
| <kbd>W</kbd> | Cycle wallpaper |
| <kbd>B</kbd> | Toggle dock auto-hide |
| <kbd>?</kbd> | Show shortcuts |

### Backup

**⚙ → Data** exports every setting to JSON and imports it back — handy before a
factory reset, or to copy your setup to another machine.

Imported files are treated as untrusted: feed URLs and the wallpaper URL are
pinned to `http(s)` on the way in, so a hand-edited file can't point the page
at a `javascript:` or `data:` URL.

---

## Privacy

Everything is stored locally in `chrome.storage.local`. There is no analytics,
no telemetry, and no server belonging to this extension. Network requests go
only to the services you use:

| Service | Purpose | Sends |
|---|---|---|
| Open-Meteo | Weather | Your coordinates |
| ipapi.co / ipwho.is | Optional IP location | Your IP (only when you click Detect) |
| Spotify | Playback + control | OAuth token |
| LRCLIB | Lyrics | Artist, title, duration |
| DuckDuckGo | Search suggestions | Your query as you type (disable in ⚙ → Look) |
| CoinGecko | Crypto prices | Coin IDs |
| Your RSS feeds | Headlines | Nothing |
| The bookmarked site itself | Sharp icon (`/apple-touch-icon.png`) | A plain image request |
| Google / DuckDuckGo icon services | Sharp icon, only when the site has none | The domain name |

Icon lookups happen only in **Auto** (when Chrome's icon is too small) or
**Always high-res** mode, once per domain per 30 days. Set **⚙ → Dock → Icon
quality** to *Chrome only* if you'd rather nothing left the machine.

Wallpaper images and videos you upload are stored locally as Blobs in
IndexedDB. Neither is ever uploaded anywhere. Images larger than 3840px are
re-encoded down to that on import, since a wallpaper is drawn at `cover` and
anything beyond your display is decoded and thrown away.

---

## Development

`dev-preview.html` and `dev-preview-stub.js` let you open the page in a normal
browser tab with stubbed `chrome.*` APIs, so you can iterate on CSS without
reloading the extension:

```bash
python -m http.server 8732 --directory liquid-glass-tab
```

then visit `http://localhost:8732/dev-preview.html`. Add `?favicons=broken` to
force every favicon request to fail and check the lettered fallback tiles.
Both files are dev-only and safe to delete — the extension never references them.

### Publishing

```bash
python package.py
```

Writes `dist/liquid-glass-tab-<version>.zip` containing only what should ship —
no dev harness, no generator scripts, no docs. It refuses to build if anything
would be rejected or would silently break after install: a root-level file
starting with `_`, a missing icon or generated asset, a description over 132
characters, a manifest that isn't valid JSON (a UTF-8 BOM counts, and PowerShell
will add one if you let it), a dropped `_favicon` entry, or `'unsafe-eval'` in
the CSP.

`PRIVACY.md` is the privacy policy. It does not ship — the store wants a public
URL, not a file, and anything publicly reachable will do: a Google Doc set to
*Publish to web*, Google Sites, a Notion page, or this repo.

Bump `version` in the manifest before each upload; the store rejects a version
it has already seen.

**On the extension ID and Spotify.** An unpacked build gets an ID derived from
its folder path; a published build gets one permanent ID from the store, *the
same for every user*. Users each register their own Spotify app, but they all
paste the same redirect URI — the one ⚙ → Music shows them. None of that needs
doing before publishing.

It only affects local development: your unpacked build has a different ID from
the published one, so a different redirect URI. Spotify apps accept several, so
add both to the same app rather than creating a second. Cleaner still, after the
first upload take Developer Dashboard → Package → *View public key* and add it
to `manifest.json` as `"key"` — the unpacked build then shares the published ID
and one URI covers both.

### Two manifest gotchas that cost me time

> **Never give a root-level file or folder a name starting with `_`.** Chrome
> reserves those and will refuse to load the extension with
> *"Filenames starting with `_` are reserved for use by the system."*

> **Do not delete the `web_accessible_resources` entry for `_favicon/*`.** It
> looks redundant next to the `favicon` permission, but the favicon API needs
> both. Without it every `chrome-extension://<id>/_favicon/?pageUrl=…` request
> is blocked and every bookmark icon in the dock renders as a broken image.

> **No comments in `manifest.json`.** JSON has none, and Chrome warns on any key
> it doesn't recognise — including the `"//"` convention. Notes go here instead.

Icons are generated by `icons/make_icons.py` (stdlib only, no Pillow):

```bash
python icons/make_icons.py
```

### Layout

```
manifest.json        MV3 manifest
newtab.html          page shell + the SVG refraction filter
background.js        service worker: cache warming, Spotify token refresh
assets/              refraction map + film grain PNGs, and their generator
css/base.css         reset, design tokens, wallpaper
css/glass.css        the liquid-glass material + dock
css/ui.css           widget and control styling
js/app.js            bootstrap, drag layout, shortcuts
js/state.js          settings load/patch/persist, import sanitising
js/theme.js          settings → CSS vars, wallpaper resolution
js/media.js          IndexedDB blob store (wallpaper image + video)
js/audio.js          spectrum engine (mic FFT + simulated)
js/spotify.js        PKCE auth + Web API client
js/dock.js           bookmark dock
js/palette.js        command palette
js/settings.js       settings drawer
js/widgets/          one module per widget group
```

The two generated images are built by a stdlib-only script, the same way the
icons are:

```bash
python assets/make_assets.py
```

It writes `assets/refract-map.png` (256², RGB) and `assets/grain.png` (220²,
8-bit greyscale) and is deterministic — the grain uses a fixed seed, so
re-running it doesn't churn 48 KB of noise through git.

### Performance invariants

These were all measured, and each one was a real cost before it was fixed.
Breaking them again is easy and silent, so they're written down.

**Nothing heavy runs at import or in `initTheme`.** The refraction map and the
film grain used to be drawn into a canvas and turned into data URLs on every
new tab — 15–28 ms of blocking work per tab depending on the machine, 111 KB of
string, and a separate decode per tab because a data URL is a new resource
every time. They're static files now. Don't move image generation back into
startup; put it in `assets/make_assets.py`.

**The refraction map is 256², and that's deliberate.** `feDisplacementMap`
shifts by `scale * (channel/255 − 0.5)`, so at the default scale of 42 the
quantisation error against the old 512² map is 0.33 px worst case — invisible.
128² comes to 0.99 px, which is on the edge; 64² breaks down at 2.14 px with
11% of samples over a pixel. 256² has a 3× margin. Note the decoded cost is
what matters, not the file: the 512² map was 1 MB decoded from an 11 KB string.

**`background-size: 220px` on `#wp-grain` must match the tile.** Change one
without the other and the noise is resampled — coarser and blurrier.

**Big media never goes in the settings object.** `chrome.storage.local.set`
writes the whole object every time, and every control writes settings. A
wallpaper as a base64 data URL made one write cost 11.4 ms against 0.1 ms
without it, held 6 MB per open tab, and was re-serialised on every slider
frame. Images and videos live in IndexedDB (`js/media.js`); settings hold
`'local'`. `js/state.js` migrates any leftover data URL on load.

**Settings writes are coalesced** (`js/state.js`). `S` updates synchronously,
only the disk trip is deferred, and a max-wait bounds the delay. A three-second
slider drag went from ~75 writes to 7. Anything needing a guaranteed write
calls `flushNow()`; `pagehide` and tab-hide flush automatically.

**Per-frame code must not query the DOM, allocate, or recompute constants.**
The dock loop caches its element list and reuses typed-array scratch buffers;
its spread pass is a single ordered pass with a running total rather than
comparing every pair (13× faster, identical output). `js/audio.js` precomputes
band edges and the vocal-weight curve — they depend only on band index and
sample rate, and recomputing them was ~23,000 `pow`/`log`/`exp` calls a second.
The visualiser caches the accent colour and its gradient instead of calling
`getComputedStyle` every frame.

**Animation smoothing must be time-based, never per-frame.** `js/audio.js` used
fixed per-call factors (0.55 rising, 0.12 falling), which ties the response to
the frame rate rather than to time: bars fell to half height in 100 ms at 60Hz
but 42 ms at 144Hz and 25 ms at 240Hz, so the whole display read as jittery on
a fast monitor — and got worse every time the page was made cheaper to render,
because the loop then actually reached the display's refresh rate. It is now
`1 - exp(-dt / tau)`, with taus chosen to reproduce the old constants exactly
at 60fps. The dock's hover loop (`EASE_TAU`) has always done this correctly;
match it. The same applied to the vocal-presence follower.

**Don't write a DOM property that already holds the value.** The Spotify
progress bar and clock only change a few times a second; the dock's transforms
are unchanged at rest. Each redundant write still costs a style invalidation.

**The drag handler and `clampPanel` must agree, via `layoutBounds()`.** They
used to disagree — dragging allowed 4px from every edge while clamping reserved
room for the dock — so a panel could be dropped up to 94px lower than clamping
would accept. Nothing re-clamps on drop, so it sat there until the next rebuild
or page load and then jumped upward.

The reserve is resolved in the panel's favour, not the dock's. `layoutBounds`
takes a `placed` flag: a panel the user has dragged gets the whole viewport,
and only automatic repositioning keeps clear of the dock. Reserving dock space
on both paths *does* make the drop stable, but it also makes the bottom ~190px
of the screen unreachable — the reserve exists so a widget that grows after
mount (weather, news) doesn't slide under the dock, and it was never meant to
overrule a deliberate drag. `placed` is set on drop and cleared by **⚙ →
Widgets → Reset layout**, which must also restore `anchor` — resetting only
x/y left a dragged clock at `anchor:null` and therefore half its width
off-centre.

**Measure a panel before clearing its transform, not after.**
`getBoundingClientRect()` includes transforms, and centre-anchored panels (the
clock and search bar) sit at `left:50%` with `translateX(-50%)`. Measuring
first and clearing after computed the pointer offset against a box half a
panel-width away, and clicking one in edit mode without dragging dropped the
anchor while keeping the old `x` — shunting it permanently right by half its
width. Bounds use `offsetWidth`/`offsetHeight`, which ignore the drag's
`scale(1.03)` and any in-flight entry animation.

**Rebuilding a list is not the same as moving a selection.** The command
palette used to rebuild every row on every `mouseenter`, which re-created each
row's favicon `<img>` — sweeping a 20-row list built 400 images. Measured 101×
slower than toggling one class. Same trap anywhere a hover changes a selection.

### Security notes

- **Anything that becomes a navigation gets scheme-checked.** Bookmarks and
  history can hold `javascript:` bookmarklets, and this page runs at the
  extension's origin with `bookmarks`, `history`, `tabs` and `topSites`. The
  dock and the command palette both funnel through an `httpOnly` guard.
- **Anything that becomes a CSS `url()` goes through `cssImageURL`**
  (`js/theme.js`). The wallpaper URL is interpolated into an inline style, so
  an unescaped quote would close the `url()` and inject further declarations.
- **Imports are sanitised** — see Backup above. `SECRET_KEYS` in `js/state.js`
  is the list of credentials withheld from an export and protected from being
  overwritten by an import. It is empty right now, correctly: Spotify's tokens
  live under their own storage key and its client ID is public under PKCE. Add
  any future API key to it.
- **The extension declares an explicit CSP** (`content_security_policy.
  extension_pages` in the manifest) rather than relying on the MV3 default:
  `object-src`, `base-uri`, `form-action` and `frame-src` are all `'none'`.
- **The PKCE verifier uses rejection sampling.** The 66-character alphabet
  doesn't divide 256, so a plain `% 66` made the first 58 characters 1.33×
  likelier than the last 8.
- **Token refresh is deduplicated.** Spotify rotates the refresh token on use,
  so two refreshes racing meant the second presented a spent token — and the
  old code responded by disconnecting. Only a 400/401 clears tokens now; a 5xx
  or a dropped connection is retried later.

### A note on the glass, if you go editing CSS

`.glass::before` carries `backdrop-filter`. Do not add `isolation: isolate`,
`mix-blend-mode`, `opacity < 1`, `filter`, or `contain: paint` to a `.glass`
element or any ancestor — each of those creates a **backdrop root**, which stops
the panel from sampling the wallpaper behind it and renders the glass as flat
grey. This is why the sheen layer avoids `mix-blend-mode` and the command
palette overlay has no blur of its own.
