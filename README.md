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

### Shortcuts, and changing them

**⚙ → Shortcuts.** Every keyboard shortcut, what it does, and what it is bound
to. Click one, press the keys you want, done. Backspace clears a shortcut,
Escape leaves it alone, and ↺ next to a changed one puts the default back.

| Action | Default |
|---|---|
| Command palette | <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd> |
| Jump to the search box | <kbd>/</kbd> |
| Open settings | <kbd>,</kbd> |
| Edit mode | <kbd>E</kbd> |
| Next wallpaper | <kbd>W</kbd> |
| Hide or show the dock | <kbd>B</kbd> |
| Open a private window | <kbd>I</kbd> |
| List these shortcuts | <kbd>?</kbd> |
| Next homescreen | *unbound* |
| Low performance mode | *unbound* |

**The last two ship with no key.** They are real actions — cycling homescreens
and the low performance toggle — that simply had no shortcut before, and an
empty default is a decision rather than an oversight: inventing a key for
something nobody asked for takes that key away from everyone, while leaving it
blank costs nothing and puts the choice with you. They show a **—** and do
nothing at all until you give them one.

**Any bookmark can go on a key too.** The same panel has a **Bookmark
shortcuts** group: pick one, give it a key, and it opens from anywhere. The
address is stored rather than the bookmark id, so renaming or moving it in
Chrome does not break the shortcut — though deleting the bookmark leaves the
shortcut pointing at the old address. Actions and bookmarks share one keyboard,
so the conflict check spans both: neither can quietly shadow the other, and
whichever holds a key is named when you try to take it.

**Any shortcut can be left unbound**, not just those two. **✕** clears one,
Backspace does the same while capturing, and **↺** puts the default back. An
unbound action disappears from the <kbd>?</kbd> list too, because that list is
built from what is actually bound.

**Only what you changed is stored.** An action you have never touched has no
entry at all, which is what lets a default change in a later version reach you
instead of pinning you to whatever it was the first time you opened this panel.
Setting a shortcut back to its default deletes the entry rather than writing it.

**Ctrl and ⌘ are one key here.** A binding records `mod`, not one or the other,
so a shortcut set on a Mac still works on Windows and the reverse. Shift is
different: on a bare key the character already carries it — <kbd>?</kbd> *is*
Shift+<kbd>/</kbd> — so recording it again would describe the same press twice.
Once Ctrl or Alt is held it goes back to being a real distinction, and
<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Y</kbd> is stored as itself rather than
being collapsed into <kbd>Ctrl</kbd>+<kbd>Y</kbd>.

**A shortcut without Ctrl or Alt is ignored while you are typing.** Otherwise
typing "web" into the search box would cycle the wallpaper and open a private
window on the way past. Modifier shortcuts still work in a text field, which is
why the command palette opens from anywhere.

**Escape, Tab, Enter, Space and the arrow keys cannot be bound.** They already
move focus and work the dock, so taking one would leave no way back — the panel
says which and why rather than silently refusing.

**A key can only do one thing.** Binding one that is already taken is refused
with a message naming what has it, rather than quietly stealing it and leaving
the other action dead.

**<kbd>?</kbd> lists whatever is actually bound.** It used to print a fixed
string, which was correct only for as long as the keys could not move.

### The focus timer is not fixed at 25/5/15

**⚙ → Data → Focus timer.** Focus, short break and long break, in minutes.
25/5/15 is one school of thought rather than a law — 52/17 and 45/15 have their
own followings — and it was baked in three times over, down to the numbers
printed on the timer's own buttons. Those buttons now read whatever you set.

**A change reaches a timer already on screen**, without rebuilding the widget,
because rebuilding would throw away a session that was counting down. The one
exception is that session itself: shorten it while it runs and the clock is not
moved under you, and the new length applies from the next one. Idle, the dial
follows immediately.

### The calendar knows which day your week starts on

**⚙ → Data → Calendar → Week starts on.** Automatic, Sunday, or Monday.
Automatic asks `Intl` what the interface language does, so Spanish and Russian
start Monday while English and Korean start Sunday, without anyone choosing.

