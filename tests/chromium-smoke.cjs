const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const extensionRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(extensionRoot, '..', '..');
const myMagnetarRoot = path.join(workspaceRoot, 'magnetar-self-hosted');
const chromeExecutable = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const pagePort = 29411;
const myMagnetarPort = 28732;
const debugPort = 29333;
const artifacts = path.join(extensionRoot, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });

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
  }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
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
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed');
    return result.result.value;
  }
  close() {
    this.socket?.close();
  }
}

async function screenshot(cdp, name) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(artifacts, name), Buffer.from(result.data, 'base64'));
}

async function screenshotElement(cdp, name, selector) {
  const rect = await cdp.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    const box = node.getBoundingClientRect();
    return { viewportWidth: innerWidth, viewportHeight: innerHeight, bottom: box.bottom };
  })()`);
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: rect.viewportWidth, height: Math.max(1, Math.min(rect.viewportHeight, rect.bottom)), scale: 1 },
  });
  fs.writeFileSync(path.join(artifacts, name), Buffer.from(result.data, 'base64'));
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'my-magnetar-extension-'));
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magnetar-chrome-'));
  const children = [];
  const stopChild = child => {
    if (!child?.pid || child.exitCode !== null) return;
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGKILL');
  };
  const removeTempDir = async directory => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        fs.rmSync(directory, { recursive: true, force: true });
        return;
      } catch (error) {
        if (error?.code !== 'EBUSY' || attempt === 7) throw error;
        await delay(250);
      }
    }
  };
  const pageServer = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><html><head><title>Magnetar Smoke Item</title></head><body><main><h1>Magnetar extension smoke</h1><a href="magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Magnetar%20Smoke%20Item">Magnetar Smoke Item</a><a href="magnet:?xt=urn:btih:1111111111111111111111111111111111111111&dn=Magnetar%20Smoke%20Second">Magnetar Smoke Second</a></main></body></html>');
  });
  await new Promise(resolve => pageServer.listen(pagePort, '127.0.0.1', resolve));

  try {
    const myMagnetar = spawn(process.execPath, ['apps/server/dist/index.js'], {
      cwd: myMagnetarRoot,
      windowsHide: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        PORT: String(myMagnetarPort),
        DATA_DIR: dataDir,
        SESSION_SECRET: 'extension-smoke-session-secret',
        CREDENTIAL_ENCRYPTION_KEY: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc',
      },
    });
    children.push(myMagnetar);
    await waitFor(async () => (await fetch(`http://127.0.0.1:${myMagnetarPort}/api/health`)).ok, 'My Magnetar smoke server did not start');

    const setup = await fetch(`http://127.0.0.1:${myMagnetarPort}/api/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'smoke', password: 'correct horse battery', instanceName: 'Extension Smoke Magnetar' }),
    });
    assert.equal(setup.status, 201);
    const cookie = setup.headers.get('set-cookie').split(';')[0];
    const codeResponse = await fetch(`http://127.0.0.1:${myMagnetarPort}/api/settings/extensions/pairing-code`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    assert.equal(codeResponse.status, 200);
    const { pairingCode } = await codeResponse.json();

    const chrome = spawn(chromeExecutable, [
      '--disable-gpu',
      '--window-position=-32000,-32000',
      '--window-size=1280,900',
      '--no-first-run',
      '--disable-default-apps',
      '--enable-unsafe-extension-debugging',
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${debugPort}`,
      `http://127.0.0.1:${pagePort}/`,
    ], { windowsHide: true, stdio: 'ignore' });
    children.push(chrome);

    const browserVersion = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      return response.ok ? response.json() : null;
    }, 'Chrome debugging endpoint did not start');
    const browserTarget = new Cdp(browserVersion.webSocketDebuggerUrl);
    await browserTarget.connect();
    const loadResult = await browserTarget.send('Extensions.loadUnpacked', { path: path.join(extensionRoot, 'dist', 'dev', 'chrome') });
    assert.match(loadResult.id, /^[a-p]{32}$/, 'Chrome did not return a loaded extension ID');
    const popupTargetRef = await browserTarget.send('Target.createTarget', { url: `chrome-extension://${loadResult.id}/popup.html` });
    browserTarget.close();

    const popupTarget = await waitFor(async () => {
      const values = await fetch(`http://127.0.0.1:${debugPort}/json`).then(response => response.json());
      return values.find(target => target.type === 'page' && target.id === popupTargetRef.targetId) || null;
    }, 'Loaded Chrome extension context did not start');
    const popup = new Cdp(popupTarget.webSocketDebuggerUrl);
    await popup.connect();
    await popup.send('Runtime.enable');
    assert.equal(await popup.evaluate('chrome.runtime.getManifest().version'), '2.2.12', 'Chrome loaded the wrong extension version');
    popup.close();

    const pageCreator = new Cdp(browserVersion.webSocketDebuggerUrl);
    await pageCreator.connect();
    const createdPage = await pageCreator.send('Target.createTarget', { url: `http://127.0.0.1:${pagePort}/` });
    pageCreator.close();
    const targets = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
      const values = await response.json();
      return values.some(target => target.type === 'page' && target.id === createdPage.targetId) ? values : null;
    }, 'Chrome extension verification tab did not start');
    const pageTarget = targets.find(target => target.type === 'page' && target.id === createdPage.targetId);
    const page = new Cdp(pageTarget.webSocketDebuggerUrl);
    await page.connect();
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

    await waitFor(() => page.evaluate('Boolean(document.querySelector("#magnetar-banner"))'), 'Magnetar toolbar did not appear');
    // Off-screen Chromium throttles the two requestAnimationFrame entrance callback.
    // Complete that purely visual transition so screenshots reflect a normal visible tab.
    await page.evaluate('document.querySelector("#magnetar-banner").classList.add("magnetar-visible")');
    await delay(250);
    const toolbar = await page.evaluate(`(() => {
      const providerMain = document.querySelector('#magnetar-send');
      const providerToggle = document.querySelector('#magnetar-send-target-toggle');
      const reviewMain = document.querySelector('#magnetar-review-send');
      const reviewToggle = document.querySelector('#magnetar-review-target-toggle');
      const mobileSync = document.querySelector('#magnetar-mobile-sync-open');
      const my = document.querySelector('#magnetar-banner-my-magnetar');
      const utility = document.querySelector('.magnetar-utility-region');
      const utilityButtons = [...utility.querySelectorAll(':scope > button')];
      return {
        provider: providerMain?.textContent.trim(),
        review: reviewMain?.textContent.trim(),
        providerToggle: Boolean(providerToggle),
        reviewToggle: Boolean(reviewToggle),
        mobileSyncLabel: mobileSync?.textContent.trim(),
        mobileSyncId: mobileSync?.id,
        myLabel: my?.textContent.trim(),
        myId: my?.id,
        topShare: Boolean(document.querySelector('#magnetar-share')),
        utilityIds: utilityButtons.map(button => button.id),
        utilityOverflow: utility.scrollWidth > utility.clientWidth,
        utilityRows: new Set(utilityButtons.map(button => {
          const box = button.getBoundingClientRect();
          return Math.round(box.top + box.height / 2);
        })).size,
        duplicateIds: [...document.querySelectorAll('[id]')].filter((node, index, all) => all.findIndex(other => other.id === node.id) !== index).map(node => node.id),
        overflow: document.documentElement.scrollWidth > innerWidth,
        providerDividerWidth: getComputedStyle(providerToggle).borderLeftWidth,
        providerDividerStyle: getComputedStyle(providerToggle).borderLeftStyle,
      };
    })()`);
    assert.match(toolbar.provider, /^Send:/);
    assert.equal(toolbar.review, 'Review: Mobile');
    assert.equal(toolbar.providerToggle, true);
    assert.equal(toolbar.reviewToggle, true);
    assert.equal(toolbar.mobileSyncLabel, 'Sync Mobile');
    assert.equal(toolbar.mobileSyncId, 'magnetar-mobile-sync-open');
    assert.equal(toolbar.myLabel, 'My Magnetar');
    assert.notEqual(toolbar.mobileSyncId, toolbar.myId);
    assert.equal(toolbar.topShare, false);
    assert.deepEqual(toolbar.utilityIds, ['magnetar-save', 'magnetar-mobile-sync-open', 'magnetar-banner-my-magnetar']);
    assert.equal(toolbar.utilityOverflow, false);
    assert.equal(toolbar.utilityRows, 1);
    assert.deepEqual(toolbar.duplicateIds, []);
    assert.equal(toolbar.overflow, false);
    assert.equal(toolbar.providerDividerWidth, '1px');
    assert.equal(toolbar.providerDividerStyle, 'solid');
    await screenshotElement(page, 'toolbar-chrome.png', '#magnetar-banner');

    await page.evaluate('document.querySelector("#magnetar-save").click()');
    await page.evaluate('document.querySelector("#magnetar-expand").click()');
    await waitFor(() => page.evaluate('Boolean(document.querySelector(".magnetar-saved-share"))'), 'Saved Share control did not render');
    await page.evaluate('document.querySelector(".magnetar-saved-share").click()');
    await waitFor(() => page.evaluate('Boolean(document.querySelector("#magnetar-share-menu.magnetar-share-menu-visible"))'), 'Saved Share menu did not open');
    const shareMenu = await page.evaluate(`(() => {
      const items = [...document.querySelectorAll('#magnetar-share-menu .magnetar-share-item')];
      items[0]?.focus({ focusVisible: true });
      return {
        actions: items.map(item => item.dataset.action),
        labels: items.map(item => item.getAttribute('aria-label')),
        svgBoxes: items.map(item => {
          const box = item.querySelector('svg')?.getBoundingClientRect();
          return box ? [box.width, box.height] : null;
        }),
        iconText: items.map(item => item.querySelector('.magnetar-share-icon')?.textContent.trim()),
        focusedAction: document.activeElement?.dataset.action,
      };
    })()`);
    assert.deepEqual(shareMenu.actions, ['email', 'x', 'reddit', 'telegram', 'copy']);
    assert.deepEqual(shareMenu.labels, ['Email', 'X', 'Reddit', 'Telegram', 'Copy link']);
    assert.ok(shareMenu.svgBoxes.every(box => box && box[0] >= 14 && box[0] <= 15.1 && box[1] >= 14 && box[1] <= 15.1));
    assert.ok(shareMenu.iconText.every(text => text === ''));
    assert.equal(shareMenu.focusedAction, 'email');
    await screenshot(page, 'share-menu-chrome.png');
    await page.evaluate('document.querySelector("#magnetar-share-menu")?.remove()');

    await page.evaluate('document.querySelector("#magnetar-mobile-sync-open").click()');
    await waitFor(() => page.evaluate('Boolean(document.querySelector(".magnetar-sync-state-overview"))'), 'Sync Mobile did not visibly open the Mobile pairing panel');
    assert.equal(await page.evaluate('Boolean(document.querySelector("#magnetar-my-panel"))'), false, 'Sync Mobile opened My Magnetar');
    assert.equal(await page.evaluate('document.querySelector("#magnetar-mobile-sync-open")?.textContent.trim()'), 'Sync Mobile');
    await page.evaluate('document.querySelector("#magnetar-mobile-sync-open").click()');
    await waitFor(() => page.evaluate('!document.querySelector("#magnetar-banner").classList.contains("magnetar-expanded")'), 'Sync Mobile panel did not close');
    await page.evaluate('document.querySelector("#magnetar-banner-my-magnetar").click()');
    await waitFor(() => page.evaluate('Boolean(document.querySelector("#magnetar-my-panel"))'), 'My Magnetar did not open independently');
    assert.equal(await page.evaluate('Boolean(document.querySelector("#magnetar-sync-state-root"))'), false, 'My Magnetar opened the Mobile panel');
    await page.evaluate('document.querySelector("#magnetar-banner-my-magnetar").click()');
    await waitFor(() => page.evaluate('!document.querySelector("#magnetar-banner").classList.contains("magnetar-expanded")'), 'My Magnetar panel did not close');

    await page.evaluate('document.querySelector("#magnetar-review-target-toggle").click()');
    await waitFor(() => page.evaluate('Boolean(document.querySelector("#magnetar-quick-send-menu"))'), 'Review destination menu did not open');
    const destinations = await page.evaluate('[...document.querySelectorAll("#magnetar-quick-send-menu .magnetar-provider-menu-label")].map(node => node.textContent.trim())');
    assert.deepEqual(destinations, ['Mobile', 'My Magnetar']);
    await page.evaluate(`[...document.querySelectorAll('#magnetar-quick-send-menu .magnetar-quick-send-option')].find(node => node.dataset.mode === 'my-magnetar').click()`);
    await waitFor(() => page.evaluate('document.querySelector("#magnetar-review-send")?.textContent.trim() === "Review: My Magnetar"'), 'Review destination label did not update');
    await waitFor(() => page.evaluate('!document.querySelector("#magnetar-quick-send-menu")'), 'Review destination preference did not finish saving');
    await page.send('Page.reload');
    await waitFor(() => page.evaluate('document.querySelector("#magnetar-review-send")?.textContent.trim() === "Review: My Magnetar"'), 'Review destination did not persist');
    await page.evaluate('document.querySelector("#magnetar-banner").classList.add("magnetar-visible")');

    await page.evaluate('document.querySelector("#magnetar-banner-my-magnetar").click()');
    await waitFor(() => page.evaluate('Boolean(document.querySelector("#magnetar-my-connect-form"))'), 'Disconnected My Magnetar panel did not open');
    await page.evaluate(`(() => {
      document.querySelector('#magnetar-my-server-url').value = 'not-a-url';
      document.querySelector('#magnetar-my-pairing-code').value = '123456';
      document.querySelector('#magnetar-my-connect-form').requestSubmit();
    })()`);
    await waitFor(() => page.evaluate('document.querySelector(".magnetar-my-feedback")?.textContent.includes("valid")'), 'Invalid URL was not rejected');
    await page.evaluate(`(() => {
      document.querySelector('#magnetar-my-server-url').value = 'http://127.0.0.1:9';
      document.querySelector('#magnetar-my-pairing-code').value = '123456';
      document.querySelector('#magnetar-my-connect-form').requestSubmit();
    })()`);
    await waitFor(() => page.evaluate('document.querySelector(".magnetar-my-feedback")?.textContent.includes("could not be reached")'), 'Unavailable My Magnetar did not show a clear error');
    await screenshotElement(page, 'my-magnetar-unconnected-chrome.png', '#magnetar-banner');

    await page.evaluate(`(() => {
      document.querySelector('#magnetar-my-server-url').value = 'http://127.0.0.1:${myMagnetarPort}/';
      document.querySelector('#magnetar-my-pairing-code').value = ${JSON.stringify(pairingCode)};
      document.querySelector('#magnetar-my-connect-form').requestSubmit();
    })()`);
    await waitFor(() => page.evaluate('document.querySelector("#magnetar-my-title")?.textContent === "Connected to My Magnetar"'), 'My Magnetar pairing did not reach connected state');
    const connected = await page.evaluate(`(() => ({
      title: document.querySelector('#magnetar-my-title')?.textContent,
      facts: [...document.querySelectorAll('.magnetar-my-facts dd')].map(node => node.textContent.trim()),
      actions: [...document.querySelectorAll('.magnetar-my-actions button')].map(node => node.textContent.trim()),
    }))()`);
    assert.equal(connected.title, 'Connected to My Magnetar');
    assert.equal(connected.facts[0], 'Extension Smoke Magnetar');
    assert.ok(connected.actions.includes('Sync now'));
    assert.ok(connected.actions.includes('Open My Magnetar'));
    assert.ok(connected.actions.includes('Settings'));
    assert.ok(connected.actions.includes('Disconnect'));
    await page.evaluate('document.querySelector("#magnetar-review-send").click()');
    await waitFor(() => page.evaluate('document.querySelector("#magnetar-toast")?.textContent.includes("Sent to My Magnetar Review")'), 'Single item was not sent to My Magnetar Review');
    const reviewItemsResponse = await fetch(`http://127.0.0.1:${myMagnetarPort}/api/items?status=review`, { headers: { Cookie: cookie } });
    assert.equal(reviewItemsResponse.status, 200);
    const reviewItems = (await reviewItemsResponse.json()).items;
    const submittedReviewItem = reviewItems.find(item => item.sourceUrl === `http://127.0.0.1:${pagePort}/`);
    assert.ok(submittedReviewItem, `My Magnetar Review item did not preserve its source URL: ${JSON.stringify(reviewItems)}`);
    assert.ok(submittedReviewItem.displayName && !/^[a-f0-9]{40}$/i.test(submittedReviewItem.displayName), 'My Magnetar Review item lost its human-readable display name');
    await page.evaluate('document.querySelector("#magnetar-review-send").click()');
    await waitFor(() => page.evaluate('document.querySelector("#magnetar-toast")?.textContent.includes("already in My Magnetar Review")'), 'Duplicate My Magnetar Review delivery was not reported');
    await page.evaluate('document.querySelector("#magnetar-my-sync").click()');
    await waitFor(() => page.evaluate('document.querySelector(".magnetar-my-notice")?.textContent === "Sync complete."'), 'My Magnetar sync did not complete');
    assert.equal(await page.evaluate('document.querySelector("#magnetar-mobile-sync-open")?.textContent.trim()'), 'Sync Mobile', 'My Magnetar hard sync changed the Mobile control');
    assert.equal(await page.evaluate('document.querySelector("#magnetar-mobile-sync-open")?.getAttribute("aria-busy")'), null, 'My Magnetar hard sync marked Mobile Sync busy');
    await screenshotElement(page, 'my-magnetar-connected-chrome.png', '#magnetar-banner');
    await page.evaluate('document.querySelector("#magnetar-theme").click()');
    await waitFor(() => page.evaluate('document.querySelector("#magnetar-banner")?.classList.contains("magnetar-theme-dark")'), 'Dark theme did not apply');
    const darkPanel = await page.evaluate(`(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      headingBackground: getComputedStyle(document.querySelector('.magnetar-my-heading-copy h2')).backgroundColor,
    }))()`);
    assert.equal(darkPanel.overflow, false);
    assert.equal(darkPanel.headingBackground, 'rgba(0, 0, 0, 0)');
    await screenshotElement(page, 'my-magnetar-connected-chrome-dark.png', '#magnetar-banner');
    await page.evaluate('document.querySelector("#magnetar-theme").click()');
    await waitFor(() => page.evaluate('!document.querySelector("#magnetar-banner")?.classList.contains("magnetar-theme-dark")'), 'Light theme did not restore');

    if (!(await page.evaluate('Boolean(document.querySelector("#magnetar-my-disconnect"))'))) {
      await page.evaluate('document.querySelector("#magnetar-banner-my-magnetar").click()');
      await waitFor(() => page.evaluate('Boolean(document.querySelector("#magnetar-my-disconnect"))'), 'My Magnetar panel did not reopen for disconnect');
    }
    await page.evaluate('document.querySelector("#magnetar-my-disconnect").click()');
    await waitFor(() => page.evaluate('Boolean(document.querySelector(".magnetar-owned-dialog-primary"))'), 'Disconnect confirmation did not open');
    await page.evaluate('document.querySelector(".magnetar-owned-dialog-primary").click()');
    await waitFor(() => page.evaluate('Boolean(document.querySelector("#magnetar-my-connect-form"))'), 'My Magnetar did not disconnect');

    await page.evaluate('document.querySelector("#magnetar-banner-my-magnetar").click(); document.querySelector("#magnetar-mobile-sync-open").click()');
    await waitFor(() => page.evaluate('Boolean(document.querySelector(".magnetar-sync-state-overview"))'), 'Unpaired Sync Mobile panel did not open');
    const syncTransparency = await page.evaluate(`(() => {
      const heading = document.querySelector('.magnetar-sync-overview-copy h2');
      const copy = document.querySelector('.magnetar-sync-state-copy');
      return [getComputedStyle(heading).backgroundColor, getComputedStyle(copy).backgroundColor];
    })()`);
    assert.deepEqual(syncTransparency, ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']);
    await screenshotElement(page, 'sync-mobile-unpaired-chrome.png', '#magnetar-banner');

    const currentTargets = await fetch(`http://127.0.0.1:${debugPort}/json`).then(response => response.json());
    const workerTargets = currentTargets.filter(target => target.type === 'service_worker' && target.url.startsWith('chrome-extension://'));
    let worker = null;
    for (const target of workerTargets) {
      const candidate = new Cdp(target.webSocketDebuggerUrl);
      await candidate.connect();
      await candidate.send('Runtime.enable');
      const name = await candidate.evaluate(`typeof MAGNETAR_API !== 'undefined' ? MAGNETAR_API.runtime.getManifest().name : ''`);
      if (/Magnetar/i.test(name)) {
        worker = candidate;
        break;
      }
      candidate.close();
    }
    assert.ok(worker, 'Magnetar extension service worker target missing');
    await worker.evaluate(`new Promise(resolve => MAGNETAR_API.storage.local.set({
      'magnetar-sync-settings': { enabled: true, serverUrl: 'https://sync.arrcee.com', syncId: 'smoke-sync-id', syncToken: 'smoke-sync-token', encryptionKey: 'smoke-encryption-key', lastRevision: 1, lastSyncAt: Date.now(), deviceId: 'chrome-smoke', deviceName: 'Chrome smoke' },
      'magnetar-sync-mobile-ack': { paired: true, type: 'mobile', platform: 'android', id: 'android-smoke', name: 'Smoke Android', pairedAt: Date.now(), lastSeenAt: Date.now(), capabilities: {} }
    }).then(resolve))`);
    worker.close();
    await page.evaluate('document.querySelector("#magnetar-mobile-sync-open").click(); document.querySelector("#magnetar-mobile-sync-open").click()');
    await waitFor(() => page.evaluate('Boolean(document.querySelector(".magnetar-sync-state-connected"))'), 'Paired Sync Mobile panel did not render');
    const connectedTransparency = await page.evaluate('getComputedStyle(document.querySelector(".magnetar-sync-connected-copy h2")).backgroundColor');
    assert.equal(connectedTransparency, 'rgba(0, 0, 0, 0)');
    await screenshotElement(page, 'sync-mobile-connected-chrome.png', '#magnetar-banner');

    await page.send('Page.reload');
    await waitFor(() => page.evaluate('document.querySelector(\"#magnetar-mobile-sync-open\")?.textContent.trim() === \"Sync Mobile\"'), 'Sync Mobile control did not survive extension page reload');
    const postReloadIds = await page.evaluate('[...document.querySelectorAll(\"[id]\")].map(node => node.id)');
    assert.equal(new Set(postReloadIds).size, postReloadIds.length, 'Toolbar rerender introduced duplicate DOM IDs');
    await page.evaluate('document.querySelector(\"#magnetar-mobile-sync-open\").click()');
    await waitFor(() => page.evaluate('Boolean(document.querySelector(\".magnetar-sync-state-connected\"))'), 'Mobile pairing did not survive extension page reload');
    assert.equal(await page.evaluate('Boolean(document.querySelector(\"#magnetar-my-panel\"))'), false, 'Reloaded Sync Mobile opened My Magnetar');
    await page.evaluate('document.querySelector(\"#magnetar-mobile-sync-open\").click(); document.querySelector(\"#magnetar-banner-my-magnetar\").click()');
    await waitFor(() => page.evaluate('Boolean(document.querySelector(\"#magnetar-my-panel\"))'), 'My Magnetar did not open independently after reload');
    assert.equal(await page.evaluate('Boolean(document.querySelector(\".magnetar-sync-panel\"))'), false, 'Reloaded My Magnetar opened Mobile Sync');
    await page.evaluate('document.querySelector(\"#magnetar-banner-my-magnetar\").click(); document.querySelector(\"#magnetar-mobile-sync-open\").click()');
    await waitFor(() => page.evaluate('Boolean(document.querySelector(\".magnetar-sync-state-connected\"))'), 'Sync Mobile did not reopen after My Magnetar following reload');

    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await delay(250);
    const narrow = await page.evaluate(`(() => ({
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      panelWidth: document.querySelector('.magnetar-sync-panel')?.getBoundingClientRect().width,
      topShare: Boolean(document.querySelector('#magnetar-share')),
      utilityOverflow: (() => {
        const utility = document.querySelector('.magnetar-utility-region');
        return utility.scrollWidth > utility.clientWidth;
      })(),
      utilityCollision: (() => {
        const buttons = [...document.querySelectorAll('.magnetar-utility-region > button')];
        return buttons.some((button, index) => buttons.slice(index + 1).some(other => {
          const a = button.getBoundingClientRect();
          const b = other.getBoundingClientRect();
          return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        }));
      })(),
    }))()`);
    assert.ok(narrow.documentWidth <= narrow.viewport);
    assert.ok(narrow.panelWidth <= narrow.viewport);
    assert.equal(narrow.topShare, false);
    assert.equal(narrow.utilityOverflow, false);
    assert.equal(narrow.utilityCollision, false);
    await screenshot(page, 'toolbar-panels-chrome-narrow.png');
    page.close();
    console.log('Chrome extension smoke checks passed.');
  } finally {
    pageServer.close();
    for (const child of children.reverse()) stopChild(child);
    await removeTempDir(profileDir);
    await removeTempDir(dataDir);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

