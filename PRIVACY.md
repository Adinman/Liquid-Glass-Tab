# Privacy Policy — Liquid Glass Tab

_Last updated: 15 August 2026_

Liquid Glass Tab replaces Chrome's new tab page. This policy explains exactly
what it does with your data. The short version: **everything stays on your
computer, and the only network requests are the ones needed to render features
you turned on.**

---

## What is collected

**Nothing.** There is no analytics, no telemetry, no crash reporting, no
advertising identifier, no account, and no server operated by this extension.
The developer receives no data of any kind about you or your browsing.

## Where your data is stored

All of it locally, in your own browser:

| Data | Stored in | Leaves your machine? |
|---|---|---|
| Settings, layout, widget choices | `chrome.storage.local` | No |
| Notes, to-do list, focus-timer count | `chrome.storage.local` | No |
| Cached weather, news, crypto, lyrics | `chrome.storage.local` | No |
| Uploaded wallpaper image or video | IndexedDB (as a Blob) | No |
| Spotify access + refresh token | `chrome.storage.local` | Only back to Spotify |

Uninstalling the extension deletes all of it. **⚙ → Data → Factory reset**
clears settings on demand, and **Clear cache** drops the cached network data.

## Network requests

Requests are made **only** to the services behind features you are using. Turn
a widget off and it stops making requests entirely.

| Service | Why | What is sent |
|---|---|---|
| Open-Meteo | Weather forecast | Your coordinates (rounded), units |
| Open-Meteo Geocoding | City search | The city name you typed |
| ipapi.co / ipwho.is | Optional location detection | Your IP — **only** when you click *Detect* |
| Spotify | Now playing, playback control | Your OAuth token |
| LRCLIB | Synced lyrics | Artist, track title, duration |
| DuckDuckGo | Search suggestions | Your query as you type — **off-switch in ⚙ → Look** |
| CoinGecko | Crypto prices | Coin IDs only |
| RSS feeds you enable | Headlines | Nothing beyond the request itself |
| The bookmarked site | A sharper icon (`/apple-touch-icon.png`) | An ordinary image request |
| Google / DuckDuckGo icon services | A sharper icon, only when the site has none | The domain name |

Icon lookups happen at most **once per domain per 30 days**, and only in *Auto*
mode (when Chrome's own icon is too small) or *Always high-res*. Setting
**⚙ → Dock → Icon quality** to *Chrome only* stops them completely.

## Data the extension can read but does not transmit

Several permissions grant access to sensitive local data. It is read to render
the page and **never sent anywhere**:

- **Bookmarks** — to draw the dock and to search in the command palette.
- **Browsing history** — searched locally when you type in the command palette.
- **Open tabs** — listed in the palette and in the dock's "add bookmark" sheet.
- **Most-visited sites** — for the Speed dial widget.

None of this is uploaded, aggregated, profiled, or shared. It never leaves the
browser process.

## Audio capture

The visualizer can analyse audio from your microphone, another tab, or your
system output. Capture only ever starts from an explicit click, Chrome shows
its own sharing indicator throughout, and **the audio is analysed in memory for
drawing only** — never recorded, stored, or transmitted. Closing the tab ends
the capture.

## Third-party services

When the extension contacts a service above, that service's own privacy policy
applies to the request. The relevant ones are
[Spotify](https://www.spotify.com/legal/privacy-policy/),
[Open-Meteo](https://open-meteo.com/en/terms),
[LRCLIB](https://lrclib.net),
[CoinGecko](https://www.coingecko.com/en/privacy) and
[DuckDuckGo](https://duckduckgo.com/privacy).

## Children

The extension is not directed at children and collects no data from anyone.

## Changes

Any future change to this policy will be published with the extension update
that introduces it, and the date at the top will change.

## Contact

Questions or concerns: liquidglassdevs@proton.me