It used to be Sunday for everyone — `first.getDay()` with no adjustment — which
is wrong in most of the world and in most of the eighteen languages this ships
in. The day initials were hardcoded English letters for all of them too; they
come from `Intl` now, in the interface language rather than the browser's, so a
Russian interface on an English browser gets ПВСЧПСВ and not SMTWTFS.

### Low performance mode

**⚙ → Glass → Low performance mode.** One switch, for machines the glass is too
much for. Panels turn solid instead of frosted, the background stops drifting, a
live wallpaper holds on its first frame, and the dock stops magnifying.

**It overrides, it never overwrites.** Blur, sheen, refraction, hover effect and
animated background are all left exactly as they were in settings — the mode
just stops honouring them while it is on, and they come back untouched the
moment you turn it off. The Glass tab says so in place, so sliders that
currently do nothing do not read as broken ones.

What it actually switches off, in the order the cost was found:

| | |
|---|---|
| **The drifting mesh** | Four blobs 46vw across under `filter: blur(70px)`, animating forever |
| **Panel backdrops** | `backdrop-filter` on every glass panel — 14 visible ones on a default layout |
| **Refraction** | The `feImage` + `feDisplacementMap` pass, per panel per frame |
| **The live wallpaper** | Never fetched or decoded at all — see below |
| **The dock's magnify loop** | A `requestAnimationFrame` loop writing a transform to every icon |
| **The visualiser** | Halved to 30fps rather than switched off — it is a widget you turned on |

**The mesh is first for a reason, and it is not the obvious one.** On its own it
is one full-screen blurred layer being recomposited. The real cost is
second-order: every panel's `backdrop-filter` samples whatever is behind it, so
a background that never stops moving forces all fourteen panels to re-run their
own blur every frame too. The two multiply. Stopping the drift is the largest
single saving and the cheapest to look at, because the mesh is still there — it
just holds still.

**A live wallpaper is never fetched, not merely paused.** `paintCachedWallpaper`
starts the clip at module load, deliberately, before settings have been read —
waiting for storage would leave the poster on screen through the read, the fetch
and the first decode. That is also why checking the setting inside
`applyVideoWallpaper` was not enough: by the time settings arrived the clip had
already been fetched, decoded and played, and the mode only stopped it a moment
later. On the machines this exists for, at the one moment they are busiest, that
was the whole cost and none of the saving. The flag now rides in the wallpaper
cache — the mechanism that already exists for deciding things before settings
load — so with the mode on the clip is never requested. The wallpaper still
looks like the clip, because the still layer is showing the clip's own first
frame either way.

**What it is not** is a reduced-motion setting. `prefers-reduced-motion` is
handled separately in `css/base.css` and answers a different question — one is
about what your machine can afford, the other about what you want to see move.
Transitions on interaction are kept here on purpose: removing them makes an
interface feel broken rather than fast.

### Search goes to your engine, not ours

Type a query and it goes to **whichever search engine Chrome is set to use** —
the one in Chrome's own settings, the one the address bar uses. CGT has no say
in it, cannot read it, and no longer offers a list of its own.

That is a deliberate reduction. Up to 1.3.0 the extension carried a table of six
engines and a picker in the search bar, and it navigated straight to the chosen
one's results page. Anyone whose Chrome was set to Kagi, Ecosia or a work
intranet still landed on Google, because a setting buried in a new tab page had
quietly overruled the browser's. The Web Store rejected 1.3.0 for it — an
extension may replace your new tab or change where your searches go, not both —
and they were right to. Engine choice did not disappear; it moved to the one
place that already governed every other search you make.

