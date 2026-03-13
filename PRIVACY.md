# Privacy Policy

**Magnetar** is a browser extension that runs entirely in your browser. This policy explains what data it handles and how.

## What Magnetar does not do

- Does not collect any personal data
- Does not use analytics or telemetry
- Does not track your browsing activity
- Does not send data to any third-party services
- Does not store or transmit your browsing history
- Does not display ads

## What data is stored

Magnetar stores the following data locally in your browser's extension storage:

- **Your chosen download mode** (Local Client, Real-Debrid, RDT Client, or TorBox)
- **Service credentials** (API keys or server URLs you enter in settings)
- **Shield blocklist** (domains you've chosen to block)
- **Custom site rules** (detection patterns you've configured)
- **Preferences** (banner position, category mappings)

All of this data stays on your device. It is never transmitted anywhere except as described below.

## Network requests

Magnetar only makes network requests to the download service you have configured:

- **Local Client mode** - no network requests at all
- **Real-Debrid mode** - requests to `api.real-debrid.com` to validate your API key, check cache status, and send magnet links
- **RDT Client mode** - requests to the server URL you provide (your own self-hosted instance) for authentication and sending magnet links. If you also provide a Real-Debrid API key for cache checking, requests are made to `api.real-debrid.com` for that purpose
- **TorBox mode** - requests to `api.torbox.app` to validate your API key, check cache status, and send magnet links

No requests are made to any other servers. Magnetar does not phone home.

## Permissions

Magnetar requests browser permissions for the following reasons:

| Permission | Why it's needed |
|---|---|
| `storage` | Save your settings, credentials, blocklist, and custom rules |
| `contextMenus` | Right-click menu to block/unblock sites |
| `tabs` | Detect blocked tabs and update the extension icon |
| `webNavigation` | Intercept navigations to blocked sites |
| `declarativeNetRequest` (Chrome) | Block requests to sites on your Shield blocklist |
| `webRequest` (Firefox) | Block requests to sites on your Shield blocklist |
| `clipboardWrite` | Copy magnet links and hashes to your clipboard |
| `activeTab` | Access the current page to detect torrent hashes |
| `<all_urls>` | Run hash detection on any page you visit |

## Open source

Magnetar is fully open source under the MIT licence. You can review the entire codebase at [github.com/ArrCee76/magnetar](https://github.com/ArrCee76/magnetar).

## Contact

If you have questions about this policy, open an issue on the [GitHub repository](https://github.com/ArrCee76/magnetar/issues).

*Last updated: March 2026*
