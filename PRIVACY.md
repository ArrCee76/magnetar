# Privacy Policy

**Magnetar** is a local-first browser extension for detecting torrent info hashes and magnet links, sending them to a provider or client chosen by the user, saving items for later, blocking unwanted popups/redirects, and optionally syncing supported Magnetar data with Magnetar Mobile.

This policy explains what data Magnetar handles, where it is stored, and what network requests it may make.

## What Magnetar does not do

- Does not sell your data
- Does not use advertising trackers
- Does not use analytics or telemetry
- Does not collect data for profiling or behavioural advertising
- Does not upload provider files to Magnetar
- Does not move, rename, delete, or change files or folders inside your provider
- Does not sync provider API keys or client passwords

## Local-first by default

Magnetar is local-first.

If you do not enable Magnetar Sync, Magnetar stores its data locally in your browser's extension storage and makes network requests only to the provider or client you configure.

If you enable Magnetar Sync, Magnetar can sync supported Magnetar metadata with Magnetar Mobile. Synced Magnetar data is encrypted before it reaches the Magnetar Sync server.

Provider API keys and client passwords stay on the device where you entered them.

## Data stored locally

Magnetar may store the following data locally in your browser's extension storage:

- **Selected provider/client** such as Local Client, Real-Debrid, RDT Client, TorBox, Premiumize, or AllDebrid
- **Provider credentials** such as API keys, server URLs, usernames, passwords, or client settings entered by the user
- **Saved items** including item names, hashes, magnet links, provider metadata, source information, and timestamps
- **Sent/history items** including names, hashes, provider metadata, source information, and timestamps
- **Mobile Review items** created when using Send to mobile or Batch Send to mobile
- **Organised folders** including folder names, colours, order, contents, item display names, and provider item metadata
- **TorBox state metadata** such as cached or Airlocked status when available
- **Shield blocklist** containing domains the user has chosen to block
- **Custom site rules** containing detection patterns the user has configured
- **Preferences** such as theme, banner position, banner style, batch mode, category mappings, sync settings, and UI choices
- **Usage counters** such as a send count used for optional review prompts

Provider credentials are used only to communicate with the provider or client selected by the user. They are not synced.

## Website content and page information

Magnetar scans webpages locally to detect magnet links, torrent info hashes, labelled hashes, structured data attributes, and supported page data.

Magnetar may store source page information for saved or sent items so the user can recognise where an item came from. This can include item names, source URLs, page titles, hashes, timestamps, and related Magnetar metadata.

Magnetar does not use this information for analytics, advertising, profiling, or telemetry.

## Optional Magnetar Sync

Magnetar Sync is optional.

If enabled, Magnetar connects to the Magnetar Sync server at:

- `https://sync.arrcee.com`

Magnetar Sync may sync encrypted Magnetar metadata such as:

- Saved items
- Sent/history items
- Mobile Review items
- Organised folder names, colours, order, and contents
- Folder item metadata needed to recognise provider items across devices
- Sync pairing and revision information required for the sync feature to work

Magnetar Sync does **not** sync:

- Provider API keys
- Client passwords
- RDT Client credentials
- qBittorrent or local client credentials
- Provider files
- Provider folders
- Downloaded files
- Plain provider account contents

Synced Magnetar data is encrypted before it reaches the sync server. The sync server stores the encrypted sync payload and the technical metadata needed to provide the sync service, such as sync identifiers, revision information, and timestamps.

## Organised folders

Organised folders are Magnetar folders.

They help users group items inside Magnetar and, when Sync is enabled, keep those groups in step between the extension and Magnetar Mobile.

Organised folders do not create folders inside TorBox, Real-Debrid, AllDebrid, Premiumize, RDT Client, qBittorrent, or any other provider/client. They do not move, rename, delete, or change provider files or provider folders.

To browse or open a provider item on a device, that provider must be configured locally on that device.