Under the hood this is
[`chrome.search.query`](https://developer.chrome.com/docs/extensions/reference/api/search),
which hands the text to Chrome and lets Chrome route it. Two consequences worth
knowing:

- **Typing an address still works and is not a search.** `github.com/pulls`
  navigates straight there, untouched — only text that isn't an address gets
  handed over.
- **To change engine, change it in Chrome** — Settings → Search engine. The box
  follows immediately.

### Private browsing

- **The ◐ button** in the search bar opens an empty private window.
- **<kbd>I</kbd>** does the same from anywhere on the page.
- **<kbd>Ctrl</kbd>+<kbd>Enter</kbd>** on a command-palette result — a bookmark,
  a history entry, an open tab — opens *that* privately. The palette lists
  *Open a private window* outright, and right-clicking a dock bookmark offers
  **Private**.

**A private *search* is gone, and cannot come back.** It worked by building a
results URL and opening it in an incognito window, which meant naming an engine
— exactly the thing above. `chrome.search.query` has no incognito disposition,
so there is no compliant way to carry a query into a private window. What
survives is the half that never needed an engine: one click to a private window,
where you can type whatever you were going to type.

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
the link, or delete it. Middle-click opens in a background tab.

**Pick a bookmark up and put it anywhere in the dock.** Press and drag along the
row and the icon lifts out of the glass; the others part around it as you go, so
the gap under the cursor is where it lands — including either end. Let go and it
is written back to Chrome's real bookmark store, so the new order is the one you
see in the bookmarks bar and on every other device you sync to.

It works the same on all four edges, dragging up and down when the dock is on a
side. A press that does not travel is still a click, so opening a bookmark is
unchanged.

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
tab: position, icon size, icon spacing, labels, auto-hide, max items, top-sites
append, source folder, and the icon quality/vibrancy/contrast controls. New
bookmarks go into whichever folder feeds the dock, so if you point it at a
different folder, **+** follows.

**Position** puts the dock on any of the four edges — bottom, top, **left** or
**right**. On a side the icons stack into a column and everything turns with
them: labels move beside the icon, the folder flyout opens sideways, the divider
becomes a horizontal rule, magnified icons grow inward from the wall, and the
arrow keys run up and down (all four still work either way). Auto-placed widgets
keep clear of whichever edge it is on.

The magnification is written against the dock's own axis rather than against the
screen's, so left and right are the same code with the axes swapped rather than
a second implementation of the same effect.

**Auto-hide** slides the dock off-screen until you push the cursor into a 26px
strip along that edge — which, on a side dock, is a full-height strip down it.

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

### Arcade

**⚙ → Arcade.** Three games, drawn on a canvas that sits in the wallpaper stack
— above the colour blobs, below the grain and vignette — so you play on your own
wallpaper rather than on a blank screen.

| | What it is | Controls | Scored on |
|---|---|---|---|
| **Game 1** | Clear a grid of mines. Clicking a satisfied number opens its remaining neighbours | Left-click reveals, **right-click flags** | Best **time**, on a win only, per size |
| **Game 2** | Eat, grow, and don't bite yourself. It speeds up as you go | Arrow keys or WASD | Best **score**, per map size |
| **Game 3** | Rally against the computer, or against someone sitting next to you | <kbd>↑</kbd> <kbd>↓</kbd> or W/S; in two-player, **W/S** and **↑ ↓** | Best **rally**, per opponent |

**Games 1 and 2 have three sizes each**, picked on a panel beside the board
**while you are playing** — not in settings. Difficulty is something you change
between rounds: you finish a board, decide it was too easy, and want the next
one bigger. Leaving the game to open a settings tab to restart the thing you are
looking at is the wrong shape for that. Click a row and it deals a fresh game at
that size.

Game 1 calls them **difficulty**, because that is what changes:

| | Board | Mines |
|---|---|---|
| Easy | 9×9 | 10 |
| Medium | 16×16 | 40 |
| Hard | 30×16 | 99 |

Those are the sizes this genre settled on decades ago; inventing our own would
make every time incomparable for no gain.

Game 2 calls them **map size**, because that is what changes — the map, not the
speed. They run smallest to largest, which is the order a size list should be
in; a smaller board *is* harder, but labelling it "Hard" put the list in
descending order of size and read backwards.

| | Board |
|---|---|
| Small | 16×11 |
| Medium | 24×16 |
| Large | 32×20 |

**Each level keeps its own record.** A time on 9×9 and a time on 30×16 are not
the same achievement, and there is only one number per key. The panel shows all
three at once so the two you are not playing don't disappear, and **⚙ → Arcade**
lists them too. The panel reserves its width out of the court rather than
floating over the board — an overlapping click target on a minesweeper is a cell
you can see but cannot open.

They are named by number on purpose. Each is a version of a game somebody else
invented, and putting those names in a store listing invites a complaint that
isn't worth having. Each card in the picker shows a still drawn by the game
itself, which is also what tells you which is which.

Starting one fades the widgets and dock to 7% so you are not playing through a
news feed, and takes them out of reach entirely — not just click-through but
`inert`, so a stray click lands on the game rather than a bookmark and Tab can't
walk into a dock you cannot see. (`pointer-events: none` on the dock's container
was not enough on its own: the dock re-enables pointer events on itself, which
is how auto-hide works, and a parent's `none` does not beat a child's `auto`.)
**Esc** leaves at any point and your record is kept.
The settings drawer and the command palette still open over a running game, and
Escape closes those first — the game only takes the key when nothing else wants
it.

**Records are read live, never snapshotted at the start of a game.** A copy
taken then goes stale with nothing to correct it, so a tab that opened a game
while the record was 0 would still believe that after another tab had set it to
30, and a run of 1 would beat its own stale copy and overwrite the real record.
Game 1 is also the one game where **lower is better**, which the score code is
told explicitly rather than inferring — a single `>` would have quietly refused
to record any win after the first.

**Game 1's first click is always safe.** Without that, roughly one game in eight
is over before it has started, which reads as the game being broken rather than
as bad luck. The mine under the first cell is moved elsewhere rather than the
board being regenerated, so the count stays exactly right. The board is a fixed
size rather than one that scales with the window, because a 30×16 board and a
9×9 board are not the same game and there is only one number to store; the
*cells* scale instead.

**Game 2's head faces where it is going** — pushed forward out of its cell, with
white eyes set toward the front and the pupils at the leading edge. That matters
most at the moment it stops mattering to the game: when you have just died and
are looking at a still frame working out what happened. Two dark dots barely off
centre, on a body of one flat colour, left the head indistinguishable from the
tail.

**Game 3 has a second player.** Pick the opponent on the same panel the other
two games use for their size — **Computer** or **Friend**. Against a friend the
left bat is **W/S** and the right is **↑ ↓**, which is the split the keyboard
already gives two people sitting at it. There is no online mode and none is
planned; this is two people at one desk.

The two opponents score differently, because they are not the same game. Alone
it stays an endless rally: one number that can always go up, which is what makes
an all-time best worth chasing. Two people want to beat each other rather than a
number, so that is a match to seven, and what it files as a record is the
**longest rally of the match** — a measure of the two of you rather than of one.
The records are kept apart for the same reason: a rally against the computer
tests your reflexes, a rally against a person tests both of yours, and one
number for both would mean neither.

**Game 2 is drawn as one connected body**, stroked along the cell centres with
round joins rather than one rounded square per cell — the per-cell version left
a seam at every join and a stack of separate tiles at a corner, so it read as a
queue of blocks rather than one animal. Its board is a checkerboard rather than
a hairline grid: 1px lines at 5.5% white were very close to invisible on a
bright wallpaper, and knowing how far the next cell is is most of what makes the
game readable.

**Game 2 moves on a fixed tick, not per frame.** Tying movement to the frame
rate would make it about twice as hard on a 144 Hz monitor as on a 60 Hz one.
Measured time-to-wall: 1433 ms at 60 Hz, 1430 ms at 144 Hz, 1433 ms at 30 Hz.
Turns are queued rather than applied immediately, so a fast two-key corner does
what you meant instead of dropping one of the presses.

Nothing runs unless a game is running: the loop is cancelled outright — not
merely early-returned — when the tab is hidden or no game is on, and the canvas
backing store is freed to zero rather than merely hidden. The game code is
imported the first time you open the Arcade tab or start a game, so a tab
belonging to somebody who never plays never loads any of it.

**Reduced motion is deliberately not consulted here.** A game is not decoration
— it doesn't start until you press a button, and freezing it would be a broken
game rather than a calmer page.

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

### Language

**⚙ → Look → Language.** The interface speaks Spanish, Hindi, Indonesian,
Korean, Russian and Simplified Chinese, as well as English. It defaults to
**Auto**, which follows your browser — it walks `navigator.languages` in
preference order and takes the first one there is a catalogue for, rather than
only looking at the first entry.

Everything the app writes is translated: the settings drawer, every widget
(headers, greetings, weather descriptions, the focus timer, the Spotify and
lyrics states), the dock, the arcade, and the toasts.

Each language is written to be **friendly and respectful**, which for several of
them is a real decision rather than a default:

| | Register |
|---|---|
| **한국어** | 해요체 throughout — the polite everyday form for someone older than you. Not 반말, and not 하십시오체, which reads like an airport announcement |
| **Español** | Infinitives for actions (*Buscar ajustes…*), which is what Spanish interfaces do and which avoids answering tú/usted wrongly for half the Spanish-speaking world. Vocabulary neutral between Spain and Latin America |
| **हिन्दी** | आप and -करें forms; never तुम |
| **Русский** | Infinitives and impersonal confirmations — no ты, and no canned «Вы» in every line |
| **简体中文** | 请 for requests, neutral statements for confirmations |
| **Bahasa Indonesia** | Plain verbs, avoiding both over-familiar *kamu* and stiff repeated *Anda* |

**The English text is the key.** `t('Backdrop blur')` looks that string up and
hands back the original if it is missing, so the code still reads as what it
renders, there is no English catalogue to keep in step, and an untranslated
string degrades to English rather than to a blank label or a raw
`settings.glass.blur` on screen. Proper nouns that should not be translated —
`Client ID`, `Redirect URI` — simply have no entry.

Two traps this shape avoids, both of which bit during the work:

- **Module-level tables cannot be translated where they are declared.** The
  weather-code table and the widget definitions are evaluated at import time,
  long before a catalogue is loaded, so translating them in place would freeze
  whichever language happened to be active then. They stay English and are
  translated at the point of use.
- **Static markup needs its key kept separately.** The settings header and the
  search box carry a `data-i18n` attribute holding the English, because after
  one language switch the element itself holds Korean — and translating
  Korean-as-a-key finds nothing.

Catalogues are loaded on demand, so a tab running in English fetches none of
them. Adding a language is two files: `js/locales/<id>.js` and one line in
`js/locales/index.js`. `package.py` fails the build if a language is listed
without its catalogue.

Chrome's own `_locales` mechanism is deliberately not used: it supports only a
fixed list of locales — which excludes most Indian languages — and it ties the
interface language to the browser's, so nobody could choose Korean on an
English Chrome.

### Searching settings

There are eight tabs, which is enough that "which tab is the blur slider on" is
a real question. The box above the tabs searches **all of them at once** —
filtering only the tab you are already looking at would help just once you had
found the right tab, which is the hard part.

Each result says where it came from, as **Tab › Group**, and the tab name is a
link: click it to leave the search and land on that tab. The controls in the
results are the real ones, not copies, so you can change a setting without
going anywhere. <kbd>Esc</kbd> clears the search; a second <kbd>Esc</kbd>
closes the drawer.

It matches rendered text rather than a list of setting names, which has two
consequences worth knowing. Partial words work — `brig` finds Brightness. And
the text *inside* a control counts, so searching `fahrenheit` finds Units even
though the row is called Temperature. Searching a tab's own name — `weather`,
`music` — hands back that whole tab.

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

The **arcade** is the deliberate exception: a game only runs because you started
it, so it is left alone.

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

**These are the defaults.** Every one of them can be changed in
**⚙ → Shortcuts** — see [Shortcuts, and changing them](#shortcuts-and-changing-them).
Press <kbd>?</kbd> at any time for the list as it currently stands, which is
built from what is actually bound rather than from this table.

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
| Your own search engine | The search itself | Handled by Chrome, which sends the query wherever you have told it to |
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
js/dock.js           bookmark dock + bulk bookmark import
js/palette.js        command palette
js/settings.js       settings drawer
js/arcade.js         the game host: canvas, loop, input
js/games/            one module per game
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

**The stylesheet's own default was the flash.** `js/app.js` is
`type="module"`, which is deferred: the browser parses the HTML, applies the
stylesheet and is free to paint before a line of it runs. So `#wp-image`
painted its stylesheet default — a blue/purple gradient, which is exactly what
"it flashes the preset colours" describes — and nothing done *inside* a module
could prevent that, because the paint had already happened. Three attempts at
doing it earlier in the module chain all missed for this reason.

`early.js` is a classic script with a `src` and no `defer`/`async`, so it
blocks parsing and runs before the body exists — measured: `readyState`
"loading", `document.body` null, `#wp-image` not yet created. It sets
`--wp-first`, which `css/base.css` uses as `#wp-image`'s background, so the
element has the right wallpaper from the moment it exists. It also sets
`data-wp`, `--mesh-op`, `--wp-dim` and the scheme, for the same reason.

It cannot import `config.js` — modules are the thing being avoided — so
`rememberWallpaper` writes the already-resolved filename or gradient and
`early.js` validates it against a tight pattern before it reaches a `url()`.
Keep it small: it is render-blocking, and anything slow in it delays the paint
it exists to fix.

A brand-new profile has nothing cached and still gets the stylesheet gradient
once, which is the correct answer for a first run.

`localStorage` is synchronous on an extension page, so the last resolved
wallpaper is mirrored there and repainted at module-evaluation time in
`js/theme.js`, before `loadSettings()` is even called. Measured in the dev
harness it beat the async path by 2.4 ms, and that is a floor rather than the
real figure: the harness stubs `chrome.storage` with `localStorage`, where the
real one is IPC to the browser process.

The layer state goes in the cache too, and that turned out to be the flash
people actually saw. `#wp-mesh` is four 46vw colour blobs under a 70px blur
drifting at 85% opacity, and the only thing that hides them is
`:root[data-wp="custom"|"video"]` — an attribute set inside `applyWallpaper`,
after the settings read. So every new tab opened with a full-screen wash of
blue, purple, teal and pink on top of the wallpaper until storage came back.
Measured at 39 ms in the dev harness, and that is the floor again. Painting the
correct wallpaper early did nothing for it, because the blobs are a layer above
it — three separate fixes to the layer underneath changed nothing anyone could
see, which is a good argument for measuring which element is on screen rather
than reasoning about which one ought to be.

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

**An uploaded image gets the same treatment, for the same reason.** It lives in
IndexedDB, which cannot be read before the first paint, so `early.js` had
nothing to show and fell back to the gradient underneath — every new tab flashed
a colour preset on a wallpaper the user had explicitly replaced with a
photograph. A downscaled WebP copy now goes into `localStorage` alongside the
video poster, `early.js` paints that, and the full image replaces it from
IndexedDB a few milliseconds later. The copy is cleared whenever the stored
image is replaced or deleted, so a present one always belongs to the image
actually showing.

A **remote image URL** had a worse version of the same bug: it was cached, but
`early.js` had no branch for it at all, so the first paint was the stylesheet's
own default — a gradient the user had never chosen. It now paints the URL,
matched against a pattern deliberately narrower than "a URL": the value is
interpolated into `url("…")`, so a quote, backslash, parenthesis or space could
close the function and inject a further declaration.

The cache also carries the gradient underneath as a last resort now. Every
specific source above can come up empty on a given tab — a thumbnail not
captured yet, a URL that fails its check — and without a fallback `early.js`
lands on the stylesheet default, which is the one wallpaper that is certainly
wrong.

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
1.5x upscale and the hand-off is invisible. An uploaded video gets the same treatment without shipping anything: the first
frame is grabbed from the wallpaper `<video>` itself the moment it decodes — no
second element and no second decode — and kept as a WebP data URL in
localStorage, around 50 KB. localStorage rather than IndexedDB because the
whole point is to paint it before anything asynchronous has run. It is keyed by
`wallpaperVideoName`, which carries the file's name and size, so choosing a
different video falls back to the gradient and then re-captures rather than
showing the previous video's frame over the new one. Removing the video removes
it. A remote video URL still falls back to the gradient — the frame cannot be
read back off a cross-origin video. If the video fails to load, the still layer is
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

**The settings panel remembers a position, never a size.** The stylesheet pins
both edges (`top: 14px; bottom: 14px`) so it spans the screen, and dragging it
used to replace that with `bottom: auto` and an explicit height taken from the
drag. There is no resize handle, so that height was only ever "whatever it
happened to be when you last moved it" — frozen for good, and on a taller
screen, most obviously in fullscreen, the panel then stopped short of the
bottom. Height is left to the stylesheet now; it is frozen for the duration of
a drag only, so the panel does not resize under the cursor. Measured: a dragged
panel is 742px tall in an 800px window and 1022px in a 1080px one, 14px clear
of the bottom in both.

Entries written by older versions still carry an `h`, and it is ignored rather
than rejected — `sanitize` had required `h > 120`, which would have quietly
wiped every stored position once the field stopped being written.

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
