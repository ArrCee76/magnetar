# Magnetar

**Grab torrents, send them anywhere.**

Magnetar is a browser extension that detects torrent info hashes on any webpage and sends them to your preferred download service in one click. It also includes a built-in popup and redirect blocker.

It replaces four separate extensions ([audiobookbay-magnet](https://github.com/ArrCee76/audiobookbay-magnet), [torrent-to-realdebrid](https://github.com/ArrCee76/torrent-to-realdebrid), [torrent-to-rdtclient](https://github.com/ArrCee76/torrent-to-rdtclient), and [site-blocker](https://github.com/ArrCee76/site-blocker)) under one extension.

Works on Chrome, Edge, Opera, Brave, and Firefox.

## Features

**Universal hash detection** that works on any site displaying a torrent hash or magnet link. No hardcoded site list. If there's a hash on the page, Magnetar finds it.

**Six download modes:**

- **Real-Debrid** - cloud downloading with cache checking
- **AllDebrid** - high-speed cloud downloading
- **Premiumize** - cloud storage and downloader
- **TorBox** - cloud downloading with cache checking
- **RDT Client** - self-hosted Real-Debrid proxy with category routing
- **Local torrent client** - qBittorrent, Deluge, Transmission, etc.

**Batch processing** detects multiple hashes on a single page and shows them in a structured panel. Sort by name, seeders, or file size. Select exactly what you want and send them to your provider in one go. Perfect for grabbing entire seasons or collections. Progress bar tracks bulk sends.

**Right-click send** lets you right-click any magnet link on any page and send it directly to your configured service without needing the banner.

**Duplicate detection** checks your download history before showing the banner. If you've already sent a torrent, it shows a "Sent" badge so you don't grab the same thing twice.

**Download history** keeps track of everything you've sent through Magnetar. Export as JSON or CSV from the settings page.

**Dark and light theme** toggle in settings. Light theme covers the settings page, banner, batch panel, and all injected UI elements.

**Onboarding wizard** guides new users through a 3-step setup: choose your client, configure detection preferences, and see which sites Magnetar works best with.

**What's New page** opens automatically after updates to show what's changed.

**11 languages** supported: English, Swedish, French, German, Russian, Italian, Spanish, Danish, Romanian, Lithuanian, and Czech. The extension auto-detects your browser language.

**Cache checking** for supported providers shows whether a torrent is already cached before you send it, so you know instantly if it'll download fast.

**Magnetar Shield** blocks unwanted popup and redirect sites at the network level before they even load. Right-click any page to add it to the blocklist.

**Custom site rules** let you define your own CSS selectors or regex patterns for niche sites that don't use standard hash formats.

**Privacy first.** Everything runs locally in your browser. Credentials are stored in browser extension storage and only sent to the services you configure. No analytics, no tracking, no data collection.

## Installation

### Chrome / Edge / Opera / Brave

1. Download or clone this repo
2. Go to `chrome://extensions` (or your browser's equivalent)
3. Turn on **Developer mode** (top right)
4. Click **Load unpacked**
5. Select the `chrome/` folder

### Firefox

1. Download or clone this repo
2. Go to `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on**
4. Select any file inside the `firefox/` folder

Published versions are available on the [Chrome Web Store](https://chromewebstore.google.com) and [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/magnetar/).

## Setup

On first install, the onboarding wizard opens automatically and walks you through three steps:

1. Pick your download mode and enter your credentials
2. Choose your detection preferences (batch mode, banner style, Shield)
3. See which sites Magnetar works best with

You can change any of these settings later from the extension options page.

## How it works

Magnetar runs a six-layer detection pipeline on every page:

1. **Custom site rules** - your own CSS selectors or regex patterns
2. **Magnet link scan** - finds `magnet:` URIs in the page
3. **Labelled hash scan** - looks for "Info Hash:" and similar labels
4. **Structured data scan** - checks `data-` attributes and hidden inputs
5. **Broad regex sweep** - matches hex/Base32 hash patterns in page text
6. **Confidence scoring** - verifies torrent context before showing the banner

Non-torrent pages bail out in under a millisecond. There's zero performance impact on normal browsing, and common sites like GitHub, Google, Reddit, and banking sites are excluded from detection entirely to avoid false positives.

## Magnetar Shield

Built-in popup/redirect blocker that stops annoying sites from loading.

- Right-click any page and select "Block this site with Magnetar"
- Right-click again to unblock
- Manage your blocklist from the popup or the settings page
- Import/export blocklists as JSON to share with others
- Ships with a small default blocklist of common torrent popup domains

On Chrome it uses `declarativeNetRequest` for efficient network-level blocking. On Firefox it uses `webNavigation` tab-closing.

## Works best with

Magnetar works on any site with torrent hashes or magnet links, but has been tested extensively on:

- The Pirate Bay
- 1337x
- AudioBook Bay
- PluginTorrent
- YTS
- EZTV
- Magnetz

## Supported hash formats

Magnetar isn't tied to specific sites. It detects:

- SHA-1 hashes (40 hex characters)
- SHA-256 hashes (64 hex characters, BitTorrent v2)
- Base32 encoded hashes
- Magnet URIs
- Hashes in data attributes, hidden fields, or labelled text

## Adding new providers

The provider system is modular. Each provider in `lib/providers/` exports three functions: `validateCredentials`, `sendMagnet`, and `checkCache`. Adding support for a new service means creating a new file and registering it in the mode selector. No other code changes needed.

## Privacy

See [PRIVACY.md](PRIVACY.md) for the full privacy policy.

In short: Magnetar runs entirely in your browser. No data is collected, no analytics are used, and your credentials never leave your machine except to authenticate with the service you've configured.

## Contributing

Issues and pull requests are welcome. If you've written a custom site rule that works well for a specific torrent site, consider sharing it as a JSON snippet in the Issues section.

## Built with

- **AI collaboration** - developed with assistance from Claude Opus 4.6 to optimise code structure and logic
- **Vanilla JS** - lightweight and dependency-free

## Support

If Magnetar is useful to you, consider [buying me a coffee](https://buymeacoffee.com/arrcee76).

## Licence

MIT

## Author

[ArrCee76](https://github.com/ArrCee76)
