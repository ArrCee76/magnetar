# Magnetar

Grab torrents, send them anywhere.

Magnetar is a browser extension that detects torrent magnets and torrent info hashes on webpages, then sends them to your chosen provider or client in a few clicks. It supports cloud providers, self-hosted clients, and your local torrent client, with a clean toolbar for everyday use and extra tools when you need more control.

Magnetar also supports optional sync with Magnetar Mobile, organised Magnetar folders, Send to mobile, Batch Send to mobile, and TorBox Airlock for supported TorBox items.

Magnetar replaces and supersedes four earlier extensions:

- [audiobookbay-magnet](https://github.com/ArrCee76/audiobookbay-magnet)
- [torrent-to-realdebrid](https://github.com/ArrCee76/torrent-to-realdebrid)
- [torrent-to-rdtclient](https://github.com/ArrCee76/torrent-to-rdtclient)
- [site-blocker](https://github.com/ArrCee76/site-blocker)

Available for Chrome, Edge, Opera, Brave, and Firefox.

## Magnetar 2.2

Magnetar 2.2 is a Sync, Mobile, Organised folders, and TorBox Airlock release.

It keeps the redesigned 2.x toolbar and Client view, then adds optional encrypted Magnetar Sync with Magnetar Mobile. You can pair the extension with the Android app, send items to the mobile Review queue, keep saved items and sent history in step, and use Organised folders across devices.

This release also adds TorBox Airlock support for supported TorBox items, improves provider row actions, adds a new low-text What's New panel, and keeps the soft green visual language for sync, mobile, and organised actions.

Magnetar remains local-first. Provider API keys and client passwords stay on the device where you enter them. Optional Magnetar Sync only syncs encrypted Magnetar metadata.

## What's new in 2.2

- Optional Magnetar Sync with Magnetar Mobile
- Private QR pairing between the extension and Android app
- Sync mobile panel with Pull sync and Push sync controls
- Send to mobile from single items
- Batch Send to mobile from multi-item pages
- Mobile Review queue support
- Organised folders with synced names, colours, order, and contents
- Provider-aware folder items that can open through the locally configured provider
- TorBox Airlock support for supported TorBox provider items
- TorBox Airlock support inside Organised folder items where the TorBox item can be resolved
- Compact provider row labels with cleaner action spacing
- Updated provider list actions and status badges
- New What's New panel for the 2.2 features
- Cream mode as the default for fresh installs
- Firefox parity for the 2.2 Chrome feature set
- Website help and privacy wording updated for Sync and Mobile

## Highlights

- Detects magnet links and torrent info hashes on webpages
- Sends to Real-Debrid, AllDebrid, Premiumize, TorBox, RDT Client, qBittorrent, or your local torrent client
- Standard mode for simple sending
- Advanced mode for target switching, manual send, batch tools, Client view, ignored sites, pinning, and detection details
- Client view for provider or client browsing in the toolbar
- Optional Magnetar Sync with Magnetar Mobile
- Send to mobile and Batch Send to mobile
- Organised folders that sync between extension and mobile when paired
- Folder colours and folder item metadata
- TorBox Airlock for supported TorBox items
- Manual send for pasted magnet links and hashes
- Batch mode for pages with one torrent or many
- Save for later queue
- Download history with search, export, resend, source URL, and delete actions
- Recent history in the toolbar
- Help button linking to https://arrcee.com/magnetarhelp/
- Open provider and Open downloads shortcuts
- Magnetar Shield for nuisance popup and redirect blocking
- Optional recommended popup list import for Shield
- Ignore site for false-positive detections
- Light and dark modes
- Local-first storage with no analytics, telemetry, ads, or tracking

## Supported targets

| Target       | Notes                                                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Real-Debrid  | Cloud provider support with cache checking, magnet sending, provider opening, and Client download support where resolvable  |
| AllDebrid    | Cloud provider support with cache lookup and Open in AllDebrid handoff for Client rows                                      |
| Premiumize   | Cloud storage and downloader support with cache lookup and provider browsing where supported                                |
| TorBox       | Cloud provider support with cache lookup, provider browsing, request-download handling, and Airlock support where supported |
| RDT Client   | Self-hosted Real-Debrid proxy support with optional cache checking and configured client opening                            |
| qBittorrent  | Self-hosted qBittorrent Web UI sending and configured client opening                                                        |
| Local client | Hands the magnet URI to your operating system's default torrent handler                                                     |

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
- Ignore site where available
- Sync mobile where available
- Send to mobile where available
- Magnetar Mobile shortcut
- Theme toggle
- Settings
- Basic expanded view

This is the best mode if you just want Magnetar to detect torrents and send them without extra decisions.

### Advanced mode

Advanced mode unlocks extra controls for users who want more power.

Advanced tools include:

- Target selector for one-off sends to a different provider
- Batch toggle on the toolbar
- Client toggle on the toolbar
- Batch mode with one detected item or many
- Client view for browsing configured provider or client items
- Manual send for pasted magnet links and hashes
- Optional hash naming for manual sends
- Ignore site for false-positive detections
- Pin toolbar to keep Magnetar open after sending
- Detection details in the expanded panel
- Popup button to open the Magnetar toolbar manually on pages with no detection

Advanced mode does not change your default provider unless you change it in settings.

## Magnetar Sync

Magnetar Sync is optional.

It lets the browser extension and Magnetar Mobile keep supported Magnetar metadata in step. Pairing is done with a private QR code from the extension and Magnetar Mobile on Android.

Sync can keep the following in step:

- saved items
- sent history
- mobile Review items
- Organised folder names
- Organised folder colours
- Organised folder order
- Organised folder contents
- supported folder item metadata

Sync does not sync:

- provider API keys
- client passwords
- RDT Client credentials
- qBittorrent credentials
- local client settings
- provider files
- provider folders
- provider downloads

Synced Magnetar data is encrypted before it reaches the Magnetar Sync server.

### Pairing with Magnetar Mobile

Basic pairing flow:

1. Open the Magnetar extension.
2. Click Sync mobile.
3. Create or show the pairing QR code.
4. Open Magnetar Mobile.
5. Go to Settings, then Sync.
6. Scan the QR code or use the pairing code if available.
7. Confirm the paired state.
8. Use Pull sync or Push sync if needed.

Each device keeps its own provider setup. If a TorBox item is in a synced folder, the app or browser still needs TorBox configured locally to browse, play, download, or Airlock that item.

## Send to mobile

Send to mobile moves Magnetar items from the extension to Magnetar Mobile.

You can send:

- one detected item
- one saved item
- one provider item where supported
- a batch of detected items from Batch mode

Items arrive in the Magnetar Mobile Review queue. Review lets you check items before saving, sending, browsing, or organising them on your phone.

Send to mobile requires Magnetar Sync pairing.

## Organised folders

Organised folders are Magnetar folders.

They help you group items inside Magnetar and keep those groups in step between the extension and Magnetar Mobile.

Organised folders can include items from supported providers, such as TorBox, Real-Debrid, AllDebrid, Premiumize, RDT Client, qBittorrent, and local entries where supported.

Organised folders do not:

- create folders inside your provider
- move provider files
- rename provider files
- delete provider files
- change provider folders
- upload provider files to Magnetar Sync

Folder names, colours, order, and contents are Magnetar metadata. They can sync between paired devices.

To browse or open an item inside an Organised folder, the provider for that item must be configured locally on that device.

## TorBox Airlock

TorBox Airlock is a TorBox feature.

Magnetar can show and toggle Airlock for supported TorBox items from:

- the TorBox provider list
- supported TorBox items inside Organised folders

Airlock state comes from TorBox. If you Airlock an item in the extension, TorBox updates. Magnetar Mobile can see the current state after refreshing TorBox with its own local TorBox setup.

Magnetar Sync may carry last-known Airlock display metadata inside folder items, but TorBox remains the source of truth.

TorBox Airlock uses the local TorBox API key on the current device. It does not use TorBox website cookies, website sessions, or page scraping.

## Green sync language

Soft green marks Magnetar Sync, mobile, and organised-folder actions.

Provider send actions stay separate. This helps make the sync and mobile workflow easier to spot at a glance without changing the normal provider sending flow.

## Toolbar styles

Magnetar supports two toolbar styles.

### Compact

Compact mode keeps the banner smaller and less intrusive.

### Full

Full mode gives the toolbar more room and is better if you use Advanced mode often.

You can change interface mode and toolbar style from onboarding or settings.

## Client view

Client view lets you browse supported provider or client items directly from the Magnetar toolbar without leaving the page you are on.

Client view can show:

- configured provider or client items
- item names
- type and size where available
- cache or status metadata where available
- provider or source metadata
- Open provider actions
- Add to Organised folder actions where available
- Airlock actions for supported TorBox items
- direct download actions where supported
- pagination
- clean zebra rows

Client view is loaded on demand from the selected toolbar target. It is not the same as Batch mode.

### Client view vs Batch mode

| Feature     | Purpose                                                             |
| ----------- | ------------------------------------------------------------------- |
| Batch mode  | Works with torrent items detected on the current webpage            |
| Client view | Browses your configured provider or client library from the toolbar |

Batch is for the page you are looking at.

Client view is for your configured provider or client.

## Client provider behaviour

Client view only shows actions that make sense for the selected provider or client.

| Provider or client | Client behaviour                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| TorBox             | Shows supported items, cache status, Airlock status, Open TorBox actions, folder actions, and request-download actions where supported      |
| Real-Debrid        | Shows supported items and direct download actions where Magnetar can resolve them safely                                                    |
| AllDebrid          | Uses Open in AllDebrid handoff where the user should download through AllDebrid's own page                                                  |
| Premiumize         | Shows supported browsing and open actions where available. Download support depends on the exposed provider data                            |
| RDT Client         | Support depends on configured client URL and exposed client data                                                                            |
| qBittorrent        | Support depends on configured Web UI and available safe actions                                                                             |
| Local client       | Local sends are handed to the browser or operating system torrent handler. Local browsing is only shown where a safe configured path exists |

## AllDebrid handling

AllDebrid multi-file downloads are different from some other providers.

For AllDebrid Client rows, Magnetar uses a clear Open in AllDebrid action rather than pretending the row is a direct zip download.

This avoids:

- partial package downloads
- hidden service-page automation
- downloading only the first file from a multi-file item
- navigating the current page away unexpectedly

The user stays in control and uses AllDebrid's own download page for AllDebrid-specific package actions.

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

For example, your default provider can stay TorBox, but one item can be sent to Real-Debrid, AllDebrid, Premiumize, qBittorrent, RDT Client, or your local torrent client.

Local torrent client is always available because it does not need API credentials.

## Batch mode

Batch mode is for pages with multiple detected torrent results.

It supports:

- one detected item or many
- selected sends
- target switching
- save flags
- sent badges
- cache status
- Send to mobile
- Batch Send to mobile
- saved queue
- recent history
- batch drawer
- clean row alignment
- history and stats

Batch mode can be toggled from the toolbar in Advanced mode.

Batch and Client are separate toolbar modes. Opening one closes the other.

## Save for later

Save for later lets you keep torrents in a local queue without sending them immediately.

Saved items can be sent later from:

- the expanded toolbar
- the batch drawer
- saved lists inside Magnetar
- paired Magnetar Mobile where Sync is enabled

Saved data is stored in browser extension storage. If Sync is enabled, supported saved metadata can be encrypted and synced through Magnetar Sync.

## Ignore site

If Magnetar opens on a site where it should not, you can ignore that site.

Click Ignore site and Magnetar will:

- save the current domain
- hide the banner
- stop showing detection banners on that domain

Ignored websites can be reviewed and removed from settings.

This is separate from Magnetar Shield. Ignore site only stops Magnetar detection banners. It does not block the website.

## Magnetar Shield

Magnetar Shield is a built-in nuisance popup and redirect blocker for unwanted domains.

It can:

- block popup and redirect domains
- close or block known unwanted tabs
- import and export manual blocked domains
- manage a reviewable blocklist in settings
- use an optional recommended popup list

On Chromium browsers, Shield uses declarativeNetRequest plus faster tab checks where available.

On Firefox, Shield uses Firefox-compatible navigation and tab handling to close blocked tabs quickly.

Magnetar Shield can catch popup tabs early, including tabs that start as `about:blank` and then reveal their final popup URL.

## Recommended popup list

Magnetar includes an optional recommended popup list for Shield.

The recommended list is designed for nuisance popup and redirect domains that appear on aggressive sites. It is not a full adblocker.

The list is:

- optional
- user-installed from settings
- removable at any time
- stored locally after import
- kept separate from manual blocked domains
- plain JSON data
- remote data only, not remote code

Public list URL:

```text
https://arrcee.com/magnetar/shield-popup-list.json
```

The recommended list only targets top-level popup or tab navigations.

It does not block:

- normal page scripts
- images
- stylesheets
- XHR or fetch
- Cloudflare captcha or challenge resources
- ordinary site resources

Manual blocked domains and imported recommended domains are combined for Shield matching, but they remain separate in storage. Removing the recommended list does not remove manual blocked domains.

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
- Magnetar Mobile information

For the local torrent client target, Magnetar does not pretend to open your desktop torrent app. Local sends are handed to your browser or operating system torrent handler.

## Magnetar Mobile shortcut

Magnetar includes a small phone shortcut to the toolbar.

It appears near the light or dark control and links to:

```text
https://arrcee.com/magnetar-mobile
```

This gives extension users a simple route to learn about Magnetar Mobile, the Android companion app.

The extension does not track toolbar use and does not send provider data to the website.

## What's New panel

Magnetar 2.2 includes a What's New panel.

It explains the main 2.2 changes:

- Sync with mobile
- Sync folders
- Send to mobile
- TorBox Airlock
- Green means sync
- Pair with QR

The panel appears once for the 2.2 release and can be opened later from the toolbar.

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
7. Site-specific safe fallbacks where needed

Supported formats include:

- SHA-1 info hashes
- SHA-256 BitTorrent v2 hashes
- Base32 hashes
- Magnet URIs
- hashes in data attributes, hidden fields, or labelled text

## ext.to support

Magnetar supports ext.to detail pages where the torrent hash is hidden behind the page's own View Hash flow.

Magnetar does not guess private endpoint parameters.

Instead, it uses the page's visible View Hash behaviour, waits for the hash display to populate, extracts the hash, and builds a normal magnet URI for the regular Magnetar toolbar flow.

This support is for single detail pages. It does not attempt to batch-reveal hidden hashes across listing pages.

## Cache checking

Magnetar checks provider cache status where supported.

A local tiered cache reduces repeated API calls by storing recent cache results in browser storage. Cached results last longer than not-cached results because torrents can become cached later.

Successful sends can update local cache state so repeat views are faster.

## History

Magnetar keeps a local sent history of items sent through the extension.

History can include:

- torrent name
- hash
- provider
- category
- source URL and source domain when available
- timestamp
- cache status at send time

History rows can resend previous items, open the original source URL when available, and delete individual entries. The toolbar also shows recent sends for quick recent history checks without opening the full settings page.

The settings page includes search, JSON export, CSV export, and clear controls.

History is stored in browser extension storage. If Sync is enabled, supported history metadata can be encrypted and synced through Magnetar Sync.

## Custom site rules

Advanced users can add custom detection rules for sites that need special handling.

Custom rules can use selectors or patterns and can be imported or exported from settings.

The Custom Sites settings area includes selector testing where supported, so users can better understand whether a custom rule is finding a magnet or hash.

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

Some newly added Magnetar 2.2 strings may appear in English until all translations are backfilled.

## Installation

### Chrome, Edge, Opera, Brave

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/magnetar/cllbehlfiahgijdojkopgnnmcoenhlla).

To install a development build:

1. Download or clone this repository.
2. Visit `chrome://extensions`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select the `chrome/` folder.

### Firefox

Install from [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/magnetar/).

To install a development build:

1. Download or clone this repository.
2. Visit `about:debugging#/runtime/this-firefox`.
3. Click Load Temporary Add-on.
4. Select any file inside the `firefox/` folder.

## First run

On first install, Magnetar opens a setup flow.

You can choose:

- provider or client
- Standard or Advanced mode
- compact or full toolbar
- detection and banner preferences
- Shield settings

Everything can be changed later from settings.

Fresh installs start in the cream theme. Dark mode is available from the toolbar.

## Permissions

Magnetar asks for the permissions needed to detect torrents, show the toolbar, save settings, sync optional Magnetar metadata, and send to your chosen provider.

| Permission                  | Why it is needed                                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                   | Save settings, credentials, history, saved items, ignored sites, Shield lists, Sync pairing state, Organised folder metadata, and preferences |
| `contextMenus`              | Add right-click actions for blocking, unblocking, and sending                                                                                 |
| `tabs`                      | Read active tab information for toolbar, provider opening, Client actions, and Shield behaviour                                               |
| `webNavigation`             | Detect and stop blocked navigations                                                                                                           |
| `declarativeNetRequest`     | Block Shield domains on Chromium browsers                                                                                                     |
| `clipboardWrite`            | Copy magnet links and hashes                                                                                                                  |
| `activeTab`                 | Let the popup open Magnetar on the current page                                                                                               |
| `scripting`                 | Inject content scripts on Chromium browsers                                                                                                   |
| `downloads`                 | Open the browser default downloads folder and support provider download actions where available                                               |
| `<all_urls>`                | Run detection on pages you visit                                                                                                              |
| `https://arrcee.com/*`      | Fetch the optional recommended Shield popup list when you choose to install or update it                                                      |
| `https://sync.arrcee.com/*` | Use optional Magnetar Sync when you pair the extension with Magnetar Mobile                                                                   |
| provider API domains        | Communicate with the provider or client you configure                                                                                         |

Magnetar does not use analytics, telemetry, ads, or remote tracking.

## Privacy

Magnetar is local-first.

Provider API keys and client passwords stay on the device where you enter them. They are not synced.

Without Magnetar Sync, the extension runs locally in your browser and talks only to the provider or client you configure.

If you enable Magnetar Sync, synced Magnetar data is encrypted before it reaches the sync server. Sync is used for Magnetar metadata such as saved items, sent history, mobile Review items and Organised folder metadata. Provider files are not uploaded to Magnetar Sync, and provider files or folders are never changed by Organised folders.

Magnetar may also fetch the optional recommended Shield popup list from arrcee.com when you choose to install or update it. That request fetches a public JSON file only. It does not include browsing history, provider keys, detected magnets, page URLs, or user identifiers.

See [PRIVACY.md](PRIVACY.md) for the full privacy policy.

## Architecture

Magnetar is built as a browser extension with separate Chrome and Firefox folders.

Chromium uses Manifest V3. Firefox uses Manifest V2.

```text
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

| Area       | Files                                               |
| ---------- | --------------------------------------------------- |
| Detection  | `lib/detector.js`                                   |
| Providers  | `lib/providers/`                                    |
| Sync       | `lib/sync-*.js`, `lib/sync-data.js`                 |
| Cache      | `lib/cache-store.js`                                |
| Shield     | `lib/shield.js`                                     |
| Categories | `lib/categories.js`                                 |
| UI         | `content.js`, `content.css`, `options.*`, `popup.*` |

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

## 2.2 release checklist

Before publishing 2.2, verify:

- Chrome manifest version is `2.2`
- Firefox manifest version is `2.2`
- Magnetar Mobile 1.2.0 is approved or available
- Website help page is updated at `https://arrcee.com/magnetarhelp/`
- Privacy policy is updated for optional Magnetar Sync
- Toolbar loads on common test pages
- Standard mode works
- Advanced mode works
- Batch mode works
- Client view opens and paginates
- Batch and Client remain mutually exclusive
- Sync mobile panel opens
- Pairing QR flow works
- Send to mobile works
- Batch Send to mobile works
- Mobile Review queue receives sent items
- Organised folders open
- Folder colours sync
- Folder create, rename, delete, and item actions work
- TorBox Client view works where configured
- TorBox Airlock works in provider rows
- TorBox Airlock works in Organised folder rows
- Real-Debrid Client view works where configured
- AllDebrid Client rows show honest AllDebrid handoff
- Premiumize, RDT Client, qBittorrent, and Local Client show honest supported or unsupported states
- Shield blocks known popup domains quickly
- Recommended Shield list installs, updates, views, and removes correctly
- Manual Shield domains remain separate from recommended domains
- Cloudflare captcha or challenge flows still work
- ext.to detail pages detect via the View Hash flow
- Provider or client tabs are not accidentally blocked by Shield
- `https://arrcee.com/magnetar/shield-popup-list.json` is live and valid JSON
- Chrome Web Store package is built from the Chrome folder
- Firefox package is built from the Firefox folder

## Future work

Possible follow-up work for 2.2.x or later:

- More Client row actions such as copy, details, play/open, resend, or per-row routing
- Broader provider Client view coverage where APIs allow it safely
- More refined Premiumize, RDT Client, and qBittorrent browsing support
- Optional reporting flow for new nuisance popup domains
- Larger curated Shield popup list, still opt-in and domain-only
- Backfilled translations for all new 2.2 strings
- Further website and help updates based on user questions
- Self-hosted Magnetar Sync option if it can be supported cleanly

## Contributing

Issues and pull requests are welcome at [github.com/ArrCee76/magnetar](https://github.com/ArrCee76/magnetar).

If you have a site rule, bug report, provider suggestion, or nuisance popup domain to report, include as much detail as possible.

## Support

If Magnetar saves you time, you can support it by:

- leaving a review on the [Chrome Web Store](https://chromewebstore.google.com/detail/magnetar/cllbehlfiahgijdojkopgnnmcoenhlla)
- leaving a review on [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/magnetar/)
- [buying me a coffee](https://buymeacoffee.com/arrcee76)

## Built with

Vanilla JavaScript, no runtime dependencies. Magnetar 2.2 was developed with GPT-5.5 and Codex as coding, review, refactor, and design iteration tools.

## Credits

Thanks to Reddit user niblem for suggestions and feedback that helped shape Magnetar.

Thanks to testers and early Magnetar users for reporting provider quirks, nuisance popup domains, sync issues, and real-world browsing behaviour.

## Licence

Magnetar is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE) from v2.1.1 onward.

It is free for personal and non-commercial use. Commercial redistribution, paid forks, store republishing, SaaS wrapping, or use of Magnetar branding requires written permission.

Older MIT releases remain under the licence they were released with.

## Author

[ArrCee76](https://github.com/ArrCee76)
