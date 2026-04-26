# Magnetar

A browser extension that detects torrent info hashes on any webpage and sends them to your preferred download service in one click. It also includes a built in popup and redirect blocker.

Magnetar replaces and supersedes four earlier extensions: [audiobookbay-magnet](https://github.com/ArrCee76/audiobookbay-magnet), [torrent-to-realdebrid](https://github.com/ArrCee76/torrent-to-realdebrid), [torrent-to-rdtclient](https://github.com/ArrCee76/torrent-to-rdtclient), and [site-blocker](https://github.com/ArrCee76/site-blocker).

Available for Chrome, Edge, Opera, Brave, and Firefox.

## Highlights

* Universal info hash detection that works on any site without a hardcoded list
* Six download backends: Real-Debrid, AllDebrid, Premiumize, TorBox, RDT Client, and a passthrough mode for local clients
* Save for later queue that lets you bookmark torrents and send them in your own time
* Batch panel for multi-torrent listing pages with sorting, per-row actions, and a slide-out drawer for stats and history
* Magnetar Shield, a network-level popup and redirect blocker with a curated default list
* Tiered cache layer that cuts repeat API calls to your provider by an order of magnitude
* Light and dark themes that switch live across every surface, no page refresh required
* Full localisation across eleven languages with auto-detection from the browser locale

## Download modes

| Mode | Notes |
|---|---|
| Real-Debrid | Cloud downloading with cache pre-check via probe-add-then-delete |
| AllDebrid | Cloud downloading with native cache lookup |
| Premiumize | Cloud storage and downloader with native cache lookup |
| TorBox | Cloud downloading with native cache lookup |
| RDT Client | Self-hosted Real-Debrid proxy with category routing and optional cache pass-through |
| Local client | Hands the magnet URI to your operating system's default handler (qBittorrent, Deluge, Transmission, etc.) |

## Installation

### Chrome, Edge, Opera, Brave

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/magnetar/cllbehlfiahgijdojkopgnnmcoenhlla).

To install a development build:

1. Download or clone this repository
2. Visit `chrome://extensions`
3. Enable Developer mode
4. Click Load unpacked
5. Select the `chrome/` folder

### Firefox

Install from [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/magnetar/).

To install a development build:

1. Download or clone this repository
2. Visit `about:debugging#/runtime/this-firefox`
3. Click Load Temporary Add-on
4. Select any file inside the `firefox/` folder

## First run

On first install, the onboarding wizard opens automatically and walks you through three steps:

1. Pick your download mode and enter your credentials
2. Choose detection preferences such as batch mode, banner style, banner position, and Shield
3. Review the sites Magnetar is best known to work on

All choices can be revised later from the extension options page.

## Detection pipeline

Magnetar runs a six layer detection pipeline on every page:

1. Custom site rules, your own CSS selectors or regex patterns
2. Magnet link scan, finds `magnet:` URIs in the document
3. Labelled hash scan, looks for "Info Hash:" and similar labels
4. Structured data scan, checks `data-` attributes and hidden inputs
5. Broad regex sweep, matches hex and Base32 hash patterns in page text
6. Confidence scoring, verifies torrent context before showing the banner

Non-torrent pages bail out in under a millisecond. Common destinations such as GitHub, Google, Reddit, and major banking portals are excluded from detection entirely to avoid false positives.

### Supported hash formats

* SHA-1 hashes (40 hex characters)
* SHA-256 hashes (64 hex characters, BitTorrent v2)
* Base32 encoded hashes
* Magnet URIs
* Hashes inside data attributes, hidden form fields, or labelled text

## Banner

When a hash is detected on a single torrent page, Magnetar surfaces a banner with the following actions:

* **Send to {provider}**, the primary action, fires the magnet at your configured backend
* **Share**, opens a context menu with copy, email, and social share options. The menu auto-flips above the button when there is no room below
* **Copy magnet** and **Copy hash**, single-click clipboard utilities
* **Save**, adds the torrent to your queue without sending. The button switches to a green Saved state once persisted
* **Cache status pill**, shows whether the torrent is cached on your provider. Reserves a fixed minimum width so the row does not reflow when the state transitions
* **Theme toggle**, **Settings cog**, and **Dismiss**, all on the title row
* **Expand chevron**, opens the in-banner dashboard described below

### Expanded view

The expanded banner shows three statistics cards (sends all-time, cache hit rate over the last thirty sends, sites blocked by Shield), the saved-for-later queue, and recent activity. Both the saved list and the activity list cap at four visible rows and scroll if longer, so the expanded view never grows unbounded.

Each saved row carries Share, Copy magnet, Send, and Remove actions. Send promotes the torrent to history. Share and Copy do not modify the queue.

## Save for later

Found something interesting but not ready to fire it off yet? Hit Save and Magnetar persists it in `chrome.storage.local`. The queue survives browser restarts and is shared across the banner expanded view, the batch drawer, and any future surface. Capacity is capped at five hundred entries, oldest first.

## Batch panel

When a listing page contains multiple torrents, Magnetar displays a batch panel instead of a per-torrent banner. The panel offers:

* Sort by name, seeders, or file size
* A 25, 50, or 75 toggle for the maximum number of detected torrents to display per page. The choice persists across sessions
* Per-row actions: select for batch send, save for later, or open share menu
* A bulk send progress bar tracking each item
* A drawer that slides out to the left, mirroring the banner's expanded view, with stats cards, the saved queue, and recent activity

