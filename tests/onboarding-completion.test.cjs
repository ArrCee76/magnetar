const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function runCompletionPreview(browser) {
  const source = fs.readFileSync(path.join(root, browser, 'onboarding-complete.js'), 'utf8');
  const listeners = new Map();
  const classes = new Set();
  const attributes = new Map();
  const banner = { classList: { toggle(name, force) { if (force) classes.add(name); else classes.delete(name); } } };
  const expand = {
    title: 'Expand',
    addEventListener: addListener('preview-expand'),
    setAttribute(name, value) { attributes.set(name, value); },
    getAttribute(name) { return attributes.get(name); }
  };
  const expanded = { hidden: true };
  const hint = { hidden: true, textContent: '' };
  const finish = { disabled: false, addEventListener: addListener('finish') };
  const fallback = { hidden: true };
  const action = {
    dataset: { purpose: 'Sends a detected item to the selected provider.' },
    addEventListener: addListener('action')
  };
  function addListener(key) {
    return (event, callback) => listeners.set(`${key}:${event}`, callback);
  }

  const documentListeners = new Map();
  const document = {
    visibilityState: 'visible',
    addEventListener: (event, callback) => documentListeners.set(event, callback),
    getElementById(id) {
      return ({ 'magnetar-banner': banner, 'preview-expand': expand, 'preview-expanded': expanded,
        'preview-hint': hint, 'complete-finish': finish, 'close-fallback': fallback })[id] || null;
    },
    querySelectorAll(selector) { return selector === '.preview-action' ? [action] : []; }
  };
  let timeoutCallback;
  let closeCalls = 0;
  const context = {
    document,
    window: { close() { closeCalls++; }, setTimeout(callback) { timeoutCallback = callback; } },
    setTimeout
  };
  vm.runInNewContext(source, context, { filename: `${browser}/onboarding-complete.js` });
  documentListeners.get('DOMContentLoaded')();

  listeners.get('preview-expand:click')();
  assert.equal(expanded.hidden, false);
  assert.equal(attributes.get('aria-expanded'), 'true');
  assert.equal(classes.has('magnetar-expanded'), true);
  listeners.get('preview-expand:click')();
  assert.equal(expanded.hidden, true);
  assert.equal(attributes.get('aria-expanded'), 'false');
  assert.equal(classes.has('magnetar-expanded'), false);

  listeners.get('action:click')();
  assert.equal(hint.hidden, false);
  assert.match(hint.textContent, /Preview only/);
  assert.match(hint.textContent, /selected provider/);

  listeners.get('finish:click')();
  assert.equal(closeCalls, 1);
  timeoutCallback();
  assert.equal(fallback.hidden, false);
  assert.equal(finish.disabled, false);
}

for (const browser of ['chrome', 'firefox']) {
  test(`${browser}: preview expands/collapses safely and actions stay informational`, () => {
    runCompletionPreview(browser);
  });

  test(`${browser}: setup navigates only after settings and onboarding state save`, () => {
    const source = fs.readFileSync(path.join(root, browser, 'onboarding.js'), 'utf8');
    const finishHandler = source.match(/document\.getElementById\('finish'\)[\s\S]*?\n  \}\);/);
    assert.ok(finishHandler);
    const handler = finishHandler[0];
    assert.ok(handler.indexOf('await savePreferences()') < handler.indexOf("storage.local.set({ 'magnetar-onboarded': true })"));
    assert.ok(handler.indexOf("storage.local.set({ 'magnetar-onboarded': true })") < handler.indexOf("window.location.href = 'onboarding-complete.html'"));
    assert.ok(fs.existsSync(path.join(root, browser, 'onboarding-complete.html')));
    const html = fs.readFileSync(path.join(root, browser, 'onboarding-complete.html'), 'utf8');
    assert.match(html, /Toolbar preview/);
    assert.match(html, /You’re all set!/);
  });
}
