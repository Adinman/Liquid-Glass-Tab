# CGT: Customizable Glass Tab

A new-tab replacement for Chrome: a customizable glass interface with real
backdrop refraction, a bookmark dock along the bottom, weather, news, Spotify
controls with an audio visualizer and time-synced lyrics, and a pile of other
widgets you can drag anywhere and tune to taste.

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
3. Fill in any name and description (e.g. "CGT")
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

**Resize any panel.** In the same edit mode a ⤡ grip appears at the
bottom-right corner of every widget: drag it out to grow, in to shrink,
double-click it for 100%. Range is 50–200%. Sizes reset along with positions.

Sizing lives on the grip and not in settings, deliberately — it is the one
control you want to use while looking at the thing it changes.

Resizing scales the whole panel — text, padding, icons and artwork together —
rather than only stretching its width, so a bigger news panel gets bigger
headlines instead of longer lines. The widgets that size themselves to their
content (weather, news, lyrics, notes, the quote) keep doing so: they re-wrap
and re-lay out at the new scale rather than being stretched, so text stays
sharp at any size, and the quote widget's reserved two lines stay two lines
because the ratio of text size to panel width never changes.

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

### Backgrounds

**⚙ → Look → Wallpaper** has three rows. Ten gradients, then five photos,
then three looping clips under **Live wallpaper**. The photos and clips are
packaged inside the extension — no network request, no host permission,
nothing added to the store's data disclosure, and nothing to go wrong offline.
Your own image or video still goes in the same place it always did.

Picking a still turns off a running clip. The video layer sits on top of the
still one, so choosing a wallpaper underneath a playing clip would change
nothing you can see and read as a dead button. Nothing is thrown away — a
local clip stays in IndexedDB, a packaged one is a file, so re-picking either
is one click.

Photos are Pexels, clips are Pixabay; both licences permit bundling and neither
requires attribution, though the credit is in each swatch's tooltip anyway.

**Formats were chosen by measurement, not by reputation.** Stills are AVIF q65
and clips are AV1 CRF 40, and both were picked by re-encoding the originals and
scoring the result against them:

| | before | after | quality |
|---|---|---|---|
| 3 clips | 15.21 MB H.264 CRF 26 | **4.70 MB** AV1 CRF 40 | SSIM up on all three |
| 5 stills | 2099 KB WebP q80 | **1620 KB** AVIF q65 | decode 0.69x, i.e. faster |

Both were smaller *and* better, which is not the usual shape of a codec
trade and is why they were worth measuring. Two levers that looked obvious and
measured out worthless: halving the clips' frame rate saved 11% for visibly
choppier motion, and downscaling to 1280 wide cost more quality than switching
codec saved. AV1's catch is decode support — H.264 has universal hardware
decode where AV1 wants roughly Intel 11th gen / RTX 30 / RDNA2 and falls back
to software below that. Contained because a live wallpaper is opt-in and pauses
when the tab is hidden. VP9 CRF 36 is the hedge at 8.29 MB with wider hardware
support.
Regenerate the files from their originals with
`python assets/make_backgrounds.py --images DIR --videos DIR`.

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
(Signature, Frosted, Thick lens, Barely there, Solid).

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

Writes `dist/cgt-<version>.zip` containing only what should ship —
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

> **Never give a file or folder a name starting with `_`, at any depth.**
> Chrome reserves those and will refuse to load the extension with
> *"Filenames starting with `_` are reserved for use by the system."*
> Only `_locales` and `_metadata` are allowed.
>
> This applies to the whole folder, not just to what ships. "Load unpacked"
> makes Chrome scan everything, so a file the zip excludes still breaks it — and
> excluded files are exactly the ones nothing else complains about. A stray
> `assets/__pycache__/`, created merely by *importing* one of the generator
> scripts, did it: `.gitignore` hides it so `git status` is clean, `package.py`
> excludes it so the zip is perfect, and the extension will not load at all.
> `check_unpacked_tree()` in `package.py` now walks the whole tree for this and
> refuses to build.

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
css/glass.css        the glass material + dock
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

