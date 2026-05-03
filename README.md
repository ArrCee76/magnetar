# Magnetar

Grab torrents, send them anywhere.

Magnetar is a browser extension that detects torrent magnets and info hashes on webpages, then sends them to your chosen download service in a few clicks. It supports cloud providers, self-hosted clients, and your local torrent client, with a clean interface for normal use and extra tools for power users.

Magnetar replaces and supersedes four earlier extensions:

- [audiobookbay-magnet](https://github.com/ArrCee76/audiobookbay-magnet)
- [torrent-to-realdebrid](https://github.com/ArrCee76/torrent-to-realdebrid)
- [torrent-to-rdtclient](https://github.com/ArrCee76/torrent-to-rdtclient)
- [site-blocker](https://github.com/ArrCee76/site-blocker)

Available for Chrome, Edge, Opera, Brave, and Firefox.

## Magnetar 2.0

Magnetar 2.0 is the biggest update yet.

The extension has a redesigned interface, Standard and Advanced modes, a new two-row toolbar, manual sending, provider target switching, improved batch mode, ignored websites, pinning, downloads access, and a more polished settings experience.

Everything is still simple by default. The extra tools are there when you want them.

## Highlights

- Detects magnet links and torrent info hashes on webpages
- Sends to Real-Debrid, AllDebrid, Premiumize, TorBox, RDT Client, qBittorrent, or your local torrent client
- Standard mode for simple one-click sending
- Advanced mode for target switching, manual send, batch tools, ignored sites, pinning, and detection details
- New toolbar with compact and full layouts
- Manual send for pasted magnet links and hashes
- Batch mode for pages with one torrent or many
- Save for later queue
- Download history with search and export
- Open provider and Open downloads shortcuts
- Magnetar Shield for popup and redirect blocking
- Ignore site for false-positive detections
- Light and dark modes
- Local-only storage with no analytics, telemetry, or tracking

## Download modes

| Mode | Notes |
|---|---|
| Real-Debrid | Cloud downloading with cache checking and magnet sending |
| AllDebrid | Cloud downloading with native cache lookup |
| Premiumize | Cloud storage and downloader with native cache lookup |
| TorBox | Cloud downloading with native cache lookup |
| RDT Client | Self-hosted Real-Debrid proxy with optional cache checking |
| qBittorrent | Self-hosted qBittorrent Web UI sending |
| Local client | Hands the magnet URI to your operating system's default torrent handler |

## Standard and Advanced modes

Magnetar can run in two interface modes.

### Standard mode

Standard mode keeps Magnetar clean and simple.

You get the core tools:

- Send to your default provider
- Save for later
- Share
- Copy magnet
- Copy hash
- Open provider
- Open downloads
- Theme toggle
- Settings
- Basic expanded view

This is the best mode if you just want Magnetar to detect torrents and send them without extra decisions.

### Advanced mode

Advanced mode unlocks extra controls for users who want more power.

Advanced tools include:

- Target selector for one-off sends to a different provider
- Batch toggle on the toolbar
- Batch mode with one detected item or many
- Manual send for pasted magnet links and hashes
- Optional hash naming for manual sends
- Ignore site for false-positive detections
- Pin toolbar to keep Magnetar open after sending
- Detection details in the expanded panel
- Popup button to open the Magnetar toolbar manually on pages with no detection

Advanced mode does not change your default provider unless you change it in settings.

## Toolbar styles

Magnetar supports two toolbar styles.

### Compact

Compact mode keeps the banner smaller and less intrusive.

### Full

Full mode gives the toolbar more room and is better if you use Advanced mode often.

You can change interface mode and toolbar style from the What's New page, onboarding, or settings.

## Manual send

Manual send lets you paste a magnet link or torrent hash directly into Magnetar.

This is useful when:

- a page does not contain a visible magnet link
- you copied a hash from somewhere else
- you want to send something without relying on page detection

If you paste a raw hash, Magnetar cannot know the torrent name from the hash alone. You can add an optional name so your local Magnetar history is easier to read.

## Target sending

Advanced mode adds a Target button beside the main Send button.

Use it to send the current torrent to another provider without changing your saved default.

For example, your default provider can stay TorBox, but one item can be sent to Real-Debrid, qBittorrent, RDT Client, or your local torrent client.

Local torrent client is always available because it does not need API credentials.

## Batch mode

Batch mode is for pages with multiple torrent results.

It supports:

- one detected item or many
- selected sends
- target switching
- save flags
- sent badges
- cache status
- saved queue
- recent activity
- batch drawer
- clean row alignment
- history and stats

Batch mode can be toggled from the toolbar in Advanced mode.

## Save for later

Save for later lets you keep torrents in a local queue without sending them immediately.

Saved items can be sent later from:

- the expanded toolbar
- the batch drawer
- saved lists inside Magnetar

Saved data is stored locally in your browser extension storage.

## Ignore site

If Magnetar opens on a site where it should not, Advanced mode lets you ignore that site.

Click Ignore site and Magnetar will:

- save the current domain
- hide the banner
- stop showing detection banners on that domain

Ignored websites can be reviewed and removed from settings.

This is separate from Magnetar Shield. Ignore site only stops Magnetar detection banners. It does not block the website.

## Magnetar Shield

Magnetar Shield is a built-in popup and redirect blocker for unwanted domains.

It can:

- block popup and redirect domains
- close or block known unwanted tabs
- import and export blocked domains
- manage a reviewable blocklist in settings

On Chromium browsers, Shield uses declarativeNetRequest. On Firefox, Shield uses webNavigation to close blocked tabs before they render.

## Open provider and downloads

Magnetar can open useful destinations directly from the toolbar.

Depending on the active target, you can open:

- TorBox
- Real-Debrid
- AllDebrid
- Premiumize
- qBittorrent Web UI, if configured
- RDT Client, if configured
- your browser downloads folder

For the local torrent client target, Magnetar does not pretend to open your desktop torrent app. Local sends are handed to your browser or operating system torrent handler.

## Detection details

Advanced mode includes a compact Detection Details section in the expanded panel.

When opened, it can show useful values such as:

- hash
- magnet
- page URL
- detection type
- source
- cache status
- current target
- page domain

Values are rendered safely as text and can be copied where useful.

## Detection pipeline

Magnetar uses a layered detection pipeline:

1. Custom site rules
2. Magnet link scan
3. Labelled hash scan
4. Structured data scan
5. Broad hash pattern scan
6. Confidence scoring

Supported formats include:

- SHA-1 info hashes
- SHA-256 BitTorrent v2 hashes
- Base32 hashes
- Magnet URIs
- Hashes in data attributes, hidden fields, or labelled text

## Cache checking

Magnetar checks provider cache status where supported.

A local tiered cache reduces repeated API calls by storing recent cache results in browser storage. Cached results last longer than not-cached results because torrents can become cached later.

Successful sends can update local cache state so repeat views are faster.

## History

Magnetar keeps a local download history of items sent through the extension.

History can include:

- torrent name
- hash
- provider
- category
- source URL
- timestamp
- cache status at send time

The settings page includes search, JSON export, CSV export, and clear controls.

History is stored locally in your browser extension storage.

## Custom site rules

Advanced users can add custom detection rules for sites that need special handling.

Custom rules can use selectors or patterns and can be imported or exported from settings.

## Localisation

Magnetar includes localisation files for:

- English
- Swedish
- French
- German
- Russian
- Italian
- Spanish
- Danish
- Romanian
- Lithuanian
- Czech

Some newly added Magnetar 2.0 strings may appear in English until all translations are backfilled.

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

On first install, Magnetar opens a setup flow.

You can choose:

- provider or client
- Standard or Advanced mode
- compact or full toolbar
- detection and banner preferences
- Shield settings

Everything can be changed later from settings.

## Permissions

Magnetar asks for the permissions needed to detect torrents, show the toolbar, save settings, and send to your chosen provider.

| Permission | Why it is needed |
|---|---|
| `storage` | Save settings, credentials, history, saved items, ignored sites, and preferences |
| `contextMenus` | Add right-click actions for blocking, unblocking, and sending |
| `tabs` | Read active tab information for toolbar and Shield behaviour |
| `webNavigation` | Detect and stop blocked navigations |
| `declarativeNetRequest` | Block Shield domains on Chromium browsers |
| `clipboardWrite` | Copy magnet links and hashes |
| `activeTab` | Let the popup open Magnetar on the current page |
| `scripting` | Inject content scripts on Chromium browsers |
| `downloads` | Open the browser default downloads folder |
| `<all_urls>` | Run detection on pages you visit |

Magnetar does not use analytics, telemetry, ads, or remote tracking.

## Privacy

Magnetar runs locally in your browser.

It does not collect personal data, track your browsing, phone home, or send anything to servers except the provider you configure.

See [PRIVACY.md](PRIVACY.md) for the full privacy policy.

## Architecture

Magnetar is built as a browser extension with separate Chrome and Firefox folders.

Chromium uses Manifest V3. Firefox uses Manifest V2.

```
.
+-- chrome/
|   +-- manifest.json
|   +-- background.js
|   +-- content.js
|   +-- options.html / options.js / options.css
|   +-- popup.html / popup.js / popup.css
|   +-- onboarding.*
|   +-- whatsnew.*
|   +-- lib/
|   +-- icons/
|   +-- _locales/
|
+-- firefox/
|   +-- manifest.json
|   +-- background.js
|   +-- content.js
|   +-- options.html / options.js / options.css
|   +-- popup.html / popup.js / popup.css
|   +-- onboarding.*
|   +-- whatsnew.*
|   +-- lib/
|   +-- icons/
|   +-- _locales/
```

The main shared logic includes:

| Area | Files |
|---|---|
| Detection | `lib/detector.js` |
| Providers | `lib/providers/` |
| Cache | `lib/cache-store.js` |
| Shield | `lib/shield.js` |
| Categories | `lib/categories.js` |
| UI | `content.js`, `content.css`, `options.*`, `popup.*` |

## Development

Clone the repo and load the relevant folder as an unpacked or temporary extension.

For Chromium browsers, load:

```text
chrome/
```

For Firefox, load:

```text
firefox/
```

The extension is written in vanilla JavaScript with no runtime dependencies.

## Contributing

Issues and pull requests are welcome at [github.com/ArrCee76/magnetar](https://github.com/ArrCee76/magnetar).

If you have a site rule, bug report, or provider suggestion, open an issue with as much detail as possible.

## Support

If Magnetar saves you time, you can support it by:

- leaving a review on the [Chrome Web Store](https://chromewebstore.google.com/detail/magnetar/cllbehlfiahgijdojkopgnnmcoenhlla)
- leaving a review on [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/magnetar/)
- [buying me a coffee](https://buymeacoffee.com/arrcee76)

## Built with

Vanilla JavaScript, no runtime dependencies. Magnetar 2.0 was developed with GPT-5.5 and Codex as coding, review, refactor, and design iteration tools.

## Credits

Thanks to Reddit user niblem for suggestions and feedback that helped shape this release.

## Licence

MIT. See [LICENCE](LICENCE) for the full text.

## Author

[ArrCee76](https://github.com/ArrCee76)
