const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const chromeCss = fs.readFileSync(path.join(root, 'chrome', 'content.css'), 'utf8');
const firefoxCss = fs.readFileSync(path.join(root, 'firefox', 'content.css'), 'utf8');

assert.equal(chromeCss, firefoxCss, 'Chrome and Firefox must share the same Glass styling');

// Primary Glass controls must use translucent day/night tokens, never the old
// opaque inverted black/white gradients.
assert.doesNotMatch(chromeCss, /--mg-primary-liquid:\s*linear-gradient\([^;]*#[0-9a-f]{3,8}/i);
assert.match(chromeCss, /--mg-primary-liquid:\s*linear-gradient\([^;]*rgba\([^;]+\);/);
assert.match(chromeCss, /--mg-primary-liquid-hover:/);
assert.match(chromeCss, /--mg-primary-liquid-pressed:/);
assert.match(chromeCss, /color:\s*var\(--mg-primary-ink\)\s*!important/);

// Later consolidated split-button rules are Classic-only. Glass owns its
// surfaces, text, borders, and state styling through the shared theme rules.
assert.match(chromeCss, /#magnetar-banner:not\(\.magnetar-glass-mode\) \.magnetar-provider-split > \.magnetar-btn/);
assert.match(chromeCss, /#magnetar-batch:not\(\.magnetar-glass-mode\) \.magnetar-provider-split > \.magnetar-btn/);
assert.match(chromeCss, /#magnetar-banner:not\(\.magnetar-glass-mode\) \.magnetar-review-split > \.magnetar-btn/);

// The Classic declarations remain present and continue using their existing
// surface/ink treatment; only their scope changed.
assert.match(chromeCss, /\.magnetar-provider-split > \.magnetar-btn \{\s*border-color: var\(--mg-border-mid\) !important;\s*background: var\(--mg-surface-2\) !important;/);
assert.match(chromeCss, /\.magnetar-provider-split > \.magnetar-split-toggle[\s\S]*background: var\(--mg-surface-2\) !important;/);

// Split geometry and interaction/accessibility states remain shared and
// Glass uses one subtle internal separator.
assert.match(chromeCss, /\.magnetar-glass-mode \.magnetar-split-control > \.magnetar-split-toggle[\s\S]*border-left-color: var\(--mg-glass-outline-soft\) !important;/);
assert.match(chromeCss, /\.magnetar-glass-mode \.magnetar-split-control > \.magnetar-btn:first-child[\s\S]*border-right-color: transparent !important;/);
assert.match(chromeCss, /\.magnetar-glass-mode :is\(button, a, select, input, \[tabindex\]\):focus-visible/);
assert.match(chromeCss, /\.magnetar-glass-mode :is\(button, select\):disabled/);

console.log('Glass theme CSS checks passed');
