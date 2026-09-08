// Run with node tests/encoding-chromium-smoke.cjs. Uses an isolated profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const bad = /\ufffd|\u00ef\u00bf\u00bd|\u00c2[\u0080-\u00bf]|\u00c3[\u0080-\u00bf]|\u00e2[\u0080\u20ac\u201a\u201e\u2020\u02dc\u201d]|\u00f0\u0178|[\u0080-\u009f]/u;
async function wait(fn) {
  for (let i = 0; i < 100; i++) { const value = await fn().catch(() => null); if (value) return value; await delay(200); }
  throw new Error('Timed out: ' + fn);
}
class Cdp {
  constructor(socket) {
    this.socket = socket; this.id = 0; this.pending = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data), pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result);
    });
  }
  static async open(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    return new Cdp(socket);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.socket.send(JSON.stringify({ id, method, params })); });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
}
async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'magnetar-encoding-'));
  const name = 'Björk · 日本語 — café → ✓ × 😀';
  const hash = '0123456789abcdef0123456789abcdef01234567';
  const server = http.createServer((request, response) => {
    // The second fixture deliberately uses a legacy host-page charset.
    const legacy = request.url.includes('legacy');
    response.writeHead(200, { 'Content-Type': 'text/html; charset=' + (legacy ? 'windows-1252' : 'utf-8') });
    const rows = [hash, hash.split('').reverse().join('')].map(h => '<tr><td><a href="magnet:?xt=urn:btih:' + h + '&amp;dn=' + encodeURIComponent(name) + '">' + (legacy ? 'Caf\u00e9 &amp; torrent' : name) + '</a></td> <td>850 MB</td> <td>Seeds: 25</td></tr>').join('');
    response.end(Buffer.from('<!doctype html><html><body><table>' + rows + '</table></body></html>', legacy ? 'latin1' : 'utf8'));
  });
  await new Promise(resolve => server.listen(29441, '127.0.0.1', resolve));
  const chrome = spawn('C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--disable-default-apps', '--enable-unsafe-extension-debugging',
    '--user-data-dir=' + profile, '--remote-debugging-port=29363', 'about:blank'
  ], { windowsHide: true, stdio: 'ignore' });
  const connections = [];
  try {
    const version = await wait(() => fetch('http://127.0.0.1:29363/json/version').then(r => r.json()));
    const browser = await Cdp.open(version.webSocketDebuggerUrl); connections.push(browser);
    const loaded = await browser.send('Extensions.loadUnpacked', { path: path.join(root, 'chrome') });
    async function page(url) {
      const created = await browser.send('Target.createTarget', { url });
      const target = await wait(async () => (await fetch('http://127.0.0.1:29363/json').then(r => r.json())).find(t => t.id === created.targetId));
      const cdp = await Cdp.open(target.webSocketDebuggerUrl); connections.push(cdp);
      await wait(() => cdp.evaluate('document.readyState === "complete"'));
      return cdp;
    }
    const popup = await page('chrome-extension://' + loaded.id + '/popup.html');
    await popup.evaluate('(async () => { const {magnetar = {}} = await chrome.storage.sync.get("magnetar"); magnetar.preferences = {...magnetar.preferences, interfaceMode:"advanced", batchMode:false}; await chrome.storage.sync.set({magnetar}); })()');
    const item = { hash, name, savedAt: Date.now() - 25 * 86400000, sentAt: Date.now() - 25 * 86400000, provider: 'Client · café', size: 850 * 1048576 };
    await popup.evaluate('chrome.storage.local.set(' + JSON.stringify({ 'magnetar-saved': [item, { hash: 'a'.repeat(40) }], 'magnetar-history': [item] }) + ')');
    async function scan(cdp, label) {
      const text = await cdp.evaluate('(() => { const roots = [...document.querySelectorAll("[id^=magnetar-]")]; const nodes = roots.length ? [...new Set(roots.flatMap(r => [r,...r.querySelectorAll("*")]))] : [...document.querySelectorAll("*")]; return nodes.filter(n => !["SCRIPT","STYLE"].includes(n.tagName)).map(n => [n.childNodes.length ? [...n.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent).join("") : "", n.title, n.getAttribute("aria-label"), n.placeholder, getComputedStyle(n,"::before").content, getComputedStyle(n,"::after").content].filter(Boolean).join(" ")).join("\\n"); })()');
      assert.doesNotMatch(text, bad, label);
      return text;
    }
    for (const host of ['utf8', 'legacy']) {
      const view = await page('http://127.0.0.1:29441/' + host);
      await wait(() => view.evaluate('Boolean(document.querySelector("#magnetar-banner"))'));
      await view.evaluate('document.querySelector("#magnetar-expand").click()');
      await wait(() => view.evaluate('Boolean(document.querySelector(".magnetar-saved-row"))'));
      for (const glass of [false, true]) for (const dark of [false, true]) {
        await view.evaluate('document.querySelectorAll("#magnetar-banner,#magnetar-batch").forEach(n => { n.classList.toggle("magnetar-glass-mode",' + glass + '); n.classList.toggle("magnetar-theme-dark",' + dark + '); })');
        const text = await scan(view, host + ' glass=' + glass + ' dark=' + dark);
        assert.ok(text.includes(name), 'Unicode saved name survived storage and messaging');
        assert.match(text, /25d ago · Client · café/);
        assert.match(text, /MAGNETAR/);
        assert.ok(await view.evaluate('Boolean(document.querySelector(".magnetar-detection-detail-label"))'));
        await view.evaluate('document.querySelector("#magnetar-review-target-toggle").click()');
        await wait(() => view.evaluate('Boolean(document.querySelector("#magnetar-quick-send-menu"))'));
        await scan(view, 'client dropdown');
        await view.evaluate('document.querySelector("#magnetar-review-target-toggle").click()');
      }
      await view.evaluate('document.querySelector("#magnetar-banner-batch-mode").click()');
      await wait(() => view.evaluate('Boolean(document.querySelector(".magnetar-batch-row"))'));
      await view.evaluate('document.querySelector("#magnetar-batch-drawer-toggle").click()');
      await wait(() => view.evaluate('Boolean(document.querySelector("#magnetar-batch-drawer-saved .magnetar-saved-row"))'));
      for (const glass of [false, true]) for (const dark of [false, true]) {
        await view.evaluate('document.querySelector("#magnetar-batch").classList.toggle("magnetar-glass-mode",' + glass + '); document.querySelector("#magnetar-batch").classList.toggle("magnetar-theme-dark",' + dark + ')');
        const text = await scan(view, 'batch ' + host + ' glass=' + glass + ' dark=' + dark);
        assert.match(text, /· 850 MB/);
        assert.match(text, /Name A–Z/);
      }
      // Restore for the next fixture through the extension's actual preference API.
      await popup.evaluate('(async () => { const {magnetar} = await chrome.storage.sync.get("magnetar"); magnetar.preferences.batchMode = false; await chrome.storage.sync.set({magnetar}); })()');
    }
    await scan(popup, 'popup');
    await popup.evaluate('chrome.storage.local.set({"magnetar-history":[]})');
    const empty = await page('http://127.0.0.1:29441/empty');
    await wait(() => empty.evaluate('Boolean(document.querySelector("#magnetar-expand"))'));
    await empty.evaluate('document.querySelector("#magnetar-expand").click()');
    await wait(() => empty.evaluate('Boolean(document.querySelector(".magnetar-stat-value"))'));
    assert.match(await scan(empty, 'empty history stats'), /—/);
    for (const file of ['options.html', 'onboarding.html', 'whatsnew.html']) await scan(await page('chrome-extension://' + loaded.id + '/' + file), file);
    console.log('Chrome DOM encoding checks passed: UTF-8 and legacy host pages, toolbar, saved/history, details/stats, footer, dropdowns, batch metadata; classic/Glass in light/dark.');
  } finally {
    for (const cdp of connections) cdp.socket.close();
    server.closeAllConnections(); server.close();
    if (chrome.pid && chrome.exitCode === null) spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    // Only the explicitly created temporary browser profile is removed.
    for (let i = 0; i < 8; i++) { try { fs.rmSync(profile, { recursive: true, force: true }); break; } catch (error) { if (i === 7) throw error; await delay(250); } }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