Cache checks for batch rows are throttled to four concurrent in-flight requests so the provider is not flooded when twenty-five torrents are detected at once.

## Magnetar Shield

A built-in popup and redirect blocker that stops adversarial sites from loading.

* Right click any page and choose "Block this site with Magnetar"
* Right click again to unblock
* Manage your blocklist from the popup or the settings page
* Import or export blocklists as JSON to share with others
* Ships with a small default blocklist of common torrent-site popup domains

On Chromium browsers, Shield uses `declarativeNetRequest` for efficient network-level blocking. On Firefox, Shield closes blocked tabs via `webNavigation` before the page renders.

## Cache store

A tiered cache layer sits between the UI and your provider:

1. An in-memory LRU keyed by `(provider, hash)`, capped at five hundred entries, lives with the service worker
2. A persistent `chrome.storage.local` tier capped at two thousand entries with debounced writes, surviving service worker restarts
3. An in-flight promise dedup so concurrent callers for the same hash share one network round trip

Time-to-live is status aware. Cached results are valid for twenty four hours, not-cached results for five minutes since torrents can become cached over time, and unknown results are never persisted. Successful sends seed the cache with a `cached` entry immediately, skipping a probe the next time someone views the same torrent.

The cache is flushed automatically when the active mode or its credentials change, so a rotated API key never serves stale results.

## History

Magnetar keeps a local download history of everything sent through the extension. Entries record the torrent name, info hash, provider, category, source URL, and timestamp. The history is capped at five hundred entries.

The settings page exposes search, JSON export, and CSV export.

## Localisation

The extension auto-detects the browser locale and switches strings accordingly. Eleven languages are bundled:

English, Swedish, French, German, Russian, Italian, Spanish, Danish, Romanian, Lithuanian, and Czech.

A small number of recently added strings (the saved-for-later UI, the review prompt, and What's New copy) currently render in English regardless of locale and will be backfilled in a future release.

## Architecture

Magnetar is built as a Manifest V3 extension on Chromium and Manifest V2 on Firefox. The two manifests share an identical content script and library layer; only the manifest, background entry point, and Shield strategy differ between them.

```
.
+-- background.js              service worker / persistent background
+-- content.js                 banner, batch panel, share menu, save flow
+-- options.html / .js / .css  settings UI, history viewer, Shield manager
+-- popup.html  / .js / .css   toolbar popup
+-- onboarding.* / whatsnew.*  first-run and post-update walkthroughs
+-- lib/
|   +-- detector.js            six-layer detection pipeline
|   +-- categories.js          per-mode category mapping
|   +-- shield.js              blocklist storage and DNR rule generator
|   +-- cache-store.js         tiered cache with TTL and in-flight dedup
|   +-- providers/
|       +-- local.js
|       +-- realdebrid.js
|       +-- rdtclient.js
|       +-- torbox.js
|       +-- premiumize.js
|       +-- alldebrid.js
+-- icons/                     16, 48, 128 plus state variants
+-- _locales/                  cs, da, de, en, es, fr, it, lt, ro, ru, sv
```

### Provider interface

Each provider in `lib/providers/` exports three functions with a uniform signature:

```js
async function validateCredentials(creds) { ... }
async function sendMagnet(magnetUri, creds, opts) { ... }
async function checkCache(hash, creds) { ... }
```

Adding support for a new service involves creating a new file in `lib/providers/`, registering it in the mode selector in options, and adding a credentials form fragment. No other code changes are required.

### Storage layout

| Key | Tier | Contents |
|---|---|---|
| `magnetar` | sync | Mode, credentials, preferences, custom site rules |
| `magnetar-history` | local | Send history, capped at 500 |
| `magnetar-saved` | local | Save-for-later queue, capped at 500 |
| `magnetar-send-count` | local | Total sends, used for review prompt threshold |
| `magnetar-cache-store` | local | Tiered cache persistence, capped at 2000 |
| `shield` | local | Domain blocklist |
| `magnetar-review-dismissed` | local | Boolean, set after rate, coffee, or dismiss |
| `magnetar-whatsnew-shown` | local | Last seen version for the changelog popup |

## Privacy

See [PRIVACY.md](PRIVACY.md) for the full policy. In summary: Magnetar runs entirely in your browser. No analytics, no telemetry, no data collection. Network requests reach only the provider you have configured.

## Contributing

Issues and pull requests are welcome at [github.com/ArrCee76/magnetar](https://github.com/ArrCee76/magnetar).

If you have written a custom site rule that handles a specific torrent index well, please consider sharing it as a JSON snippet in the Issues section so it can be added to the default ruleset.

## Support

If Magnetar saves you time, consider [buying me a coffee](https://buymeacoffee.com/arrcee76) or leaving a review on the [Chrome Web Store](https://chromewebstore.google.com/detail/magnetar/cllbehlfiahgijdojkopgnnmcoenhlla) or [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/magnetar/).

## Built with

Vanilla JavaScript, no runtime dependencies. The codebase was developed in collaboration with Anthropic's Claude, used as a pair-programmer for code review, refactor planning, and design iteration.

## Licence

MIT. See [LICENSE](LICENSE) for the full text.

## Author

[ArrCee76](https://github.com/ArrCee76)
