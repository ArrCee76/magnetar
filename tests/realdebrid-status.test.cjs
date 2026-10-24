const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function loadStatus(browser) {
  const context = { self: {}, Map, Number, Math, Date, setTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(root, browser, 'lib/realdebrid-status.js'), 'utf8'), context);
  return context.self.MagnetarRealDebridStatus;
}
function loadProvider(browser, fetch) {
  const context = { self: {}, magnetarFetch: fetch, Date, Number, String, encodeURIComponent };
  vm.runInNewContext(fs.readFileSync(path.join(root, browser, 'lib/providers/realdebrid.js'), 'utf8'), context);
  return context.self.ProviderRealDebrid;
}

for (const browser of ['chrome', 'firefox']) {
  test(`${browser}: RD status reports queued/downloading and requires selected-file links for Ready`, async () => {
    const payloads = [
      { status: 'queued' },
      { status: 'downloading' },
      { status: 'downloaded', files: [{ selected: 1 }, { selected: 1 }], links: ['a', 'b'] },
      { status: 'downloaded', files: [{ selected: 1 }, { selected: 1 }], links: ['a'] }
    ];
    const calls = [];
    const provider = loadProvider(browser, async (url, options) => {
      calls.push({ url, options });
      const info = payloads.shift();
      return { ok: true, status: 200, json: async () => info };
    });
    assert.equal((await provider.getTorrentStatus(12345, { apiKey: 'mock' })).status, 'queued');
    assert.equal((await provider.getTorrentStatus(12345, { apiKey: 'mock' })).status, 'downloading');
    assert.equal((await provider.getTorrentStatus(12345, { apiKey: 'mock' })).ready, true);
    assert.equal((await provider.getTorrentStatus(12345, { apiKey: 'mock' })).ready, false);
    assert.equal(calls.length, 4);
    assert.ok(calls.every(call => call.url.endsWith('/torrents/info/12345') && !call.options.method));
    assert.ok(calls.every(call => call.options.timeout <= 5000));
  });

  test(`${browser}: RD API errors and 429s stay nonfatal and carry a retry delay`, async () => {
    const failing = loadProvider(browser, async () => ({ ok: false, status: 503 }));
    assert.equal((await failing.getTorrentStatus(77, { apiKey: 'mock' })).ok, false);
    const limited = loadProvider(browser, async () => ({
      ok: false,
      status: 429,
      headers: { get: () => '3' }
    }));
    const result = await limited.getTorrentStatus(77, { apiKey: 'mock' });
    assert.equal(result.ok, false);
    assert.equal(result.retryAfterMs, 3000);
  });

  test(`${browser}: bounded polling transitions to Ready and respects Retry-After`, async () => {
    const status = loadStatus(browser);
    const responses = [
      { ok: true, status: 'magnet_conversion' },
      { ok: false, retryAfterMs: 3000 },
      { ok: true, status: 'queued' },
      { ok: true, status: 'downloading' },
      { ok: true, status: 'downloaded', ready: true }
    ];
    const states = [];
    const waits = [];
    let now = 0;
    let calls = 0;
    const final = await status.poll('19', async () => { calls++; return responses.shift(); }, value => states.push(value), {
      now: () => now,
      sleep: async ms => { waits.push(ms); now += ms; },
      timeoutMs: 60000
    });
    assert.equal(final, 'ready');
    assert.equal(calls, 5);
    assert.deepEqual(waits, [1000, 3000, 4000, 8000]);
    assert.deepEqual(states, ['checking', 'checking', 'queued', 'downloading', 'ready']);
  });

  test(`${browser}: polling API errors ends as Sent without changing send success`, async () => {
    const status = loadStatus(browser);
    const states = [];
    const waits = [];
    let calls = 0;
    let now = 0;
    const final = await status.poll('20', async () => { calls++; throw new Error('API offline'); }, value => states.push(value), {
      now: () => now,
      sleep: async ms => { waits.push(ms); now += ms; }
    });
    assert.equal(final, 'sent');
    assert.equal(calls, 6);
    assert.deepEqual(waits, [1000, 2000, 4000, 8000, 10000]);
    assert.equal(states.at(-1), 'sent');
  });

  test(`${browser}: tooltip placement remains inside narrow and desktop viewports`, () => {
    const status = loadStatus(browser);
    const narrow = status.positionTooltip({ left: 302, top: 330, right: 316, bottom: 350, width: 14, height: 20 }, { width: 260, height: 42 }, 320, 640);
    assert.ok(narrow.left >= 12 && narrow.left + 260 <= 308);
    assert.ok(narrow.top >= 12 && narrow.top + 42 <= 628);
    const desktop = status.positionTooltip({ left: 1370, top: 8, right: 1400, bottom: 30, width: 30, height: 22 }, { width: 260, height: 42 }, 1440, 900);
    assert.ok(desktop.left >= 12 && desktop.left + 260 <= 1428);
    assert.ok(desktop.top >= 12 && desktop.top + 42 <= 888);
    const css = fs.readFileSync(path.join(root, browser, 'content.css'), 'utf8');
    assert.match(css, /\.magnetar-rd-status-tooltip\s*\{[^}]*position:\s*fixed/s);
    assert.match(css, /max-width:\s*min\(260px,\s*calc\(100vw\s*-\s*24px\)\)/);
  });
}
