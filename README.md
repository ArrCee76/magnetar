# ✦ Magnetar

**Grab torrents, send them anywhere.**

A browser extension that detects torrent info hashes on any webpage and sends them to your preferred download service in one click. Built-in popup blocker included.

## Features

- **Universal hash detection** — works on any site with a torrent hash or magnet link. No hardcoded site list.
- **Four download modes** — Local torrent client, Real-Debrid, RDT Client (self-hosted), or TorBox.
- **Cache checking** — for Real-Debrid and TorBox, shows instantly whether a torrent is cached before you send it.
- **Magnetar Shield** — blocks unwanted popup and redirect sites at the network level. Right-click any page to block it.
- **Custom site rules** — define your own hash detection patterns for niche sites.
- **Privacy first** — runs entirely in your browser. No analytics, no tracking, no data collection.

## Installation

### Chrome / Edge / Opera / Brave

1. Download or clone this repository
2. Open `chrome://extensions` (or the equivalent for your browser)
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked**
5. Select the `chrome/` folder

### Firefox

1. Download or clone this repository
2. Open `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on**
4. Select any file inside the `firefox/` folder

> **Permanent Firefox install:** Temporary add-ons are removed on restart. For permanent installation, the extension will be available on [addons.mozilla.org](https://addons.mozilla.org) once published.

## Setup

On first install, the settings page opens automatically.

1. **Pick your mode** — click one of the four cards (Local Client, Real-Debrid, RDT Client, TorBox)
2. **Enter credentials** — paste your API key or server details (not needed for Local Client mode)
3. **Click Save & Test** — validates your connection

That's it. Browse any torrent site and the Magnetar banner will appear when a hash is detected.

## How It Works

Magnetar runs a six-layer detection pipeline on every page:

1. **Custom site rules** — your own CSS selectors or regex patterns
2. **Magnet link scan** — finds `magnet:` URIs in the page
3. **Labelled hash scan** — looks for "Info Hash:" and similar labels
4. **Structured data scan** — checks `data-` attributes and hidden inputs
5. **Broad regex sweep** — matches hex/Base32 hash patterns
6. **Confidence scoring** — verifies torrent context before showing the banner

Non-torrent pages are skipped in ~1ms. Zero performance impact on normal browsing.

## Magnetar Shield

Built-in popup/redirect blocker that stops annoying sites from ever loading.

- **Right-click → "Block this site with Magnetar"** to add any site to the blocklist
- **Right-click → "Unblock this site"** to remove it
- Manage your blocklist from the extension popup or settings page
- Import/export blocklists as JSON to share with others

## Supported Sites

Magnetar isn't limited to a list of sites. If a page has a torrent hash in any common format, Magnetar finds it:

- SHA-1 hashes (40 hex characters)
- SHA-256 hashes (64 hex characters, BitTorrent v2)
- Base32 encoded hashes
- Magnet URIs
- Hashes in data attributes, hidden fields, or labelled text

Tested on AudioBookBay, The Pirate Bay, 1337x, RARBG mirrors, and many more.

## Privacy

This extension runs entirely in your browser. Credentials are stored in your browser's extension storage and are only sent to the services you configure:

- **Local Client mode** — no external requests
- **Real-Debrid mode** — requests to `api.real-debrid.com` only
- **RDT Client mode** — requests to your own server only
- **TorBox mode** — requests to `api.torbox.app` only

No analytics. No tracking. No third-party services. Fully open source.

## Contributing

Issues and pull requests welcome. If you have a custom site rule that works well for a specific torrent site, consider sharing it as a JSON snippet in the Issues.

## Licence

MIT

## Author

[ArrCee76](https://github.com/ArrCee76)

---

*Magnetar supersedes [audiobookbay-magnet](https://github.com/ArrCee76/audiobookbay-magnet), [torrent-to-realdebrid](https://github.com/ArrCee76/torrent-to-realdebrid), [torrent-to-rdtclient](https://github.com/ArrCee76/torrent-to-rdtclient), and [site-blocker](https://github.com/ArrCee76/site-blocker) — all unified into a single extension.*
