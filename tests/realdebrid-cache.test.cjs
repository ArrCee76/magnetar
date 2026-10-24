const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
function loadProvider(browser, fetch) {
  const context = { self: {}, magnetarFetch: fetch };
  vm.runInNewContext(fs.readFileSync(path.join(root, browser, 'lib/providers/realdebrid.js'), 'utf8'), context);
  return context.self.ProviderRealDebrid;
}
function loadCacheStore(browser, initial = {}) {
  const storage = { ...initial };
  const api = { storage: { local: {
    async get(keys) { return Object.fromEntries(keys.map(key => [key, storage[key]])); },
    async set(values) { Object.assign(storage, values); },
    async remove(keys) { for (const key of keys) delete storage[key]; }
  } } };
  const context = { self: {}, MAGNETAR_API: api, setTimeout, clearTimeout, Date, Map, Object, Number, String };
  vm.runInNewContext(fs.readFileSync(path.join(root, browser, 'lib/cache-store.js'), 'utf8'), context);
  return { store: context.self.MagnetarCacheStore, storage };
}

for (const browser of ['chrome', 'firefox']) {
  test(`${browser}: RD cache checks never promote unresolved or error results`, async () => {
    let calls = 0;
    const provider = loadProvider(browser, async () => {
      calls++;
      return { ok: true, json: async () => ({ id: 'temporary', status: 'waiting_files_selection' }) };
    });
    assert.equal(await provider.checkCache('a'.repeat(40), { apiKey: 'mock' }), 'unknown');
    assert.equal(calls, 0, 'check must not create, select, inspect, or delete an account torrent');
    const timeoutProvider = loadProvider(browser, async () => { throw new Error('timeout'); });
    assert.equal(await timeoutProvider.checkCache('b'.repeat(40), { apiKey: 'mock' }), 'unknown');
  });

  test(`${browser}: legacy RD entries are invalidated once and send success cannot repopulate`, async () => {
    const existing = {
      'realdebrid:oldcached': { status: 'cached', savedAt: Date.now() },
      'realdebrid:oldnegative': { status: 'not_cached', savedAt: Date.now() },
      'torbox:keep': { status: 'cached', savedAt: Date.now() }
    };
    const saved = { folder: 'Bills' };
    const history = [{ hash: 'preserve' }];
    const settings = { provider: 'realdebrid' };
    const { store, storage } = loadCacheStore(browser, {
      'magnetar-cache-store': existing,
      'magnetar-saved': saved,
      'magnetar-history': history,
      'magnetar-settings': settings
    });
    assert.equal(await store.get('realdebrid', 'oldcached'), null);
    assert.equal(storage['magnetar-cache-store']['realdebrid:oldcached'], undefined);
    assert.equal(storage['magnetar-cache-store']['realdebrid:oldnegative'], undefined);
    assert.deepEqual(storage['magnetar-cache-store']['torbox:keep'], existing['torbox:keep']);
    assert.equal(storage['magnetar-cache-store-version'], 2);
    assert.deepEqual(storage['magnetar-saved'], saved);
    assert.deepEqual(storage['magnetar-history'], history);
    assert.deepEqual(storage['magnetar-settings'], settings);
    store.set('realdebrid', 'sent-hash', 'cached');
    assert.equal(await store.get('realdebrid', 'sent-hash'), null);
    store.set('torbox', 'sent-hash', 'cached');
    assert.equal((await store.get('torbox', 'sent-hash')).status, 'cached');
  });
}
