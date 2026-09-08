// Uses web-ext's temporary Firefox profile. Set npm_config_cache to use an existing runner.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

async function checkPage() {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function wait(selector) {
    for (let i = 0; i < 150; i++) {
      const node = document.querySelector(selector);
      if (node) return node;
      await pause(200);
    }
    throw new Error('Missing ' + selector);
  }
  const bad = /\ufffd|\u00ef\u00bf\u00bd|\u00c2[\u0080-\u00bf]|\u00c3[\u0080-\u00bf]|\u00e2[\u0080\u20ac\u201a\u201e\u2020\u02dc\u201d]|\u00f0\u0178|[\u0080-\u009f]/u;
  function scan(root) {
    const nodes = [root, ...root.querySelectorAll('*')];
    const text = nodes.map(node => [node.textContent, node.title, node.getAttribute('aria-label'), getComputedStyle(node, '::before').content, getComputedStyle(node, '::after').content].join(' ')).join('\n');
    if (bad.test(text)) throw new Error('Corrupt DOM text: ' + text.match(bad)[0]);
    return text;
  }
  try {
    for (let i = 0; i < 150; i++) {
      if (await fetch('/ready').then(response => response.text()) === 'ready') break;
      await pause(200);
    }
    await pause(500);
    const banner = await wait('#magnetar-banner');
    (await wait('#magnetar-save')).click();
    (await wait('#magnetar-expand')).click();
    await wait('.magnetar-saved-row');
    await wait('.magnetar-detection-detail-label');
    for (const glass of [false, true]) for (const dark of [false, true]) {
      banner.classList.toggle('magnetar-glass-mode', glass);
      banner.classList.toggle('magnetar-theme-dark', dark);
      const text = scan(banner);
      if (!text.includes('Björk · 日本語 — café → ✓ × 😀')) throw new Error('Unicode name changed');
      if (!text.includes('MAGNETAR')) throw new Error('Missing footer branding');
      if (!text.includes('25d ago · Client · café')) throw new Error('History metadata changed');
      document.querySelector('#magnetar-review-target-toggle').click();
      const menu = await wait('#magnetar-quick-send-menu');
      scan(menu);
      document.querySelector('#magnetar-review-target-toggle').click();
    }
    document.querySelector('#magnetar-banner-batch-mode').click();
    const batch = await wait('#magnetar-batch');
    await wait('.magnetar-batch-row');
    document.querySelector('#magnetar-batch-drawer-toggle').click();
    await wait('#magnetar-batch-drawer-saved .magnetar-saved-row');
    for (const glass of [false, true]) for (const dark of [false, true]) {
      batch.classList.toggle('magnetar-glass-mode', glass);
      batch.classList.toggle('magnetar-theme-dark', dark);
      const text = scan(batch);
      if (!text.includes('↑25 · 850 MB') || !text.includes('Name A–Z')) throw new Error('Incorrect batch metadata or sort symbols');
    }
    await fetch('/result', { method: 'POST', body: JSON.stringify({ ok: true }) });
  } catch (error) {
    await fetch('/result', { method: 'POST', body: JSON.stringify({ ok: false, error: error.message + '\n' + error.stack }) });
  }
}
async function main() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'magnetar-firefox-encoding-'));
  fs.cpSync(path.join(root, 'firefox'), fixtureRoot, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'manifest.json'), 'utf8'));
  // Seed only the isolated fixture, just as the Chrome test seeds its isolated profile.
  manifest.background.scripts.push('encoding-fixture.js');
  fs.writeFileSync(path.join(fixtureRoot, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  fs.writeFileSync(path.join(fixtureRoot, 'encoding-fixture.js'), '(' + (async function () {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const { magnetar = {} } = await browser.storage.sync.get('magnetar');
    magnetar.preferences = { ...magnetar.preferences, interfaceMode: 'advanced', batchMode: false };
    await browser.storage.sync.set({ magnetar });
    const entry = { hash: 'a'.repeat(40), name: 'Björk · 日本語 — café → ✓ × 😀', provider: 'Client · café', sentAt: Date.now() - 25 * 86400000 };
    await browser.storage.local.set({ 'magnetar-history': [entry] });
    await fetch('http://127.0.0.1:29541/ready', { method: 'POST' });
  }).toString() + ')();', 'utf8');
  let resolveResult;
  let ready = false;
  const result = new Promise(resolve => { resolveResult = resolve; });
  const name = 'Björk · 日本語 — café → ✓ × 😀';
  const rows = ['0', '1'].map(n => '<tr><td><a href="magnet:?xt=urn:btih:' + n.repeat(40) + '&amp;dn=' + encodeURIComponent(name) + '">' + name + '</a></td> <td>850 MB</td> <td>Seeds: 25</td></tr>').join('');
  const server = http.createServer((request, response) => {
    if (request.url === '/ready') {
      if (request.method === 'POST') ready = true;
      response.end(ready ? 'ready' : 'waiting');
      return;
    }
    if (request.url === '/result') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => { resolveResult(JSON.parse(body)); response.end('ok'); });
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><html><body><table>' + rows + '</table><script>(' + checkPage.toString() + ')();</script></body></html>');
  });
  await new Promise(resolve => server.listen(29541, '127.0.0.1', resolve));
  const runner = spawn(process.execPath, [
    'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js', '--yes', 'web-ext@8.5.0', 'run',
    '--source-dir', fixtureRoot, '--firefox', 'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
    '--start-url', 'http://127.0.0.1:29541/', '--no-reload', '--no-input', '--args=--headless'
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  runner.stdout.on('data', chunk => { output += chunk; });
  runner.stderr.on('data', chunk => { output += chunk; });
  let timer;
  try {
    const report = await Promise.race([result, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Firefox DOM check timed out:\n' + output)), 90000);
      runner.once('exit', code => reject(new Error('Firefox runner exited ' + code + ':\n' + output)));
    })]);
    assert.equal(report.ok, true, report.error);
    console.log('Firefox DOM encoding checks passed: toolbar, saved/history lists, detection/stats, footer, dropdown, batch rows and sort labels; classic/Glass in light/dark.');
  } finally {
    clearTimeout(timer);
    server.closeAllConnections(); server.close();
    if (runner.pid && runner.exitCode === null) spawnSync('taskkill', ['/PID', String(runner.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    runner.stdout.destroy(); runner.stderr.destroy();
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