**The wallpaper is painted before settings have loaded.** The stylesheet paints
`#wp-image`'s default gradient as soon as the document has layout, and which
wallpaper you chose lives in `chrome.storage`, which is asynchronous — so every
new tab had a window with the default gradient on screen and your wallpaper not
yet applied. That is the flash.

`localStorage` is synchronous on an extension page, so the last resolved
wallpaper is mirrored there and repainted at module-evaluation time in
`js/theme.js`, before `loadSettings()` is even called. Measured in the dev
harness it beat the async path by 2.4 ms, and that is a floor rather than the
real figure: the harness stubs `chrome.storage` with `localStorage`, where the
real one is IPC to the browser process.

`chrome.storage` stays the only source of truth. This is a cache,
`applyWallpaper` overwrites whatever it painted a few milliseconds later, and a
stale or missing entry costs nothing but the flash it existed to avoid. Nothing
comes back out of it as CSS either — only ids and a scheme name, each resolved
through the same registry lookup the live code uses, so the worst a tampered
entry can do is name something that does not exist.

It does not help a *cold* image. Setting `background-image` early starts the
fetch and decode earlier, but a packaged still on a cold cache still has to
decode before it can paint (measured at 57 ms for a 1920x1080 AVIF), so the
first new tab after a browser restart can still show the gradient briefly.
Gradients, which need no decode at all, are fixed outright.

**Nothing heavy runs at import or in `initTheme`** — with one deliberate
exception, the wallpaper repaint above. A localStorage read, a `JSON.parse` of
about sixty bytes and one style write is microseconds, and it is on the
critical path precisely because that path is what it fixes. The refraction map and the
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

**While a clip plays, the still layer shows the clip's own first frame.**
`#wp-video` sits above `#wp-image` at opacity 0 and only fades in once it has
decoded, so for that window — on every single new tab — the still layer is the
only thing on screen. Since a photo stays *stored* underneath a clip (so
turning the clip off restores it), painting it there made every new tab flash
an unrelated picture before the video arrived.

A packaged clip ships its own first frame as a poster,
`<id>.poster.avif`, 1280 wide for about 30 KB. The picker
thumbnail did this job first and was the wrong asset for it: 192x108 is right
for a 64px swatch and a 10x upscale at 1920 wide, so a live wallpaper opened on
a blurred smear that sharpened into video — which is what the flash still
looked like after the *content* was already correct. At 1280 the stand-in is a
1.5x upscale and the hand-off is invisible. A local or remote video has no
shipped frame and falls back to the gradient, which is still a better stand-in
than someone's photograph. If the video fails to load, the still layer is
repainted with the real wallpaper — otherwise a dead clip leaves its poster
stretched across the screen.

**Turning the visualiser off releases the audio capture.** `audio.stop()` is
otherwise only reached by a track ending or by picking *Simulated*, so
switching the widget off left the AudioContext open and, with System or Tab
audio, the capture still running — with Chrome's sharing indicator still up for
a widget that was no longer on screen. The teardown checks
`S.widgets.visualizer.on` before releasing, and that check is the whole point:
`rebuildWidgets()` tears every widget down whenever *any* widget is toggled,
and a capture cannot be restarted without a fresh user gesture, so an
unconditional stop would kill a running capture every time an unrelated widget
was switched on or off.

**<kbd>W</kbd> turns the live wallpaper off too.** Cycling only the layer
underneath a playing video changed nothing you could see, while still clearing
the photo selection and announcing a name in a toast — an inert key that quietly
threw a setting away.

**A photo is shown as it is; only video is dimmed by default.** The `Dim`
control under Live wallpaper darkens video so widgets stay readable over busy
footage, and it used to be applied to every layer unconditionally — so a photo
wallpaper arrived with a 25% black sheet over it, every pixel multiplied by
0.75, from a slider in a section about video. Photos now have their own **⚙ →
Look → Dim**, default 0. Turn it up if white widget text is hard to read over a
bright picture.

The ten gradients deliberately keep the old behaviour. They were designed,
shipped and screenshotted with that dim on them, and quietly brightening all
ten of them is not a bug fix.

