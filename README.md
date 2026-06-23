# Magnetar

Grab torrents, send them anywhere.

Magnetar is a browser extension that detects torrent magnets and torrent info hashes on webpages, then sends them to your chosen provider or client in a few clicks. It supports cloud providers, self-hosted clients, and your local torrent client, with a clean toolbar for everyday use and extra tools when you need more control.

Magnetar replaces and supersedes four earlier extensions:

- [audiobookbay-magnet](https://github.com/ArrCee76/audiobookbay-magnet)
- [torrent-to-realdebrid](https://github.com/ArrCee76/torrent-to-realdebrid)
- [torrent-to-rdtclient](https://github.com/ArrCee76/torrent-to-rdtclient)
- [site-blocker](https://github.com/ArrCee76/site-blocker)

Available for Chrome, Edge, Opera, Brave, and Firefox.

## Magnetar 2.1.2

Magnetar 2.1.2 is a toolbar, Client view, and Shield release.

It keeps the redesigned 2.x interface, but makes the extension feel faster, cleaner, and more useful in real browsing. The biggest additions are the new Client view inside the toolbar, better provider browsing, improved Shield popup handling, an optional recommended popup list, a Magnetar Mobile shortcut, and improved handling for sites and providers that need special flows.

Everything remains local-first. Magnetar does not use analytics, telemetry, ads, or tracking inside the extension.

## What's new in 2.1.2

- New Client view in the toolbar
- Browse configured provider or client items without leaving the current page
- 25-item pagination in Client view
- Zebra row styling for easier scanning
- Open in provider buttons from Client rows
- Direct download buttons where a provider exposes a safe direct download flow
- TorBox Client download handling using the provider download request flow
- Real-Debrid Client download support where resolvable
- AllDebrid Client rows use Open in AllDebrid instead of pretending multi-file packages are direct downloads
- Client toggle beside Batch
- Batch and Client are mutually exclusive toolbar modes
- Compact toolbar polish across Chrome and Firefox
- Ignore site is easier to access across toolbar modes
- Magnetar Mobile phone shortcut before the light/dark button
- Faster Magnetar Shield popup and redirect tab handling
- Optional recommended Shield popup list import from arrcee.com
- Manual and imported Shield domains are kept separate
- Recommended Shield list is remote data only, not remote code
- ext.to detail-page support using the site's own View Hash flow
- Firefox port of the 2.1.2 toolbar and Client improvements
- No forced What's New tab for this release
- No onboarding interruption for this release

## Highlights

- Detects magnet links and torrent info hashes on webpages
- Sends to Real-Debrid, AllDebrid, Premiumize, TorBox, RDT Client, qBittorrent, or your local torrent client
- Standard mode for simple sending
- Advanced mode for target switching, manual send, batch tools, Client view, ignored sites, pinning, and detection details
- Client view for provider/client browsing in the toolbar
- Manual send for pasted magnet links and hashes
- Batch mode for pages with one torrent or many
- Save for later queue
- Download history with search, export, resend, source URL, and delete actions
- Recent activity in the toolbar with up to the last 20 sends
- Help button linking to https://arrcee.com/magnetarhelp
- Open provider and Open downloads shortcuts
- Magnetar Shield for nuisance popup and redirect blocking
- Optional recommended popup list import for Shield
- Ignore site for false-positive detections
- Light and dark modes
- Magnetar Mobile shortcut
- Local-only storage with no analytics, telemetry, or tracking

## Supported targets

| Target       | Notes                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Real-Debrid  | Cloud provider support with cache checking, magnet sending, provider opening, and Client download support where resolvable |
| AllDebrid    | Cloud provider support with cache lookup and Open in AllDebrid handoff for Client rows                                     |
| Premiumize   | Cloud storage and downloader support with cache lookup and provider browsing where supported                               |
| TorBox       | Cloud provider support with cache lookup, provider browsing, and request-download handling where supported                 |
| RDT Client   | Self-hosted Real-Debrid proxy support with optional cache checking and configured client opening                           |
| qBittorrent  | Self-hosted qBittorrent Web UI sending and configured client opening                                                       |
| Local client | Hands the magnet URI to your operating system's default torrent handler                                                    |

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
- Client view for browsing configured provider/client items
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

Magnetar 2.1.2 polishes the toolbar sizing, spacing, icon placement, and mode controls so the toolbar feels cleaner without hiding the important actions.

You can change interface mode and toolbar style from onboarding or settings.

## Client view

Client view is the main new 2.1.2 workflow.

It lets you browse supported provider or client items directly from the Magnetar toolbar without leaving the page you are on.

Client view can show:

- configured provider/client items
- item names
- type and size where available
- cache or status metadata where available
- provider/source metadata
- Open in provider actions
- direct download actions where supported
- 25 items per page
- previous and next pagination
- clean zebra rows

Client view is loaded on demand from the selected toolbar target. It is not the same as Batch mode.

### Client view vs Batch mode

| Feature     | Purpose                                                          |
| ----------- | ---------------------------------------------------------------- |
| Batch mode  | Works with torrent items detected on the current webpage         |
| Client view | Browses your configured provider/client library from the toolbar |

Batch is for the page you are looking at.

Client view is for your configured provider or client.

## Client provider behaviour

Client view only shows actions that make sense for the selected provider/client.

| Provider/client | Client behaviour                                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| TorBox          | Shows supported items and Open in TorBox actions. Downloads use the provider request-download flow where supported.                          |
| Real-Debrid     | Shows supported items and direct download actions where Magnetar can resolve them safely.                                                    |
| AllDebrid       | Uses Open in AllDebrid pills so the user can download through AllDebrid's own page. Magnetar does not fake a direct multi-file zip download. |
| Premiumize      | Shows supported browsing/open actions where available. Download support depends on the exposed provider data.                                |
| RDT Client      | Support depends on configured client URL and exposed client data.                                                                            |
| qBittorrent     | Support depends on configured Web UI and available safe actions.                                                                             |
| Local client    | Local sends are handed to the browser or operating system torrent handler. Local browsing is only shown where a safe configured path exists. |

## AllDebrid handling

AllDebrid multi-file downloads are different from some other providers.

For AllDebrid Client rows, Magnetar 2.1.2 uses a clear Open in AllDebrid action rather than pretending the row is a direct zip download.

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
- saved queue
- recent activity
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

Saved data is stored locally in your browser extension storage.

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

Magnetar 2.1.2 improves Shield so popup tabs can be caught earlier, including tabs that start as `about:blank` and then reveal their final popup URL.

## Recommended popup list

Magnetar 2.1.2 adds an optional recommended popup list for Shield.

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

The recommended list only targets top-level popup/tab navigations.

It does not block:

- normal page scripts
- images
- stylesheets
- XHR/fetch
- Cloudflare captcha/challenge resources
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

Magnetar 2.1.2 adds a small phone shortcut to the toolbar.

It appears near the light/dark control and links to:

```text
https://arrcee.com/magnetar-mobile
```

This gives extension users a simple route to learn about Magnetar Mobile, the Android companion app.

The extension does not track toolbar use and does not send provider data to the website.

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
- Hashes in data attributes, hidden fields, or labelled text

## ext.to support

Magnetar 2.1.2 adds support for ext.to detail pages where the torrent hash is hidden behind the page's own View Hash flow.

Magnetar does not guess private endpoint parameters.

Instead, it uses the page's visible View Hash behaviour, waits for the hash display to populate, extracts the hash, and builds a normal magnet URI for the regular Magnetar toolbar flow.

This support is for single detail pages. It does not attempt to batch-reveal hidden hashes across listing pages.

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
- source URL and source domain when available
- timestamp
- cache status at send time

History rows can resend previous items, open the original source URL when available, and delete individual entries. The toolbar also shows up to the last 20 sends for quick recent activity checks without opening the full settings page.

The settings page includes search, JSON export, CSV export, and clear controls.

History is stored locally in your browser extension storage.

## Custom site rules

Advanced users can add custom detection rules for sites that need special handling.

Custom rules can use selectors or patterns and can be imported or exported from settings.

Magnetar 2.1.2 improves the Custom Sites settings copy and selector testing flow where supported, so users can better understand whether a custom rule is actually finding a magnet or hash.

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

Some newly added Magnetar 2.1.2 strings may appear in English until all translations are backfilled.

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

| Permission              | Why it is needed                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `storage`               | Save settings, credentials, history, saved items, ignored sites, Shield lists, and preferences  |
| `contextMenus`          | Add right-click actions for blocking, unblocking, and sending                                   |
| `tabs`                  | Read active tab information for toolbar, provider opening, Client actions, and Shield behaviour |
| `webNavigation`         | Detect and stop blocked navigations                                                             |
| `declarativeNetRequest` | Block Shield domains on Chromium browsers                                                       |
| `clipboardWrite`        | Copy magnet links and hashes                                                                    |
| `activeTab`             | Let the popup open Magnetar on the current page                                                 |
| `scripting`             | Inject content scripts on Chromium browsers                                                     |
| `downloads`             | Open the browser default downloads folder and support provider download actions where available |
| `<all_urls>`            | Run detection on pages you visit                                                                |
| `https://arrcee.com/*`  | Fetch the optional recommended Shield popup list when you choose to install or update it        |

Magnetar does not use analytics, telemetry, ads, or remote tracking.

The optional recommended Shield list fetch is user-triggered and downloads a public JSON file. It does not send your browsing history, current page, detected links, provider settings, API keys, or credentials to arrcee.com.

## Privacy

Magnetar runs locally in your browser.

It does not collect personal data, track your browsing, phone home, or send anything to servers except:

- the provider/client you configure when you choose to send something
- arrcee.com when you choose to install or update the optional recommended Shield popup list

The recommended Shield popup list request fetches a public JSON file only. It does not include browsing history, provider keys, detected magnets, page URLs, or user identifiers.

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

## 2.1.2 release checklist

Before publishing 2.1.2, verify:

- Chrome manifest version is `2.1.2`
- Firefox manifest version is `2.1.2`
- No What's New tab opens automatically for this release
- No onboarding opens automatically for existing users
- Toolbar loads on common test pages
- Standard mode works
- Advanced mode works
- Batch mode works
- Client view opens and paginates
- Batch and Client remain mutually exclusive
- TorBox Client view works where configured
- Real-Debrid Client view works where configured
- AllDebrid Client rows show Open in AllDebrid
- Premiumize, RDT Client, qBittorrent, and Local Client show honest supported or unsupported states
- Shield blocks known popup domains quickly
- Recommended Shield list installs, updates, views, and removes correctly
- Manual Shield domains remain separate from recommended domains
- Cloudflare captcha/challenge flows still work
- ext.to detail pages detect via the View Hash flow
- Magnetar Mobile phone shortcut opens the website
- Provider/client tabs are not accidentally blocked by Shield
- Website help page is updated
- `https://arrcee.com/magnetar/shield-popup-list.json` is live and valid JSON
- Chrome Web Store package is built from the Chrome folder
- Firefox package is built from the Firefox folder

## Future work

Possible follow-up work for 2.1.3 or later:

- More Client row actions such as copy, details, play/open, resend, or per-row routing
- Broader provider Client view coverage where APIs allow it safely
- More refined Premiumize/RDT/qBittorrent browsing support
- Optional reporting flow for new nuisance popup domains
- Larger curated Shield popup list, still opt-in and domain-only
- Backfilled translations for all new 2.1.2 strings
- Further website/help updates based on user questions
- Magnetar Mobile launch linking once the Play Store listing is live

## Contributing

Issues and pull requests are welcome at [github.com/ArrCee76/magnetar](https://github.com/ArrCee76/magnetar).

If you have a site rule, bug report, provider suggestion, or nuisance popup domain to report, include as much detail as possible.

## Support

If Magnetar saves you time, you can support it by:

- leaving a review on the [Chrome Web Store](https://chromewebstore.google.com/detail/magnetar/cllbehlfiahgijdojkopgnnmcoenhlla)
- leaving a review on [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/magnetar/)
- [buying me a coffee](https://buymeacoffee.com/arrcee76)

## Built with

Vanilla JavaScript, no runtime dependencies. Magnetar 2.1.2 was developed with GPT-5.5 and Codex as coding, review, refactor, and design iteration tools.

## Credits

Thanks to Reddit user niblem for suggestions and feedback that helped shape this release.

Thanks to testers and early Magnetar users for reporting provider quirks, nuisance popup domains, and real-world browsing issues.

## Licence

Magnetar is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE) from v2.1.1 onward.

It is free for personal and non-commercial use. Commercial redistribution, paid forks, store republishing, SaaS wrapping, or use of Magnetar branding requires written permission.

Older MIT releases remain under the licence they were released with.

## Author

[ArrCee76](https://github.com/ArrCee76)
