const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Execute the full script so early startup returns retain their real bindings.
for (const browser of ['chrome', 'firefox']) {
  for (const startup of ['no detection', 'ignored site', 'banner disabled', 'dismissed', 'settings pending']) {
    test(`${browser}: web sync survives ${startup}`, async () => {
      const listeners = new Map();
      const requests = [];
      const results = [];
      let resolveSettings;
      const detection = { hash: 'a'.repeat(40), magnetUri: 'magnet:?xt=urn:btih:' + 'a'.repeat(40) };
      const settings = {
        mode: 'local', preferences: { bannerEnabled: startup !== 'banner disabled' },
        ignoredWebsites: startup === 'ignored site' ? ['example.com'] : [],
      };
      const context = {
        console: { info() {}, error() {} }, URL, URLSearchParams,
        document: { body: {}, contentType: 'text/html', getElementById: () => null },
        location: { hostname: 'example.com', pathname: '/', origin: 'https://example.com' },
        addEventListener: (name, handler) => listeners.set(name, handler),
        dispatchEvent: event => results.push(JSON.parse(event.detail)),
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        MagnetarDetector: { detect: () => startup === 'no detection' ? null : detection, detectAll: () => [] },
        MagnetarCategories: { detect: () => null },
        MAGNETAR_API: {
          i18n: { getMessage: key => key },
          runtime: {
            onMessage: { addListener() {} },
            async sendMessage(message) {
              requests.push(message.type);
              if (message.type === 'get-settings') return startup === 'settings pending'
                ? new Promise(resolve => { resolveSettings = resolve; }) : settings;
              if (message.type === 'get-quick-send-providers') return [];
              if (message.type === 'selfhost-get') return { paired: true, serverUrl: 'https://example.com' };
              if (message.type === 'hard-sync-all') return { ok: true, mergedChanges: 2 };
              return {};
            },
          },
        },
      };
      context.window = context;
      context.top = context;
      if (startup === 'dismissed' || startup === 'settings pending') context._magnetarDismissed = [detection.hash];
      vm.createContext(context);
      const boot = vm.runInContext(fs.readFileSync(path.join(__dirname, '..', browser, 'content.js'), 'utf8'), context);
      if (startup !== 'settings pending') await boot;
      await listeners.get('magnetar:hard-sync-all-request')({ detail: JSON.stringify({
        protocol: 3, command: 'MAGNETAR_HARD_SYNC_ALL', requestId: 'initialization-regression',
      }) });
      if (resolveSettings) { resolveSettings(settings); await boot; }
      assert.equal(requests.filter(type => type === 'hard-sync-all').length, 1);
      assert.equal(results.length, 1);
      assert.equal(results[0].ok, true, results[0].error);
      assert.equal(results[0].mergedChanges, 2);
    });
  }
}
