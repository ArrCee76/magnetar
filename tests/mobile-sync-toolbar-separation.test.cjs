const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const chromeContent = fs.readFileSync(path.join(root, 'chrome', 'content.js'), 'utf8');
const firefoxContent = fs.readFileSync(path.join(root, 'firefox', 'content.js'), 'utf8');
const chromeBackground = fs.readFileSync(path.join(root, 'chrome', 'background.js'), 'utf8');
const firefoxBackground = fs.readFileSync(path.join(root, 'firefox', 'background.js'), 'utf8');

function extractFunction(source, name, async = false) {
  const marker = `${async ? 'async ' : ''}function ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let index = brace; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unclosed ${name}`);
}

test('toolbar exposes distinct exact Mobile and My Magnetar controls', () => {
  for (const source of [chromeContent, firefoxContent]) {
    assert.ok(source.includes('id="magnetar-mobile-sync-open" data-action="mobile-sync-open" title="Open Magnetar Mobile sync" aria-label="Sync Mobile"'));
    assert.ok(source.includes('<span>Sync Mobile</span>'));
    assert.match(source, /id="magnetar-banner-my-magnetar"[^>]*aria-label="My Magnetar"/);
    assert.equal((source.match(/id="magnetar-mobile-sync-open"/g) || []).length, 1);
    assert.equal((source.match(/id="magnetar-banner-my-magnetar"/g) || []).length, 1);
  }
});

test('toolbar click handlers are explicit and cannot cross-wire after reinjection', () => {
  for (const source of [chromeContent, firefoxContent]) {
    const injectBanner = extractFunction(source, 'injectBanner');
    assert.match(injectBanner, /querySelector\('#magnetar-mobile-sync-open'\)[\s\S]*?void openMobileSyncPanel\(\)/);
    assert.match(injectBanner, /querySelector\('#magnetar-banner-my-magnetar'\)[\s\S]*?void openMyMagnetarPanel\(\)/);
    const mobileHandler = injectBanner.match(/querySelector\('#magnetar-mobile-sync-open'\)[\s\S]*?\n    \}\);/)?.[0] || '';
    assert.doesNotMatch(mobileHandler, /hard-sync-all|runHardSyncAllFromExtension|openMyMagnetarPanel/);
    const myHandler = injectBanner.match(/querySelector\('#magnetar-banner-my-magnetar'\)[\s\S]*?\n    \}\);/)?.[0] || '';
    assert.doesNotMatch(myHandler, /openMobileSyncPanel|toggleMobileSyncPanel/);
  }
});

test('My Magnetar hard-sync progress never mutates the Sync Mobile toolbar control', () => {
  for (const source of [chromeContent, firefoxContent]) {
    const fn = extractFunction(source, 'updateHardSyncUi');
    assert.doesNotMatch(fn, /magnetar-mobile-sync-open|Sync Mobile/);
    assert.match(fn, /magnetar-my-sync/);
    const mobile = { disabled: false, attributes: {}, classList: { toggle() {} }, querySelector() { return { textContent: 'Sync Mobile' }; }, setAttribute(name, value) { this.attributes[name] = value; } };
    const myLabel = { textContent: 'Sync now' };
    const my = { disabled: false, attributes: {}, classList: { toggle() {} }, querySelector() { return myLabel; }, setAttribute(name, value) { this.attributes[name] = value; } };
    const context = { document: { getElementById(id) { return id === 'magnetar-my-sync' ? my : id === 'magnetar-mobile-sync-open' ? mobile : null; } } };
    vm.createContext(context);
    vm.runInContext(`${fn}; updateHardSyncUi('pulling-self-hosted', 'Pulling My Magnetar')`, context);
    assert.equal(mobile.disabled, false);
    assert.deepEqual(mobile.attributes, {});
    assert.equal(my.disabled, true);
    assert.equal(myLabel.textContent, 'Pulling My Magnetar');
  }
});

test('Mobile panel retains pairing, QR, copy, hosted pull/push, Review and unpair routes', () => {
  for (const source of [chromeContent, firefoxContent]) {
    for (const token of [
      'magnetar-sync-state-root', 'magnetar-sync-create-pairing', 'magnetar-sync-show-qr',
      'magnetar-sync-copy-pairing', 'magnetar-sync-reset-pairing', 'magnetar-sync-mobile-link',
      'magnetar-sync-pull-panel', 'magnetar-sync-push-saved-history', 'buildSyncCategoryIndicators',
      "type: 'sync-pull-saved-history'", "type: 'sync-push-saved-history'", "type: 'sync-send-app-review'",
      "type: 'get-sync-settings'", "type: 'get-sync-mobile-ack'", "type: 'clear-sync-settings'"
    ]) assert.ok(source.includes(token), `Mobile panel route missing ${token}`);
  }
});

test('runtime routes and adapter checkpoints remain independent and backward compatible', () => {
  assert.equal(chromeContent, firefoxContent);
  assert.equal(chromeBackground, firefoxBackground);
  assert.match(chromeContent, /MAGNETAR_OPEN_MOBILE_SYNC_PANEL/);
  assert.match(chromeContent, /'open-sync-panel'/);
  assert.match(chromeBackground, /case 'MAGNETAR_OPEN_MOBILE_SYNC_PANEL':[\s\S]*case 'open-sync-panel':/);
  assert.match(chromeBackground, /const SELF_HOSTED_STORAGE_KEY = 'magnetar-self-hosted'/);
  const syncData = fs.readFileSync(path.join(root, 'chrome', 'lib', 'sync-data.js'), 'utf8');
  assert.match(syncData, /HOSTED_CHECKPOINT_KEY = 'magnetar-sync-hosted-checkpoint'/);
  assert.notEqual('magnetar-self-hosted', 'magnetar-sync-hosted-checkpoint');
});