## TorBox Airlock

TorBox Airlock is TorBox state.

For supported TorBox items, Magnetar can display and toggle Airlock using the user's local TorBox API key. If an item is Airlocked in Magnetar, TorBox is updated. Other devices can see the updated Airlock state when they refresh TorBox with their own local TorBox setup.

Airlock is not controlled by Magnetar Sync. Magnetar Sync may store last-known display metadata for an organised item, but TorBox remains the source of truth for Airlock status.

Magnetar does not use TorBox website cookies, TorBox website sessions, or webpage scraping for Airlock.

## Network requests

Magnetar makes network requests only for user-configured provider/client features and optional Magnetar Sync.

- **Local Client mode** - hands magnet links to the operating system's default handler. No provider API request is required by Magnetar.
- **Real-Debrid mode** - requests to `api.real-debrid.com` to validate the API key, check cache status, send magnet links, list provider items, request links, and perform user-requested provider actions.
- **RDT Client mode** - requests to the server URL provided by the user for authentication, sending items, and client actions. If a backing provider API key is configured for cache checks, Magnetar may also make requests to that configured provider.
- **TorBox mode** - requests to `api.torbox.app` to validate the API key, check cache status, send items, list provider items, request links, and toggle Airlock for supported items.
- **Premiumize mode** - requests to `www.premiumize.me` to validate the API key, check cache status, send items, list provider items, and request links.
- **AllDebrid mode** - requests to `api.alldebrid.com` to validate the API key, check cache status, send items, list provider items, and request links.
- **Magnetar Sync** - optional requests to `sync.arrcee.com` to pair devices and sync encrypted Magnetar metadata.

Magnetar does not make analytics, advertising, or telemetry requests.

## Browser permissions

Magnetar requests browser permissions for the following reasons:

| Permission                       | Why it is needed                                                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `storage`                        | Save settings, provider configuration, saved items, sent/history items, optional Sync state, Organised folder metadata, Shield blocklist entries, and custom rules |
| `contextMenus`                   | Add right-click actions for Magnetar features such as blocking/ignoring sites and working with detected links                                                      |
| `tabs`                           | Read the active tab URL/title for current-page state, update the extension icon, and support Magnetar Shield behaviour                                             |
| `webNavigation`                  | Detect and stop unwanted popup/redirect navigation for Magnetar Shield                                                                                             |
| `declarativeNetRequest` (Chrome) | Block requests to sites on the user's Shield blocklist at the browser network level                                                                                |
| `downloads`                      | Open the browser downloads area from the Magnetar toolbar where supported                                                                                          |
| `clipboardWrite`                 | Copy magnet links, hashes, pairing codes, or other user-requested values to the clipboard                                                                          |
| `activeTab`                      | Access the current page when the user interacts with Magnetar so the extension can detect torrent hashes and magnet links                                          |
| `scripting` (Chrome)             | Run Magnetar content/helper scripts needed for page detection                                                                                                      |
| `<all_urls>`                     | Allow Magnetar to detect magnet links and torrent hashes on webpages where the user chooses to use the extension                                                   |

## Data retention and deletion

Data stored by Magnetar remains on the user's device unless the user deletes it, clears extension storage, removes the extension, or uses a Magnetar feature that removes it.

If Magnetar Sync is enabled, synced Magnetar metadata may remain in the encrypted sync vault until replaced, cleared, or deleted through the sync flow.

Users can remove local Magnetar data by clearing extension storage or uninstalling the extension. Users should also remove provider API keys or credentials from Magnetar settings if they no longer want Magnetar to use a provider.

## Open source

Magnetar is fully open source under the MIT licence. You can review the codebase at [github.com/ArrCee76/magnetar](https://github.com/ArrCee76/magnetar).

## Contact

If you have questions about this policy, open an issue on the [GitHub repository](https://github.com/ArrCee76/magnetar/issues).

_Last updated: July 2026_
