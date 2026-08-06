const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const chromeExecutable = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const extensionPath = path.join(root, 'dist', 'dev', 'chrome');
const pagePort = 29431;
const debugPort = 29353;
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed');
    return result.result.value;
  }
  close() { this.socket?.close(); }
}

async function main() {
  assert.ok(fs.existsSync(path.join(extensionPath, 'manifest.json')), 'Missing generated Chrome development runtime');
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magnetar-share-chrome-'));
  const children = [];
  const stopChild = child => {
    if (!child?.pid || child.exitCode !== null) return;
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  };
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><html><head><title>Magnetar Share Smoke</title></head><body><a href="magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Share%20Smoke">Share Smoke</a></body></html>');
  });
  await new Promise(resolve => server.listen(pagePort, '127.0.0.1', resolve));

  try {
    const chrome = spawn(chromeExecutable, [
      '--disable-gpu',
      '--window-position=-32000,-32000',
      '--window-size=1280,900',
      '--no-first-run',
      '--disable-default-apps',
      '--enable-unsafe-extension-debugging',
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${debugPort}`,
      'about:blank',
    ], { windowsHide: true, stdio: 'ignore' });
    children.push(chrome);

    const version = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      return response.ok ? response.json() : null;
    }, 'Chrome debugging endpoint did not start');
    const browser = new Cdp(version.webSocketDebuggerUrl);
    await browser.connect();
    const loaded = await browser.send('Extensions.loadUnpacked', { path: extensionPath });
    assert.match(loaded.id, /^[a-p]{32}$/);
    const created = await browser.send('Target.createTarget', { url: `http://127.0.0.1:${pagePort}/` });
    browser.close();

    const target = await waitFor(async () => {
      const values = await fetch(`http://127.0.0.1:${debugPort}/json`).then(response => response.json());
      return values.find(value => value.id === created.targetId) || null;
    }, 'Chrome page target did not start');
    const page = new Cdp(target.webSocketDebuggerUrl);
    await page.connect();
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await waitFor(() => page.evaluate('Boolean(document.querySelector("#magnetar-banner"))'), 'Magnetar toolbar did not appear');
    await page.evaluate('document.querySelector("#magnetar-banner").classList.add("magnetar-visible")');

    const normal = await page.evaluate(`(() => {
      const utility = document.querySelector('.magnetar-utility-region');
      const buttons = [...utility.querySelectorAll(':scope > button')];
      return {
        topShare: Boolean(document.querySelector('#magnetar-share')),
        ids: buttons.map(button => button.id),
        overflow: utility.scrollWidth > utility.clientWidth || document.documentElement.scrollWidth > innerWidth,
        rows: new Set(buttons.map(button => {
          const box = button.getBoundingClientRect();
          return Math.round(box.top + box.height / 2);
        })).size,
      };
    })()`);
    assert.deepEqual(normal, {
      topShare: false,
      ids: ['magnetar-save', 'magnetar-mobile-sync-open', 'magnetar-banner-my-magnetar'],
      overflow: false,
      rows: 1,
    });

    await page.evaluate('document.querySelector(".magnetar-whats-new-open").click()');
    await waitFor(() => page.evaluate('Boolean(document.querySelector("#magnetar-whats-new-panel"))'), 'What’s New panel did not open');
    const whatsNew = await page.evaluate(`(() => ({
      cardCount: document.querySelectorAll('[data-whats-new-card]').length,
      cards: [...document.querySelectorAll('.magnetar-whats-new-card-title')].map(node => node.textContent.trim()),
      intro: document.querySelector('.magnetar-whats-new-header p')?.textContent.trim(),
      action: document.querySelector('[data-whats-new-my-magnetar]')?.textContent.trim(),
      maybeLater: Boolean(document.querySelector('[data-whats-new-later]')),
      overflow: document.documentElement.scrollWidth > innerWidth,
    }))()`);
    assert.equal(whatsNew.cardCount, 6);
    assert.ok(whatsNew.cards.includes('Sync your ecosystem'));
    assert.ok(whatsNew.cards.includes('My Magnetar'));
    assert.equal(whatsNew.intro, 'Magnetar, Magnetar Mobile and My Magnetar now work together.');
    assert.equal(whatsNew.action, 'Open My Magnetar');
    assert.equal(whatsNew.maybeLater, false);
    assert.equal(whatsNew.overflow, false);
    await page.evaluate('document.querySelector("[data-whats-new-feature=my-magnetar]").click()');
    await waitFor(() => page.evaluate('document.querySelector("[data-whats-new-viewer-stage]")?.textContent.includes("Run Magnetar on your own server")'), 'My Magnetar story did not expand');
    await page.evaluate('document.querySelector("[data-whats-new-my-magnetar]").click()');
    await waitFor(() => page.evaluate('Boolean(document.querySelector("#magnetar-my-panel"))'), 'Open My Magnetar did not replace the tour with the My Magnetar panel');
    assert.equal(await page.evaluate('Boolean(document.querySelector("#magnetar-whats-new-panel"))'), false);
    assert.equal(await page.evaluate('document.querySelector("#magnetar-banner-my-magnetar")?.getAttribute("aria-expanded")'), 'true');

    await page.evaluate('document.querySelector("#magnetar-save").click(); document.querySelector("#magnetar-expand").click()');
    await waitFor(() => page.evaluate('Boolean(document.querySelector(".magnetar-saved-share"))'), 'Saved Share control did not render');
    await page.evaluate('document.querySelector(".magnetar-saved-share").click()');
    await waitFor(() => page.evaluate('Boolean(document.querySelector("#magnetar-share-menu.magnetar-share-menu-visible"))'), 'Saved Share menu did not open');

    const menu = await page.evaluate(`(() => {
      const items = [...document.querySelectorAll('#magnetar-share-menu .magnetar-share-item')];
      items[0]?.focus({ focusVisible: true });
      return {
        actions: items.map(item => item.dataset.action),
        labels: items.map(item => item.getAttribute('aria-label')),
        icons: items.map(item => {
          const svg = item.querySelector('svg');
          const box = svg?.getBoundingClientRect();
          return { present: Boolean(svg), width: box?.width, height: box?.height, text: item.querySelector('.magnetar-share-icon')?.textContent.trim() };
        }),
        focused: document.activeElement?.dataset.action,
      };
    })()`);
    assert.deepEqual(menu.actions, ['email', 'x', 'reddit', 'telegram', 'copy']);
    assert.deepEqual(menu.labels, ['Email', 'X', 'Reddit', 'Telegram', 'Copy link']);
    assert.ok(menu.icons.every(icon => icon.present && icon.width >= 14 && icon.width <= 15.1 && icon.height >= 14 && icon.height <= 15.1 && icon.text === ''), JSON.stringify(menu.icons));
    assert.equal(menu.focused, 'email');

    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    assert.equal(await page.evaluate('document.activeElement?.dataset.action'), 'x', 'Tab did not move to the next Share action');
    assert.equal(await page.evaluate('getComputedStyle(document.activeElement).outlineStyle'), 'solid', 'Keyboard-focused Share action had no visible outline');
    await page.evaluate('document.querySelector("#magnetar-share-menu")?.remove()');

    const contexts = page.events
      .filter(event => event.method === 'Runtime.executionContextCreated')
      .map(event => event.params.context);
    let contentContextId = null;
    for (const context of contexts) {
      try {
        if (await page.evaluate('globalThis.chrome?.runtime?.id || ""', context.id) === loaded.id) {
          contentContextId = context.id;
          break;
        }
      } catch (_error) {}
    }
    assert.ok(contentContextId, 'Could not identify the Chrome content-script execution world');
    await page.evaluate('globalThis.__shareOpened = []; window.open = (...args) => { globalThis.__shareOpened.push(args); return null; };', contentContextId);
    const encodedName = encodeURIComponent('Share Smoke');
    const encodedMagnet = encodeURIComponent('magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Share%20Smoke');
    const encodedPage = encodeURIComponent(`http://127.0.0.1:${pagePort}/`);
    const outboundCases = [
      ['email', `mailto:?subject=${encodedName}&body=${encodeURIComponent('Check out this torrent')}%3A%0A%0A${encodedMagnet}%0A%0A${encodedPage}`, undefined],
      ['x', `https://x.com/intent/tweet?text=${encodedName}&url=${encodedPage}`, '_blank'],
      ['reddit', `https://reddit.com/submit?url=${encodedPage}&title=${encodedName}`, '_blank'],
      ['telegram', `https://t.me/share/url?url=${encodedMagnet}&text=${encodedName}`, '_blank'],
    ];
    for (const [action, expectedUrl, expectedTarget] of outboundCases) {
      await page.evaluate('document.querySelector(".magnetar-saved-share").click()');
      await waitFor(() => page.evaluate('Boolean(document.querySelector("#magnetar-share-menu.magnetar-share-menu-visible"))'), `${action} menu did not open`);
      await page.evaluate(`document.querySelector('#magnetar-share-menu [data-action="${action}"]').click()`);
      await waitFor(() => page.evaluate('globalThis.__shareOpened.length', contentContextId), `${action} did not invoke window.open`);
      const calls = await page.evaluate('globalThis.__shareOpened.splice(0)', contentContextId);
      assert.equal(calls.length, 1);
      assert.equal(calls[0][0], expectedUrl);
      assert.equal(calls[0][1], expectedTarget);
      await waitFor(() => page.evaluate('!document.querySelector("#magnetar-share-menu")'), `${action} menu did not close`);
    }

    await page.evaluate('document.querySelector(".magnetar-saved-share").click()');
    await waitFor(() => page.evaluate('Boolean(document.querySelector("#magnetar-share-menu.magnetar-share-menu-visible"))'), 'Copy link menu did not open');
    await page.evaluate('document.querySelector("#magnetar-share-menu [data-action=copy]").click()');
    await waitFor(() => page.evaluate('document.querySelector("#magnetar-toast")?.textContent.toLowerCase().includes("copied")'), 'Copy link did not report success');

    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await delay(250);
    const narrow = await page.evaluate(`(() => {
      const utility = document.querySelector('.magnetar-utility-region');
      const buttons = [...utility.querySelectorAll(':scope > button')];
      const collision = buttons.some((button, index) => buttons.slice(index + 1).some(other => {
        const a = button.getBoundingClientRect();
        const b = other.getBoundingClientRect();
        return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      }));
      return {
        topShare: Boolean(document.querySelector('#magnetar-share')),
        overflow: utility.scrollWidth > utility.clientWidth || document.documentElement.scrollWidth > innerWidth,
        collision,
      };
    })()`);
    assert.deepEqual(narrow, { topShare: false, overflow: false, collision: false });

    const runtimeErrors = page.events.filter(event =>
      event.method === 'Runtime.exceptionThrown' ||
      (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error')
    );
    assert.deepEqual(runtimeErrors, [], 'Chrome reported a startup/UI console error');
    page.close();
    console.log('Chrome Share toolbar/menu smoke passed at 1280px and 390px.');
  } finally {
    server.closeAllConnections?.();
    server.close();
    for (const child of children.reverse()) stopChild(child);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try { fs.rmSync(profileDir, { recursive: true, force: true }); break; }
      catch (error) { if (attempt === 7) throw error; await delay(250); }
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
