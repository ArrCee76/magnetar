const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const chromeContent = read('chrome', 'content.js');
const firefoxContent = read('firefox', 'content.js');
const chromeCss = read('chrome', 'content.css');
const firefoxCss = read('firefox', 'content.css');
const chromeBackground = read('chrome', 'background.js');
const firefoxBackground = read('firefox', 'background.js');
const chromeSelfHostedSync = read('chrome', 'lib', 'selfhost-sync.js');
const firefoxSelfHostedSync = read('firefox', 'lib', 'selfhost-sync.js');
const chromeHostedSyncData = read('chrome', 'lib', 'sync-data.js');
const firefoxHostedSyncData = read('firefox', 'lib', 'sync-data.js');
const firefoxManifest = JSON.parse(read('firefox', 'manifest.json'));

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `Missing function ${name}`);
  const signatureEnd = source.indexOf(') {', start);
  assert.notEqual(signatureEnd, -1, `Missing body for function ${name}`);
  const brace = signatureEnd + 2;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = brace; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed function ${name}`);
}

assert.equal(chromeContent, firefoxContent, 'Chrome and Firefox content UI must remain identical');
assert.equal(chromeCss, firefoxCss, 'Chrome and Firefox content styling must remain identical');
assert.equal(chromeBackground, firefoxBackground, 'Chrome and Firefox background sync logic must remain identical');
assert.equal(chromeSelfHostedSync, firefoxSelfHostedSync, 'Chrome and Firefox must use identical self-hosted reconciliation logic');
assert.equal(chromeHostedSyncData, firefoxHostedSyncData, 'Chrome and Firefox must use identical hosted/self-hosted Organised ownership logic');
assert.doesNotMatch(chromeHostedSyncData, /selfHostedOwnsOrganisedFolders|organisedFoldersPreserved/);
assert.match(chromeHostedSyncData, /magnetar-sync-hosted-checkpoint/);
assert.match(chromeHostedSyncData, /reconcileReplica/);
assert.ok(chromeBackground.includes("'lib/selfhost-sync.js'"), 'Chrome service worker must load the v2 engine');
assert.ok(firefoxManifest.background.scripts.includes('lib/selfhost-sync.js'), 'Firefox background must load the v2 engine');

assert.match(chromeContent, /Review: Mobile/);
assert.match(chromeContent, /Review: \${target\.label}/);
assert.match(chromeContent, /reviewDestination: currentReviewTarget/);
assert.match(chromeContent, /id: 'my-magnetar', label: 'My Magnetar'/);
assert.match(chromeContent, /Sent to My Magnetar Review/);
assert.match(chromeContent, /Mobile Review: \${sent} sent, 0 duplicates, 0 failed/);
assert.match(chromeContent, /My Magnetar Review: \${sent} sent, \${duplicates}/);
assert.match(chromeContent, /id="magnetar-mobile-sync-open"[^>]*aria-label="Sync Mobile"/);
assert.match(chromeContent, /id="magnetar-banner-my-magnetar"[^>]*aria-label="My Magnetar"/);
assert.match(chromeContent, /id="magnetar-banner-my-magnetar"/);
assert.match(chromeContent, /id="magnetar-my-connect-form"/);
assert.match(chromeContent, /id="magnetar-my-sync"/);
assert.match(chromeContent, /id="magnetar-my-disconnect"/);
assert.doesNotMatch(chromeContent, /Pair Magnetar Self-Hosted/);
assert.match(chromeContent, /magnetar:hard-sync-all-request/);
assert.match(chromeContent, /magnetar:hard-sync-all-result/);
assert.match(chromeContent, /new URL\(connection\.serverUrl\)\.origin !== window\.location\.origin/);
assert.match(chromeContent, /hardSyncWebInFlight/);
assert.match(chromeContent, /Retry sync/);
assert.match(chromeContent, /async function refreshVisibleExtensionState/);
assert.match(chromeContent, /await refreshVisibleExtensionState\(\)/);
assert.match(chromeContent, /MAGNETAR_API\.storage\.onChanged\.addListener/);
for (const key of ['magnetar-saved', 'magnetar-history', 'magnetar-organised-folders']) {
  assert.ok(chromeContent.includes(key), `Canonical UI refresh must observe ${key}`);
}

assert.match(chromeCss, /magnetar-provider-split[\s\S]*border-left-color: var\(--mg-ink\)/);
assert.match(chromeCss, /magnetar-review-split > \.magnetar-split-toggle/);
assert.match(chromeCss, /magnetar-sync-connected-copy h2[\s\S]*background: transparent !important/);
assert.match(chromeCss, /\.magnetar-my-panel/);

for (const source of [chromeBackground, firefoxBackground]) {
  assert.match(source, /POST|method: 'POST'/);
  for (const endpoint of [
    '/api/v1/pair',
    '/api/v1/capabilities',
    '/api/v1/intake/single',
    '/api/v1/intake/batch',
    '/api/v1/sync/push',
    '/api/v1/sync/changes',
    '/api/v1/sync/ack',
  ]) assert.ok(source.includes(endpoint), `Missing My Magnetar endpoint ${endpoint}`);
  assert.ok(source.includes("'https://arrcee.com/my-magnetar/'"), 'Missing central My Magnetar product URL allow-list entry');
  assert.match(source, /My Magnetar could not be reached/);
  assert.doesNotMatch(source, /Set up Magnetar Self-Hosted first/);
  assert.match(source, /let selfHostedSyncInFlight = null/);
  assert.match(source, /runSelfHostedExclusive/);
  assert.match(source, /executeHardSyncAll/);
  assert.match(source, /SYNC_FOLDER_NAME_CONFLICT|conflictingRecordId/);
  assert.match(source, /SYNC_NOT_CONVERGED/);
  assert.match(source, /post-apply-verification/);
  assert.match(source, /persistedReconcile/);
  assert.match(source, /initialStorageSignature/);
}
assert.match(chromeSelfHostedSync, /_selfHostedSync/);
assert.match(chromeSelfHostedSync, /historyFingerprint/);
assert.match(chromeSelfHostedSync, /semanticDiff/);
assert.match(chromeSelfHostedSync, /semanticDiffs/);
assert.match(chromeBackground, /checkpointSchemaVersion = 4/);
assert.match(chromeContent, /stage: 'result-returned-to-page'/);
assert.match(chromeContent, /selfHostedPaired/);

const normaliseSource = extractFunction(chromeBackground, 'normaliseSelfHostedUrl');
const normalise = vm.runInNewContext(`(${normaliseSource})`, { URL });
assert.equal(normalise('http://192.168.1.111:8732///'), 'http://192.168.1.111:8732');
assert.equal(normalise('https://magnetar.example.com/'), 'https://magnetar.example.com');
assert.throws(() => normalise('magnetar.example.com'), /http:\/\//);
assert.throws(() => normalise('https://user:pass@example.com'), /credentials/);

const sourceUrlSanitiserSource = extractFunction(chromeBackground, 'sanitiseSelfHostedSourceUrl');
const sanitiseSourceUrl = vm.runInNewContext(`(${sourceUrlSanitiserSource})`, { URL });
for (const value of [undefined, null, '', '   ', 'not a url', '/relative', 'ftp://example.com/file']) {
  assert.equal(sanitiseSourceUrl(value), undefined);
}
assert.equal(sanitiseSourceUrl('  http://example.com/item  '), 'http://example.com/item');
assert.equal(sanitiseSourceUrl('https://example.com/item?q=1'), 'https://example.com/item?q=1');

const intakeSource = extractFunction(chromeBackground, 'selfHostedIntakeItem');
const itemMetadataSource = extractFunction(chromeBackground, 'sanitiseSelfHostedItemMetadata');
const sanitiseItemMetadata = vm.runInNewContext(`(${itemMetadataSource})`, { Date, Number, sanitiseSelfHostedSourceUrl: sanitiseSourceUrl });
const intake = vm.runInNewContext(`(${intakeSource})`, { Date, sanitiseSelfHostedSourceUrl: sanitiseSourceUrl, sanitiseSelfHostedItemMetadata: sanitiseItemMetadata });
const mapped = intake({
  title: 'Human readable title',
  magnetUri: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Human',
  hash: '0123456789abcdef0123456789abcdef01234567',
  sourceUrl: 'https://example.com/item',
  sourceDomain: 'example.com',
  category: 'video',
  addedAt: 123,
});
assert.equal(mapped.displayName, 'Human readable title');
assert.equal(mapped.detectedAt, 123);
assert.equal(mapped.sourceUrl, 'https://example.com/item');
assert.equal(mapped.category, 'video');
assert.ok(mapped.value.startsWith('magnet:?'));
assert.equal(Object.hasOwn(intake({ hash: mapped.hash, sourceUrl: '' }), 'sourceUrl'), false);
assert.equal(Object.hasOwn(intake({ hash: mapped.hash, sourceUrl: 'javascript:alert(1)' }), 'sourceUrl'), false);
assert.equal(JSON.stringify(sanitiseItemMetadata({ title: 'Legacy', sourceUrl: '   ' })), JSON.stringify({ title: 'Legacy' }));
assert.equal(JSON.stringify(sanitiseItemMetadata({ title: 'Web', sourceUrl: ' https://example.com/item ' })), JSON.stringify({ title: 'Web', sourceUrl: 'https://example.com/item' }));
assert.equal(sanitiseItemMetadata({ title: 'Folder item', updatedAt: '2026-07-20T10:00:00.000Z' }).updatedAt, Date.parse('2026-07-20T10:00:00.000Z'));
assert.equal(Object.hasOwn(sanitiseItemMetadata({ title: 'Folder item', magnet: null }), 'magnet'), false);

const sanitiserUses = chromeBackground.match(/sanitiseSelfHostedSourceUrl\(/g) || [];
assert.ok(sanitiserUses.length >= 3, 'Shared source URL sanitiser must cover My Magnetar metadata serialisation');
const metadataSanitiserUses = chromeBackground.match(/sanitiseSelfHostedItemMetadata\(/g) || [];
assert.ok(metadataSanitiserUses.length >= 1, 'Shared item metadata sanitiser must cover My Magnetar intake');

console.log('My Magnetar extension contract checks passed.');
