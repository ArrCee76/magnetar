// Full content-script UI smoke with simulated background responses; no live pairing or sync.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(fn, message, timeout = 20000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(150);
  }
  throw lastError || new Error(message);
}

class Cdp {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
  }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!message.id) {
        this.events.push(message);
        return;
      }
      if (!this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression, contextId) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      ...(contextId ? { contextId } : {}),
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed');
    return result.result.value;
  }
  close() { this.socket?.close(); }
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'magnetar-init-'));
  const executable = process.env.CHROME_PATH || 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
  const child = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const server = require('node:http').createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<html><body>Sync initialization test</body></html>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const pageUrl = 'http://127.0.0.1:' + server.address().port;
  let browser, page;
  try {
    const port = await waitFor(() => {
      const file = path.join(profile, 'DevToolsActivePort');
      return fs.existsSync(file) && Number(fs.readFileSync(file, 'utf8').split('\n')[0]);
    }, 'Chrome did not start');
    const version = await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json());
    browser = new Cdp(version.webSocketDebuggerUrl);
    await browser.connect();
    const targets = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json());
    page = new Cdp(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await page.connect();
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    for (const variant of ['chrome', 'firefox']) {
      for (const startup of ['no detection', 'single', 'batch', 'banner disabled']) {
        await page.send('Page.navigate', { url: pageUrl });
        await waitFor(() => page.evaluate('location.origin === ' + JSON.stringify(pageUrl) + ' && document.readyState === "complete"'), 'Page load');
        await page.evaluate(`(() => {
          window.failures = [];
          addEventListener('error', e => failures.push(e.message));
          addEventListener('unhandledrejection', e => failures.push(String(e.reason)));
          window.requests = [];
          window.runtimeListeners = [];
          window.syncResults = [];
          window.pairedMobile = false;
          addEventListener('magnetar:hard-sync-all-result', e => syncResults.push(JSON.parse(e.detail)));
          const detection = { hash: 'a'.repeat(40), name: 'Test torrent', magnetUri: 'magnet:?xt=urn:btih:' + 'a'.repeat(40) };
          window.MagnetarDetector = { detect: () => ${startup === 'no detection' ? 'null' : 'detection'}, detectAll: () => ${startup === 'batch' ? '[detection]' : '[]'} };
          window.MagnetarCategories = { detect: () => null };
          window.MAGNETAR_API = {
            i18n: { getMessage: key => key }, storage: { onChanged: { addListener() {} } },
            runtime: { getManifest: () => ({ version: 'test' }), onMessage: { addListener: fn => runtimeListeners.push(fn) },
              async sendMessage(message) {
                requests.push(message.type);
                switch (message.type) {
                  case 'get-settings': return { mode: 'local', preferences: { interfaceMode: 'advanced', batchMode: ${startup === 'batch'}, bannerEnabled: ${startup !== 'banner disabled'} } };
                  case 'get-quick-send-providers': case 'get-saved': case 'get-history': return [];
                  case 'selfhost-get': return { paired: true, serverUrl: location.origin, serverName: 'Test server' };
                  case 'hard-sync-all': return { ok: true, adapters: { selfHosted: { ok: true } }, mergedChanges: 1 };
                  case 'get-sync-settings': return pairedMobile ? { enabled: true, syncId: 'fixture', syncToken: 'fixture', encryptionKey: 'fixture', serverUrl: 'https://example.com' } : null;
                  case 'get-sync-mobile-ack': return { paired: pairedMobile };
                  case 'sync-pull-saved-history': case 'sync-push-saved-history': return { ok: true };
                  default: return {};
                }
              }
            }
          };
        })()`);
        // Run the real content script with an isolated simulated background.
        await page.evaluate(fs.readFileSync(path.join(root, variant, 'content.js'), 'utf8'));
        await page.evaluate(`Promise.all(runtimeListeners.map(fn => fn({ type: 'open-sync-panel' })))`);
        assert.equal(await page.evaluate(`!!document.querySelector('#magnetar-sync-state-root')`), true);
        if (startup !== 'no detection') {
          await page.evaluate(`document.querySelector('#magnetar-mobile-sync-open').click()`);
          assert.equal(await page.evaluate(`document.querySelector('#magnetar-mobile-sync-open').getAttribute('aria-expanded')`), 'false');
        }
        await page.evaluate(`pairedMobile = true; Promise.all(runtimeListeners.map(fn => fn({ type: 'open-sync-panel' })))`);
        await waitFor(() => page.evaluate(`!!document.querySelector('#magnetar-sync-pull-panel')`), 'Connected Mobile controls');
        await page.evaluate(`document.querySelector('#magnetar-sync-pull-panel').click()`);
        await waitFor(() => page.evaluate(`requests.includes('sync-pull-saved-history')`), 'Mobile pull');
        await page.evaluate(`document.querySelector('#magnetar-sync-push-saved-history').click()`);
        await waitFor(() => page.evaluate(`requests.includes('sync-push-saved-history')`), 'Mobile push');
        await page.evaluate(`window.dispatchEvent(new CustomEvent('magnetar:hard-sync-all-request', { detail: JSON.stringify({ requestId: 'browser-regression', protocol: 3, command: 'MAGNETAR_HARD_SYNC_ALL' }) }))`);
        await waitFor(() => page.evaluate('syncResults.length === 1'), 'Web sync result');
        assert.equal(await page.evaluate('syncResults[0].ok'), true);
        if (startup !== 'no detection') {
          await page.evaluate(`document.querySelector('#magnetar-banner-my-magnetar').click()`);
          await waitFor(() => page.evaluate(`!!document.querySelector('#magnetar-my-sync')`), 'My Magnetar controls');
          await page.evaluate(`document.querySelector('#magnetar-my-sync').click()`);
          await waitFor(() => page.evaluate(`document.querySelector('.magnetar-my-notice')?.textContent === 'Sync complete.'`), 'Sync completion and panel refresh');
        }
        assert.deepEqual(await page.evaluate('failures'), [], `${variant}/${startup}`);
        assert.equal(await page.evaluate(`requests.some(type => ['clear-sync-settings', 'selfhost-disconnect', 'selfhost-pair', 'create-sync-pairing'].includes(type))`), false);
        console.log(`PASS ${variant}: ${startup}, sync controls and refresh`);
      }
    }
  } finally {
    server.close();
    page?.close();
    if (browser) { await browser.send('Browser.close').catch(() => {}); browser.close(); }
    if (child.exitCode === null) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
