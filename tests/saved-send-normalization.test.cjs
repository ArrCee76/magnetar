const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
function loadNormalizer(browser) {
  const context = { URL, console };
  context.globalThis = context;
  vm.runInNewContext(read(browser, 'lib', 'send-normalization.js'), context);
  return context.MagnetarSendNormalization;
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }

const chrome = loadNormalizer('chrome');
const firefox = loadNormalizer('firefox');
const hashA = '1a3f7dd4d390265657731e38985fb5202e00c465';
const hashB = '49c1d7095fbbddf5d5fa05f85bb40ef0e55df880';
const cases = [
  ['local hash', { item: { hash: hashA, name: 'Local hash' } }],
  ['local magnet', { item: { magnetUri: `magnet:?xt=urn:btih:${hashB}&dn=Local`, name: 'Local magnet' } }],
  ['My Magnetar projection', { item: { stableKey: `hash:${hashA}`, displayName: 'Imported self-hosted', hash: hashA, magnet: `magnet:?xt=urn:btih:${hashA}` } }],
  ['hosted Mobile projection', { item: { itemKey: `hash:${hashB}`, title: 'Imported hosted', infoHash: hashB } }],
  ['legacy projection', { item: { title: 'Legacy', infoHash: hashA } }],
  ['encoded legacy magnet', { item: { name: 'Encoded', magnet: encodeURIComponent(`magnet:?xt=urn:btih:${hashB}`) } }],
];
for (const [label, input] of cases) {
  const a = plain(chrome.normalise(input));
  const b = plain(firefox.normalise(input));
  assert.deepEqual(a, b, `${label}: Chrome/Firefox parity`);
  assert.match(a.magnet, /^magnet:\?xt=urn:btih:[a-f0-9]{40}/i, `${label}: canonical magnet`);
  assert.match(a.itemKey, /^hash:[a-f0-9]{40}$/i, `${label}: canonical identity`);
  assert.equal(chrome.validate(a).ok, true, `${label}: valid for torrent providers`);
}

const direct = plain(chrome.normalise({ hash: hashA, name: 'Same', magnetUri: `magnet:?xt=urn:btih:${hashA}&dn=Same` }));
const saved = plain(chrome.normalise({ item: { hash: hashA, displayName: 'Same', magnet: `magnet:?xt=urn:btih:${hashA}&dn=Same` } }));
assert.deepEqual(saved, direct, 'Saved row and direct toolbar must produce the same canonical request');
const fallback = chrome.normalise({ magnetUri: '', item: { hash: hashA, magnet: `magnet:?xt=urn:btih:${hashA}` } });
assert.equal(fallback.hash, hashA, 'empty modern fields must not obscure valid Saved fallbacks');
const urlRequest = chrome.normalise({ item: { stableKey: 'url:https://example.test/file', title: 'URL item', url: 'https://example.test/file' } });
assert.equal(chrome.validate(urlRequest, { supportsUrl: true }).dispatchField, 'url');
assert.deepEqual(plain(chrome.validate(urlRequest, { supportsUrl: false })), {
  ok: false,
  code: 'SAVED_SEND_INVALID_PAYLOAD',
  error: 'This Saved item does not contain a valid magnet or torrent hash.'
}, 'ordinary webpage URLs must be rejected before a Real-Debrid request');

async function reproduce226Regression() {
  const canonicalSelfHostedSaved = { stableKey: `hash:${hashA}`, displayName: 'Imported self-hosted', hash: hashA, magnet: `magnet:?xt=urn:btih:${hashA}` };
  const oldSavedRowMessage = { hash: canonicalSelfHostedSaved.hash, name: canonicalSelfHostedSaved.displayName, magnetUri: canonicalSelfHostedSaved.magnetUri };
  assert.equal(oldSavedRowMessage.magnetUri, undefined, '2.2.6 Saved row loses the canonical magnet field');
  let requestBody = '';
  const context = { console, URLSearchParams, magnetarFetch: async (_url, init) => { requestBody = init.body; return { ok: false, status: 400, json: async () => ({ error: 'wrong parameter' }) }; } };
  vm.runInNewContext(`
    const ProviderRealDebrid = {
      async sendMagnet(magnetUri, settings) {
        const response = await magnetarFetch('https://api.real-debrid.com/rest/1.0/torrents/addMagnet', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + settings.apiKey,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({ magnet: magnetUri }).toString()
        });
        const data = await response.json();
        return { success: response.ok, error: data.error };
      }
    };
    globalThis.__provider = ProviderRealDebrid;
  `, context);
  const result = await context.__provider.sendMagnet(oldSavedRowMessage.magnetUri, { apiKey: 'redacted' });
  assert.equal(requestBody, 'magnet=undefined', '2.2.6 sends the missing Saved field as the rejected Real-Debrid parameter');
  assert.equal(result.error, 'wrong parameter');
}

async function adapterContract() {
  const calls = [];
  const context = {
    console,
    magnetarFetch: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 201, json: async () => ({ id: 'redacted-test-id' }) };
    }
  };
  vm.runInNewContext(read('chrome', 'lib', 'providers', 'realdebrid.js') + '\n;globalThis.__provider = ProviderRealDebrid;', context);
  const provider = context.__provider;
  const request = chrome.normalise({ item: { hash: hashA, name: 'Adapter contract' } });
  const result = await provider.sendMagnet(request.magnet, { apiKey: 'redacted' });
  assert.equal(result.success, true);
  assert.equal(calls[0].url.endsWith('/torrents/addMagnet'), true);
  assert.equal(new URLSearchParams(calls[0].init.body).get('magnet'), request.magnet, 'Real-Debrid receives the canonical magnet field');
  const callCount = calls.length;
  const invalid = await provider.sendMagnet('https://example.test/page', { apiKey: 'redacted' });
  assert.equal(invalid.code, 'SAVED_SEND_INVALID_PAYLOAD');
  assert.equal(calls.length, callCount, 'invalid URL is rejected without a provider request');
}

const chromeContent = read('chrome', 'content.js');
const firefoxContent = read('firefox', 'content.js');
const chromeBackground = read('chrome', 'background.js');
assert.equal(chromeContent, firefoxContent, 'Saved row UI must match in Chrome and Firefox');
assert.match(chromeContent, /type: 'send-magnet',\s*item,/);
assert.match(chromeContent, /mode: currentQuickSendTarget/);
assert.doesNotMatch(chromeContent, /type: 'send-magnet',[\s\S]{0,220}magnetUri: item\.magnetUri,/);
assert.match(chromeBackground, /const request = MagnetarSendNormalization\.normalise\(msg\)/);
assert.match(chromeBackground, /if \(providerResult\?\.success\)[\s\S]*await commitPostSend/);
assert.match(chromeBackground, /Saved queue: remove only the canonical item confirmed by the provider/);
assert.doesNotMatch(chromeBackground, /await commitPostSend[\s\S]{0,300}if \(providerResult\?\.success\)/);

Promise.all([reproduce226Regression(), adapterContract()]).then(() => console.log('Saved send normalization tests passed')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