**Packaged backgrounds are files, and that is the whole point.** A still is
`width × height × 4` bytes once decoded, and that number has nothing to do
with its file size — the 8301×5534 source in this set is 900 KB on disk and
175 MB decoded, the smallest file of the five and by far the largest in
memory. Three things follow, and `assets/make_backgrounds.py` exists to keep
all three true:

- **Crop to 16:9 before resizing, don't just scale.** They are drawn with
  `background-size: cover`, so on a 16:9 screen anything outside that crop is
  decoded and then discarded. One source is a 2268×4032 portrait: scaled to
  cover 1080p it is 1920×3413, of which 2333 rows are off screen. Cropping
  first is 7.9 MB decoded instead of 25 MB.
- **Ship them as packaged files, not through the IndexedDB blob path.** A
  packaged file has one URL and Chrome shares its decode across every open
  tab; `URL.createObjectURL` in `theme.js` runs per page, so the same picture
  loaded that way can cost its decode once per tab.
- **The picker draws separate thumbnails.** It shows every background at once,
  so pointing those swatches at the full-size files would decode ~8 MB apiece
  to fill a grid of 64px squares. `assets/bg/thumbs/` is 192×108, about 3 KB
  and 83 KB decoded each.

Clips are re-encoded at CRF 26 with their audio streams dropped. One source
arrived at 16.1 Mbps, which is broadcast-grade for something that plays
silently behind an 18px blur, and the `<video>` is muted and looping, so every
audio byte is weight in a package every user downloads.

**`background-size: 220px` on `#wp-grain` must match the tile.** Change one
without the other and the noise is resampled — coarser and blurrier.

**Big media never goes in the settings object.** `chrome.storage.local.set`
writes the whole object every time, and every control writes settings. A
wallpaper as a base64 data URL made one write cost 11.4 ms against 0.1 ms
without it, held 6 MB per open tab, and was re-serialised on every slider
frame. Images and videos live in IndexedDB (`js/media.js`); settings hold
`'local'`. `js/state.js` migrates any leftover data URL on load.

**The response cache is bounded, because a TTL is not an eviction policy.**
`cachedFetch` writes one `cache:` entry per key and its TTL only decides when a
value is *stale* — a key that is never requested again is never deleted. Fine
for weather and news, which reuse a handful of fixed keys; not fine for lyrics,
which key per track. Measured on a real LRCLIB response, one entry carried
~1,100 characters of `plainLyrics` plus ~2,200 of `syncedLyrics`, about 3.5 KB,
so twenty new tracks a day came to roughly 25 MB a year that only grew.

Two fixes, both measured. Only the fields the widget reads are cached now, and
the plain copy is dropped when synced lyrics exist: 3,769 → 2,399 bytes for a
`/get` entry (−36%), and 8,931 → 2,399 for a `/search` entry (−73%, because
that endpoint returns an array of candidates each carrying a full set of
lyrics, and only one of them is ever used). Then `background.js` prunes to the
400 newest `cache:` entries on its existing alarm — bounding the whole cache at
about 1 MB. The prune lives in the service worker because enumerating every
key is far too expensive to put near the new-tab path, and it sorts oldest
first so the entries the alarm just warmed are the last to go.

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

**Clamping recovers from intent on both axes, and a click is not a drag.**
Three separate things made a layout look scrambled after the window changed
size and changed back:

- Horizontal clamping measured from where a panel *currently* was, so it only
  ever pulled inward. Narrow the window and everything is shoved left; widen it
  again and it all stays there, because the position it was pushed away from was
  never written down. `dataset.ax` now records the intended x exactly as
  `dataset.ay` records the intended y, and clamping resolves from that.
- Nudging a centre-anchored panel cleared its `translateX(-50%)`, permanently
  un-centring the clock and the search bar the first time the window was too
  narrow for them. Centred panels are skipped horizontally instead — they
  overflow symmetrically, which keeps the part you read in the middle of the
  screen, and they recentre themselves the moment there is room.
