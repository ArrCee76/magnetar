const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const chromeExecutable = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const pagePort = 29412;
const debugPort = 29334;
const artifacts = path.join(root, 'artifacts');
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
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
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
  close() { this.socket?.close(); }
}

async function screenshot(page, name) {
  const result = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(path.join(artifacts, name), Buffer.from(result.data, 'base64'));
}

async function main() {
  if (!fs.existsSync(chromeExecutable)) {
    console.log('Glass toolbar visual check skipped: Chrome is unavailable');
    return;
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'magnetar-glass-'));
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><html><body style=margin:0;background:linear-gradient(120deg,#cfb98f,#6f8b78);height:100vh><a href=magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Glass%20Theme%20Check>Glass Theme Check</a></body></html>');
  });
  await new Promise(resolve => server.listen(pagePort, '127.0.0.1', resolve));
  const chrome = spawn(chromeExecutable, [
    '--disable-gpu', '--window-position=-32000,-32000', '--window-size=1280,500',
    '--no-first-run', '--disable-default-apps', '--enable-unsafe-extension-debugging',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });

  try {
    const version = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      return response.ok ? response.json() : null;
    }, 'Chrome debugging endpoint did not start');
    const browser = new Cdp(version.webSocketDebuggerUrl);
    await browser.connect();
    await browser.send('Extensions.loadUnpacked', { path: path.join(root, 'chrome') });
    const created = await browser.send('Target.createTarget', { url: `http://127.0.0.1:${pagePort}/` });
    browser.close();

    const target = await waitFor(async () => {
      const values = await fetch(`http://127.0.0.1:${debugPort}/json`).then(response => response.json());
      return values.find(value => value.id === created.targetId);
    }, 'Visual-check tab did not start');
    const page = new Cdp(target.webSocketDebuggerUrl);
    await page.connect();
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 500, deviceScaleFactor: 1, mobile: false });
    await waitFor(() => page.evaluate(`Boolean(document.querySelector('#magnetar-banner'))`), 'Toolbar did not appear');
    await page.evaluate(`(() => {
      const banner = document.querySelector('#magnetar-banner');
      banner.classList.add('magnetar-visible');
      if (!banner.classList.contains('magnetar-glass-mode')) {
        document.querySelector('#magnetar-interface-style').click();
      }
    })()`);
    await waitFor(() => page.evaluate(`document.querySelector('#magnetar-banner')?.classList.contains('magnetar-glass-mode')`), 'Glass theme did not apply');
    await delay(500);
    await page.evaluate(`(() => {
      const banner = document.querySelector('#magnetar-banner');
      banner.classList.add('magnetar-advanced-mode', 'magnetar-glass-mode');
      banner.classList.remove('magnetar-theme-dark');
      banner.querySelectorAll('*').forEach(node => {
        node.style.setProperty('transition', 'none', 'important');
        node.style.setProperty('animation', 'none', 'important');
      });
    })()`);
    await delay(300);

    const readStyles = () => page.evaluate(`(() => {
      const style = selector => {
        const node = document.querySelector(selector);
        const css = getComputedStyle(node);
        const background = css.backgroundImage === 'none' ? css.backgroundColor : css.backgroundImage;
        return { background, color: css.color, border: css.borderColor, shadow: css.boxShadow };
      };
      return {
        rootClass: document.querySelector('#magnetar-banner').className,
        primaryInk: getComputedStyle(document.querySelector('#magnetar-banner')).getPropertyValue('--mg-primary-ink').trim(),
        buttonInk: getComputedStyle(document.querySelector('#magnetar-send')).getPropertyValue('--mg-ink').trim(),
        buttonPrimaryInk: getComputedStyle(document.querySelector('#magnetar-send')).getPropertyValue('--mg-primary-ink').trim(),
        rootHighlight: getComputedStyle(document.querySelector('#magnetar-banner')).getPropertyValue('--mg-glass-highlight').trim(),
        buttonHighlight: getComputedStyle(document.querySelector('#magnetar-send')).getPropertyValue('--mg-glass-highlight').trim(),
        toggleDisabled: document.querySelector('#magnetar-send-target-toggle').disabled,
        send: style('#magnetar-send'), toggle: style('#magnetar-send-target-toggle'),
        save: style('#magnetar-save'), sync: style('#magnetar-mobile-sync-open'),
        mine: style('#magnetar-banner-my-magnetar'), downloads: style('.magnetar-open-downloads'),
        manual: style('.magnetar-manual-send-toggle'), icon: style('#magnetar-theme'),
        divider: getComputedStyle(document.querySelector('#magnetar-send-target-toggle')).borderLeftWidth,
      };
    })()`);

    const verify = styles => {
      assert.equal(styles.send.background, styles.toggle.background, `Send segments must share one surface: ${JSON.stringify(styles)}`);
      assert.equal(styles.send.color, styles.toggle.color, `Send segments must share one foreground: ${JSON.stringify(styles)}`);
      assert.equal(styles.divider, '1px', 'Send separator must remain a hairline');
      for (const [name, style] of Object.entries(styles)) {
        if (!style || typeof style !== 'object') continue;
        assert.match(style.background, /rgba\(|color\(|oklab\(/, `${name} must retain a translucent Glass background: ${JSON.stringify(styles)}`);
        assert.doesNotMatch(style.background, /rgba\(0, 0, 0, 0\)|oklab\(0 0 0 \/ 0\)/, `${name} must have a visible Glass surface: ${JSON.stringify(styles)}`);
        assert.doesNotMatch(style.background, /rgb\(0, 0, 0\)|rgb\(30, 26, 20\)/, `${name} must not become an opaque black slab`);
      }
    };

    await page.send('DOM.enable');
    await page.send('CSS.enable');
    const documentNode = await page.send('DOM.getDocument');
    const sendNode = await page.send('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: '#magnetar-send' });
    const forceSendState = state => page.send('CSS.forcePseudoState', {
      nodeId: sendNode.nodeId,
      forcedPseudoClasses: state ? [state] : [],
    });
    const verifyStateSurface = (background, label) => {
      assert.match(background, /rgba\(/, `${label} must remain translucent`);
      assert.doesNotMatch(background, /rgb\(0, 0, 0\)|rgb\(30, 26, 20\)/, `${label} must not become opaque black`);
    };

    const day = await readStyles();
    verify(day);
    await forceSendState('hover');
    const dayHover = await readStyles();
    assert.notEqual(dayHover.send.background, day.send.background, 'Glass day hover must use its tinted hover surface');
    verifyStateSurface(dayHover.send.background, 'Glass day hover');
    await forceSendState('active');
    const dayActive = await readStyles();
    assert.notEqual(dayActive.send.background, day.send.background, 'Glass day active must use its tinted pressed surface');
    verifyStateSurface(dayActive.send.background, 'Glass day active');
    await forceSendState('focus-visible');
    assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('#magnetar-send')).outlineStyle`), 'solid');
    await forceSendState('');
    await page.evaluate(`document.querySelector('#magnetar-send-target-toggle').setAttribute('aria-expanded', 'true')`);
    const dayExpanded = await readStyles();
    assert.notEqual(dayExpanded.toggle.background, day.toggle.background, 'Expanded Glass split toggle must use its tinted state');
    await page.evaluate(`document.querySelector('#magnetar-send-target-toggle').setAttribute('aria-expanded', 'false')`);
    await page.evaluate(`document.querySelector('#magnetar-save').disabled = true`);
    const dayDisabled = await readStyles();
    assert.doesNotMatch(dayDisabled.save.background, /rgb\(0, 0, 0\)|rgb\(30, 26, 20\)/);
    await page.evaluate(`document.querySelector('#magnetar-save').disabled = false`);
    await screenshot(page, 'glass-toolbar-day.png');
    await page.evaluate(`document.querySelector('#magnetar-banner').classList.add('magnetar-theme-dark')`);
    await delay(300);
    const night = await readStyles();
    verify(night);
    await forceSendState('hover');
    const nightHover = await readStyles();
    assert.notEqual(nightHover.send.background, night.send.background, 'Glass night hover must use its lighter translucent tint');
    verifyStateSurface(nightHover.send.background, 'Glass night hover');
    await forceSendState('active');
    const nightActive = await readStyles();
    assert.notEqual(nightActive.send.background, night.send.background, 'Glass night active must use its pressed tint');
    verifyStateSurface(nightActive.send.background, 'Glass night active');
    await forceSendState('');
    await screenshot(page, 'glass-toolbar-night.png');
    page.close();
    console.log('Glass toolbar Chromium visual checks passed');
  } finally {
    server.close();
    if (chrome.pid && chrome.exitCode === null) spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        fs.rmSync(profile, { recursive: true, force: true });
        break;
      } catch (error) {
        if (error?.code !== 'EBUSY' || attempt === 7) throw error;
        await delay(250);
      }
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
