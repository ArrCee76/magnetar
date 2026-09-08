# UTF-8 audit

## Findings

The primary cause was corruption already committed in both copies of
content.js. The files were valid UTF-8, but some literals contained text produced
by earlier incorrect decoding: a UTF-8 replacement character decoded as legacy
Western text, a double-encoded middle dot, and a misdecoded ellipsis. Several
arrows and status glyphs had also been reduced to ASCII question marks.
The precise editor or command that originally damaged those strings cannot be
established from the current files. Adding a charset declaration cannot repair
characters already lost from a source literal.

A separate runtime display defect existed in batch name truncation: it sliced
UTF-16 code units after HTML escaping. This could split a surrogate pair or an
HTML entity. It now truncates code points before escaping. Full names in titles,
storage and send payloads are preserved.

No incorrect runtime transcoding or storage serialization was found. The
extension ships vanilla source directories without a bundler in this repository.
Stale development copies propagated the source defects; packaging is not the
origin. The new archives were checked byte-for-byte against source.

## Scope checked

- Every project text source, including JavaScript, HTML, CSS, SVG, JSON, and all
  locale message files; strict UTF-8 decoding and raw/escaped corruption checks.
- All eight extension HTML documents already declare UTF-8.
- CSS generated content, inline templates, buttons, dropdowns, badges and branding.
- Detector DOM textContent reads and magnet URL parsing.
- escapeHtml and escapeAttr use native DOM escaping, with no legacy transcoding.
- Background/content/popup messages and extension storage preserve strings as
  structured data. There is no localStorage transcoding path.
- encodeURIComponent/decodeURIComponent are used for URL/form components and
  the existing legacy percent-encoded magnet format.
- TextEncoder/TextDecoder correctly wrap JSON encryption as UTF-8.
- atob/btoa operate on bytes in sync encryption and UTF-8 QR payloads.
- Buffer operations in tests handle binary artifacts and fixture response bytes.
- No escape/unescape-based manual UTF-8 repair path was found.
- Historical archives, browser profiles and test artifacts are excluded from the
  source cleanliness assertion. Old release archives were deliberately retained.

## Affected rendering paths

Both chrome/content.js and firefox/content.js:

- populateExpanded: saved-name fallbacks and unavailable cache-rate placeholder.
  The user's existing footer branding fix was preserved.
- populateExpanded's saved-send handler: loading ellipsis.
- renderOrganisedOpenFolder: folder metadata separator.
- bindActivityActions: resend loading label.
- injectBatchPanel / buildRows: seed arrow, metadata middle dot, truncation.
- injectBatchPanel: initial stats placeholders, sort arrows/ranges, success and
  failure badges.
- refreshDrawer: saved-name fallback, empty cache-rate placeholder, sending label.
- Corrupted comments were corrected as well.

buildDetectionDetailsPanel, formatRelative, formatFileSize, history metadata
separators, and native escaping were inspected; their encoding was already
correct. The broken stats alongside Detection Details came from populateExpanded.

No saved-data migration was added. The damaged literals are presentation strings,
not persisted names. There is no evidence warranting rewriting user content.

## Files changed

Source and audit files:

- .editorconfig: explicitly select UTF-8 for editors.
- chrome/content.js
- firefox/content.js
- tests/encoding.test.cjs
- tests/encoding-chromium-smoke.cjs
- tests/encoding-firefox-smoke.cjs
- ENCODING_AUDIT.md

Generated development files refreshed from their canonical source directories
(the directories were stale before this task):

- dist/dev/chrome/content.css
- dist/dev/chrome/content.js
- dist/dev/chrome/manifest.json
- dist/dev/chrome/options.html
- dist/dev/chrome/popup.html
- dist/dev/firefox/background.js
- dist/dev/firefox/content.css
- dist/dev/firefox/content.js
- dist/dev/firefox/lib/selfhost-sync.js
- dist/dev/firefox/lib/sync-data.js
- dist/dev/firefox/lib/sync-diagnostics.js
- dist/dev/firefox/manifest.json
- dist/dev/firefox/options.html
- dist/dev/firefox/options.js
- dist/dev/firefox/popup.html

New test packages:

- dist/magnetar-chrome-2.2.13-encoding-fixed.zip
- dist/magnetar-firefox-2.2.13-encoding-fixed.xpi

Pre-existing changes to manifests, HTML, footer branding and chromium-smoke.cjs
were preserved. They are not new source changes made by this audit.

## Verification

Run:

    node --test tests/*.test.cjs
    node tests/encoding-chromium-smoke.cjs
    node tests/encoding-firefox-smoke.cjs

The Firefox test uses web-ext 8.5.0 and an isolated copied extension with a small
test-only background script that seeds Advanced mode and Unicode history.
The Chrome test seeds an isolated profile through its extension API.

Coverage:

- 31 regression checks, including existing sending normalization, ordering,
  sharing, site/UI contracts and sync convergence checks.
- Strict UTF-8 validity, valid JSON, charset declarations, raw and escaped
  corruption scans across project source.
- Unicode magnet parsing, send normalization and encrypted JSON round trips in
  both browser implementations.
- Long-name regression cases at emoji and HTML-entity truncation boundaries.
- Chrome and Firefox rendered DOM text, attributes, and CSS pseudo-element
  content for toolbar, saved/history, Detection Details/stats, footer, dropdown,
  batch metadata and sort labels, in normal/Glass and light/dark themes.
- Chrome additionally tests Windows-1252 host pages, empty-history stats, popup,
  options, onboarding and What's New pages.
- No live provider sends were performed. Firefox extension-page DOMs beyond the
  injected toolbar/panels are covered by source checks, not live page assertions.
- Generated development copies match source; every file in each new archive is
  byte-identical to its source file.