- `pointerdown` on a panel converts it from centre-anchored to absolutely
  positioned so it can be dragged, and `pointerup` used to persist that
  unconditionally. Clicking a panel in edit mode without moving it therefore
  dropped its anchor and marked it `placed` — nothing moved, so there was
  nothing to see, and from then on the clock no longer recentred. Both writes
  are rolled back now unless the pointer actually travels more than 3px. The
  settings panel had the identical bug: one stray click on its header pinned it
  to an absolute pixel column for good.

**Widgets anchor to what they are nearest, and keep that distance in pixels.**
Positions are stored as percentages, and a percentage of the viewport is the
wrong thing to resolve them against on its own: widget heights are fixed
pixels, so the gaps between widgets stretch with the window while the widgets
do not. That is what made a resize look scrambled — some widgets tracked the
window, others got pushed and stopped tracking, and which was which changed
with the window height.

So each widget picks an anchor from whatever it sits closest to, and keeps its
gap to that:

| nearest thing | behaviour |
|---|---|
| the dock | keeps its gap above the dock, and follows it |
| a widget above it | keeps its gap below that widget, and follows it |
| the top of the screen | keeps its distance from the top |
| a side edge | keeps its distance from that edge, left or right |

Anchors are only ever chosen upward — to the dock, an edge, or a widget *above*
— so the graph has no cycles and one ordered pass resolves it.

**Top-or-dock is decided by the widget's top edge, not by the smaller gap.**
Comparing the two gaps sends every tall widget to the dock: the weather panel is
most of a column, so its bottom is near the dock however high its top starts,
and it would then slide downward on entering fullscreen while its top pulled
away from the top of the screen. Asking which half the top edge sits in gives
the answer you would give looking at it — that one starts up there, so it stays
up there.


A gap in pixels needs a size to have been measured at, so every widget records
the viewport it was arranged in (`vw`/`vh`, written on drop). Anything never
moved resolves against `CANON` in `config.js`. That is 1920x1080 rather than
something smaller because the default visualiser sits at x=74% and is 440px
wide, so it needs a 1786px viewport before it fits at all — resolving the
shipped defaults against a width they overflow pushed the right-hand column off
the edge before anything else had a chance to go wrong.
was arranged for. Measured, resizing 900 to 1080:

| widget | anchor | 900 | 1080 |
|---|---|---|---|
| weather | top | 72px | 72px |
| clock | top | 144px | 144px |
| news (placed near the dock) | dock | 36px above it | 36px above it |

Nothing stretches, and the widget by the dock follows the dock down.

**Resolved positions are written in pixels, divided by the panel's own zoom.**
The pass has already decided the exact position, and a percentage would be
re-resolved by the browser against the new viewport the moment it changes —
reintroducing the stretch between the resize and the next pass. Pixels hold
still until the pass corrects them.

But `left`/`top` resolve in the element's *zoomed* coordinate space, so a pixel
written raw gets multiplied by the zoom again on the way to the screen. At a fit
of 0.6 that put the whole layout in the top-left corner at 0.6x its intended
offsets — six overlapping widgets crammed into the top third of a 1080px window
— while percentages had been immune to this all along. It is the same trap as
`offsetWidth` versus `getBoundingClientRect` in the widget-size note above, and
a reminder that changing a unit can silently opt into it. The drag handler still
writes percentages, so the stored intent is unaffected either way.

**Fit considers width as well as height.** Three columns of fixed-width widgets
do not fit in a half-width window, and without the width term they kept their
full size and landed on each other. It is measured across the arrangement's
whole span rather than per widget, so the columns keep their proportions.


Layout runs on `resize`, on `fullscreenchange`, and on a `ResizeObserver`
watching the root element, because entering fullscreen and some window
managers do not always deliver a `resize` when you would expect one.

**Widgets are never scaled up, only shrunk to fit.** An earlier attempt scaled
with the window in both directions and keyed off *width*, which made a wide
short window bigger in the one dimension that had no room. Enlarging does not
suit every widget either — a bigger clock is fine, a bigger news list is just a
news list with fewer stories visible. **⚙ → Widgets → Shrink to fit** turns the
shrinking half on and off; anchoring runs either way.

**The dock shrinks with the widgets.** The fit factor is published as `--fit` on
`:root`, and `--dock-size` is multiplied by it in CSS while `dock.js` reads the
same value for its hover maths. A dock left at full size next to shrunk widgets
is the most obvious thing wrong with a squeezed layout.

The fit factor and a widget's own size are multiplied but never merged. The
stored size stays exactly what you set — folding the fit factor into it would
mean every resize silently rewrote your settings — so the resize grip solves in
stored-size space and divides the pointer delta back through the factor.

**Overlap resolution stays as a safety net.** Anchoring keeps the arrangement,
but a widget that grew since it was placed can still land on its neighbour, so
anything still colliding after anchoring is pushed clear.

**The settings panel remembers a ratio, not a column.** Its x is stored as a
fraction of the free space (0 flush left, 1 flush right), because an absolute x
is only correct at the width it was recorded at. Drag it near the right edge at
1280px and an absolute x of ~870 gets written down; press F11 and at 1920px that
column is nowhere near the right edge, so the panel appears stranded towards the
middle. A ratio keeps a right-docked panel docked right at every width, and
resize re-resolves it rather than just dragging the old column back on screen.

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

**Widget size is a CSS `zoom`, not a `transform: scale`.** Measured in Chrome,
with a control alongside that proves the test can actually see a broken
backdrop — a parent with `filter` or `opacity < 1` renders the glass flat, and
did in the same run:

- `zoom` is not a backdrop root, so a scaled panel still samples the wallpaper;
- a percentage `left`/`top` resolves to the same pixel zoomed or not, because
  the percentage is resolved in the element's own scaled space and scaled back.
  Measured, a centre-anchored clock at 100% and at 150% has its centre on the
  same pixel, so no stored position needs recomputing when the size changes;
- the layout box genuinely changes, so auto-height widgets keep sizing to
  their content and text is re-laid out rather than resampled.

`transform: scale` fails the last two: it grows about the panel's centre, which
walks a positioned panel off its anchor, and it leaves `offsetWidth` reporting
the unscaled box — which is exactly what the drag maths measures.

The catch to remember is that `offsetWidth`/`offsetHeight` are in the panel's
own pixels and ignore its zoom, while `getBoundingClientRect()` is in real
ones. Anything measuring a panel against the viewport has to multiply by the
zoom — the drag handler does. `clampPanel` already worked unchanged because it
measures with the rect. The visualiser's canvas has to fold the zoom into its
`devicePixelRatio` or the backing store keeps the 100% size and a scaled-up
spectrum is drawn small and stretched; it reads the zoom off the element rather
than out of settings, because the grip applies the zoom on every pointermove
and only writes the setting on release.

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

### Two background gotchas, if you go editing the wallpaper picker

> **A background image is positioned against the padding box but painted across
> the border box.** The swatches carry `border: 2px solid transparent` so that
> selecting one can just set `border-color`. With the default
> `background-repeat: repeat`, `cover` sized each image to the padding box and
> Chrome filled the leftover 2px ring by *tiling* it — so every unselected
> swatch showed a thin wrapped-around sliver of its own opposite edge, an image
> overlaid on the image. Selecting one hid the symptom, because the white border
> painted straight over the sliver, which is what made it confusing to spot.
> `background-origin: border-box` plus `no-repeat` leaves nothing to tile.

> **`background:` is a shorthand and resets every longhand it doesn't mention.**
> The gradient swatches set `style.background`, which silently put
> `background-origin` and `background-repeat` back to their initial values and
> undid the fix above for exactly those ten swatches. They set
> `style.backgroundImage` now. The same trap is why `applyWallpaper` in
> `js/theme.js` writes longhands rather than the shorthand.

### A note on the glass, if you go editing CSS

`.glass::before` carries `backdrop-filter`. Do not add `isolation: isolate`,
`mix-blend-mode`, `opacity < 1`, `filter`, or `contain: paint` to a `.glass`
element or any ancestor — each of those creates a **backdrop root**, which stops
the panel from sampling the wallpaper behind it and renders the glass as flat
grey. This is why the sheen layer avoids `mix-blend-mode` and the command
palette overlay has no blur of its own.
