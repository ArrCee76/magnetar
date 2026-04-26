/**
 * Magnetar — Background Service Worker
 * 
 * Coordinates: icon states, context menus, Shield, provider API calls,
 * download history, batch sends,
 * and message passing between content scripts and popup.
 */

// Firefox MV2 loads libs via manifest.background.scripts (no importScripts in
// non-worker background pages). Chrome MV3 service workers must call this.
if (typeof importScripts === 'function') {
  importScripts(
    'lib/shield.js',
    'lib/cache-store.js',
    'lib/providers/local.js',
    'lib/providers/realdebrid.js',
    'lib/providers/rdtclient.js',
    'lib/providers/torbox.js',
    'lib/providers/premiumize.js',
    'lib/providers/alldebrid.js'
  );
}

// ── Provider Registry ────────────────────────────────────────────────────

const providers = {
  local: ProviderLocal,
  realdebrid: ProviderRealDebrid,
  rdtclient: ProviderRdtClient,
  torbox: ProviderTorBox,
  premiumize: ProviderPremiumize,
  alldebrid: ProviderAllDebrid
};

// ── Init ─────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  // First install — open onboarding
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  }

  // Update — show What's New
  if (details.reason === 'update') {
    const prev = details.previousVersion;
    const curr = chrome.runtime.getManifest().version;
    if (prev !== curr) {
      await chrome.storage.local.set({ 'magnetar-whatsnew': { from: prev, to: curr, seen: false } });
      chrome.tabs.create({ url: chrome.runtime.getURL('whatsnew.html') });
    }
  }

  // Set up context menus
  chrome.contextMenus.removeAll();

  chrome.contextMenus.create({
    id: 'magnetar-send-magnet',
    title: chrome.i18n.getMessage('contextMenuSendMagnet') || 'Send magnet to Magnetar',
    contexts: ['link'],
    targetUrlPatterns: ['magnet:*']
  });

  chrome.contextMenus.create({
    id: 'magnetar-block',
    title: chrome.i18n.getMessage('contextMenuBlock'),
    contexts: ['page']
  });

  chrome.contextMenus.create({
    id: 'magnetar-unblock',
    title: chrome.i18n.getMessage('contextMenuUnblock'),
    contexts: ['page']
  });

  // Initialise Shield
  await MagnetarShield.init();

  // Set default settings if needed
  const data = await chrome.storage.sync.get(['magnetar']);
  if (!data.magnetar) {
    await chrome.storage.sync.set({
      magnetar: {
        mode: 'local',
        credentials: {},
        customSites: [],
        preferences: {
          bannerPosition: 'top',
          bannerEnabled: true,
          batchMode: false,
          defaultTrackers: [],
          categoryMap: {
            audiobooks: 'audiobooks',
            music: 'music',
            video: 'video',
            ebooks: 'ebooks',
            software: 'software',
            games: 'games',
            general: ''
          }
        }
      }
    });
  } else if (data.magnetar.preferences) {
    // Migrate existing installs — add new preference keys
    let dirty = false;
    if (data.magnetar.preferences.bannerEnabled === undefined) {
      data.magnetar.preferences.bannerEnabled = true;
      dirty = true;
    }
    if (data.magnetar.preferences.batchMode === undefined) {
      data.magnetar.preferences.batchMode = false;
      dirty = true;
    }
    if (dirty) {
      await chrome.storage.sync.set({ magnetar: data.magnetar });
    }
  }

  // Init download history storage if needed
  const hist = await chrome.storage.local.get(['magnetar-history']);
  if (!hist['magnetar-history']) {
    await chrome.storage.local.set({ 'magnetar-history': [] });
  }
});

// Also init Shield on service worker startup (not just install)
// Use catch to handle the race condition if onInstalled also fires
MagnetarShield.init().catch(() => {});


// ── Context Menu Handling ────────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.url) return;

  try {
    if (info.menuItemId === 'magnetar-send-magnet' && info.linkUrl?.startsWith('magnet:')) {
      const settings = (await chrome.storage.sync.get(['magnetar'])).magnetar || {};
      const mode = settings.mode || 'local';
      const provider = providers[mode];

      if (mode === 'local') {
        // Open magnet in default client. Wrap in catch — the tab may be gone
        // between right-click and execution, which raises "No tab with id: N".
        chrome.tabs.update(tab.id, { url: info.linkUrl }).catch(() => {});
      } else if (provider) {
        const creds = settings.credentials?.[mode] || {};
        const result = await provider.sendMagnet(info.linkUrl, creds, { category: '' });
        if (result?.success) {
          // Extract hash for history
          const hashMatch = info.linkUrl.match(/btih:([a-fA-F0-9]{40}|[a-fA-F0-9]{64}|[A-Z2-7]{32})/i);
          const hash = hashMatch ? hashMatch[1].toLowerCase() : '';
          const nameMatch = info.linkUrl.match(/[?&]dn=([^&]+)/);
          const name = nameMatch ? decodeURIComponent(nameMatch[1].replace(/\+/g, ' ')) : '';
          await commitPostSend({
            hash, name, provider: mode, category: '', pageUrl: tab.url
          });
          if (hash) MagnetarCacheStore.set(mode, hash, 'cached');
        }
      }
      return;
    }

    const url = new URL(tab.url);
    const domain = url.hostname.replace(/^www\./, '');

    if (info.menuItemId === 'magnetar-block') {
      await MagnetarShield.blockDomain(domain);
      // Tab may be gone already when the user right-clicks then navigates away.
      chrome.tabs.remove(tab.id).catch(() => {});
    }

    if (info.menuItemId === 'magnetar-unblock') {
      await MagnetarShield.unblockDomain(domain);
    }
  } catch (e) {
    console.error('Magnetar: context menu error', e);
  }
});


// ── Tab Navigation — close tabs heading to blocked domains ───────────────

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;

  try {
    const url = new URL(details.url);
    const domain = url.hostname.replace(/^www\./, '');
    const blocked = await MagnetarShield.isBlocked(domain);

    if (blocked) {
      try {
        await chrome.tabs.remove(details.tabId);
      } catch (e) {
        // Tab may already be closed — ignore
      }
    }
  } catch (e) {
    // Invalid URL, ignore
  }
});


// ── Icon State Management ────────────────────────────────────────────────

const iconStates = {
  default: {
    '16': 'icons/icon16.png',
    '48': 'icons/icon48.png',
    '128': 'icons/icon128.png'
  },
  dimmed: {
    '16': 'icons/icon16-dimmed.png',
    '48': 'icons/icon48-dimmed.png',
    '128': 'icons/icon128-dimmed.png'
  },
  active: {
    '16': 'icons/icon16-active.png',
    '48': 'icons/icon48-active.png',
    '128': 'icons/icon128-active.png'
  }
};

// Cross-browser action API: chrome.action on MV3, chrome.browserAction on MV2 Firefox.
const browserAction = chrome.action || chrome.browserAction;

// chrome.storage.session is MV3-only. Fall back to an in-memory Map on Firefox.
// Service-worker restarts on Chrome wipe storage.session anyway, so the
// semantics (per-session, non-persistent) are equivalent.
const sessionStore = (() => {
  if (typeof chrome !== 'undefined'
      && chrome.storage
      && chrome.storage.session
      && typeof chrome.storage.session.set === 'function') {
    return {
      async set(obj) { return chrome.storage.session.set(obj); },
      async get(keys) { return chrome.storage.session.get(keys); }
    };
  }
  const mem = new Map();
  return {
    async set(obj) { for (const k of Object.keys(obj)) mem.set(k, obj[k]); },
    async get(keys) {
      const arr = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of arr) if (mem.has(k)) out[k] = mem.get(k);
      return out;
    }
  };
})();

function setIconState(tabId, state) {
  const icons = iconStates[state] || iconStates.default;
  if (!browserAction) return;
  // setIcon returns a Promise on Chromium and via the WebExtensions polyfill.
  // On legacy callback-based Firefox builds it doesn't, hence the try/catch wrap.
  try {
    const r = browserAction.setIcon({ tabId, path: icons });
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch (e) {}
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    setIconState(tabId, 'default');
  }
});


// ── Cache invalidation on provider/credential change ────────────────────
//
// The cache-store keys results by (providerId, hash). Switching modes is fine
// because old entries are keyed under the old provider and won't be queried.
// But rotating an API key for the SAME provider means old entries could be
// stale (new account, different cache state on the provider side). When
// settings change, if the active mode OR its credentials changed, clear the
// cache to be safe. Cheap operation, worst case it warms back up in a session.

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.magnetar) return;
  const oldS = changes.magnetar.oldValue || {};
  const newS = changes.magnetar.newValue || {};
  const modeChanged = oldS.mode !== newS.mode;
  const newMode = newS.mode;
  const oldCreds = newMode ? oldS.credentials?.[newMode] : null;
  const newCreds = newMode ? newS.credentials?.[newMode] : null;
  const credsChanged = JSON.stringify(oldCreds || {}) !== JSON.stringify(newCreds || {});
  if (modeChanged || credsChanged) {
    MagnetarCacheStore.clear().catch(() => {});
  }
});


// ── Download History ────────────────────────────────────────────────────

/**
 * Post-send storage update, done in one read + one write instead of three
 * read/write pairs. Records history, bumps send count, and drops the hash
 * from the saved-for-later queue if present. Returns the new send count.
 *
 * Two sends firing near-simultaneously can still race at the storage API
 * level (last write wins), but each call now has a much smaller window
 * (one round-trip) and touches exactly what it needs to touch.
 */
async function commitPostSend({ hash, name, provider, category, pageUrl }) {
  const data = await chrome.storage.local.get([
    'magnetar-history',
    'magnetar-send-count',
    'magnetar-saved'
  ]);

  const history = data['magnetar-history'] || [];
  const saved = data['magnetar-saved'] || [];
  const currentCount = data['magnetar-send-count'] || 0;

  const update = { 'magnetar-send-count': currentCount + 1 };

  // History: dedupe by hash
  if (hash && !history.some(h => h.hash === hash)) {
    history.unshift({
      hash,
      name: name || 'Unknown',
      provider,
      category: category || '',
      url: pageUrl || '',
      timestamp: Date.now()
    });
    if (history.length > 500) history.length = 500;
    update['magnetar-history'] = history;
  }

  // Saved queue: drop this hash if present
  if (hash && saved.some(s => s.hash === hash)) {
    update['magnetar-saved'] = saved.filter(s => s.hash !== hash);
  }

  await chrome.storage.local.set(update);
  return currentCount + 1;
}


// ── Message Handling ─────────────────────────────────────────────────────

// Cross-browser message dispatcher.
//
// Returning a Promise is the documented async-response pattern on Firefox MV2,
// and it has been supported on Chrome since 99 (March 2022). The legacy
// `return true; sendResponse(value)` pattern works reliably on Chrome MV3
// service workers but is flaky on Firefox — once the listener returns, the
// async sendResponse call can be dropped and the caller's promise never
// resolves. That's the symptom hudsgiant reported: settings get saved (the
// quick handler resolves in time) but validate-credentials hangs (the slower
// fetch handler returns after the listener exits).
chrome.runtime.onMessage.addListener((msg, sender) => {
  return handleMessage(msg, sender).catch(err => {
    console.error('Magnetar: message handler error', err);
    return { error: err.message };
  });
});

async function handleMessage(msg, sender) {
  const tabId = sender.tab?.id;

  switch (msg.type) {

    case 'detection-result': {
      if (!tabId) return;

      if (msg.data?.hash && !msg.data?.lowConfidence) {
        setIconState(tabId, 'active');
      } else if (msg.data?.noHash || msg.data?.lowConfidence) {
        setIconState(tabId, 'dimmed');
      } else {
        setIconState(tabId, 'default');
      }

      await sessionStore.set({ [`tab-${tabId}`]: msg.data || null });
      return { ok: true };
    }

    case 'get-settings': {
      const data = await chrome.storage.sync.get(['magnetar']);
      return data.magnetar || {};
    }

    case 'save-settings': {
      await chrome.storage.sync.set({ magnetar: msg.data });
      return { ok: true };
    }

    case 'send-magnet': {
      const settings = (await chrome.storage.sync.get(['magnetar'])).magnetar || {};
      const mode = settings.mode || 'local';
      const provider = providers[mode];
      if (!provider) return { success: false, error: 'Unknown mode: ' + mode };

      const creds = settings.credentials?.[mode] || {};

      if (mode === 'local') {
        return { success: true, action: 'open-magnet', magnetUri: msg.magnetUri };
      }

      const result = await provider.sendMagnet(msg.magnetUri, creds, {
        category: msg.category || ''
      });

      if (result?.success) {
        await commitPostSend({
          hash: msg.hash || '',
          name: msg.name || '',
          provider: mode,
          category: msg.category || '',
          pageUrl: msg.pageUrl || ''
        });
        // Seed the cache store — a successful add means it's now cached
        // for this provider. Skips a probe next time someone views this torrent.
        if (msg.hash) MagnetarCacheStore.set(mode, msg.hash, 'cached');
      }

      return result;
    }

    case 'batch-send': {
      const settings = (await chrome.storage.sync.get(['magnetar'])).magnetar || {};
      const mode = settings.mode || 'local';
      const provider = providers[mode];
      if (!provider) return { success: false, error: 'Unknown mode: ' + mode };

      const creds = settings.credentials?.[mode] || {};
      const items = msg.items || [];
      const results = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        if (mode === 'local') {
          results.push({ hash: item.hash, success: true, action: 'open-magnet', magnetUri: item.magnetUri });
          // Local mode: just bump the count (no history because nothing actually sent)
          const sc = await chrome.storage.local.get(['magnetar-send-count']);
          await chrome.storage.local.set({
            'magnetar-send-count': (sc['magnetar-send-count'] || 0) + 1
          });
          continue;
        }

        try {
          const res = await provider.sendMagnet(item.magnetUri, creds, {
            category: item.category || ''
          });
          results.push({ hash: item.hash, ...res });

          if (res?.success) {
            await commitPostSend({
              hash: item.hash,
              name: item.name,
              provider: mode,
              category: item.category || '',
              pageUrl: msg.pageUrl || ''
            });
            MagnetarCacheStore.set(mode, item.hash, 'cached');
          }

          // Small delay between sends to avoid rate limiting
          if (i < items.length - 1) {
            await new Promise(r => setTimeout(r, 300));
          }
        } catch (e) {
          results.push({ hash: item.hash, success: false, error: e.message });
        }
      }

      return { success: true, results };
    }

    case 'check-cache': {
      const settings = (await chrome.storage.sync.get(['magnetar'])).magnetar || {};
      const mode = settings.mode || 'local';
      const provider = providers[mode];
      if (!provider) return { status: 'unknown' };

      const hash = msg.hash;
      if (!hash) return { status: 'unknown' };

      // Tier 1 + 2: memory, then persistent storage.
      const cached = await MagnetarCacheStore.get(mode, hash);
      if (cached) return { status: cached.status, cached: true };

      // Tier 3: coalesce concurrent calls for the same hash.
      const creds = settings.credentials?.[mode] || {};
      const status = await MagnetarCacheStore.dedup(mode, hash, async () => {
        return await provider.checkCache(hash, creds);
      });

      // Don't store 'unknown' — that's usually a transient API / credentials error.
      if (status === 'cached' || status === 'not_cached') {
        MagnetarCacheStore.set(mode, hash, status);
      }
      return { status };
    }

    case 'cache-stats': {
      return await MagnetarCacheStore.stats();
    }

    case 'cache-clear': {
      await MagnetarCacheStore.clear();
      return { ok: true };
    }

    case 'validate-credentials': {
      const provider = providers[msg.mode];
      if (!provider) return { valid: false, error: 'Unknown mode' };
      return await provider.validateCredentials(msg.credentials);
    }

    case 'shield-get': {
      const data = await chrome.storage.local.get(['shield']);
      return data.shield || { enabled: true, blockedDomains: [] };
    }

    case 'shield-toggle': {
      return await MagnetarShield.toggle(msg.enabled);
    }

    case 'shield-block': {
      return await MagnetarShield.blockDomain(msg.domain);
    }

    case 'shield-unblock': {
      return await MagnetarShield.unblockDomain(msg.domain);
    }

    case 'get-detection': {
      if (msg.tabId) {
        const data = await sessionStore.get([`tab-${msg.tabId}`]);
        return data[`tab-${msg.tabId}`] || null;
      }
      return null;
    }

    case 'get-history': {
      const data = await chrome.storage.local.get(['magnetar-history']);
      return data['magnetar-history'] || [];
    }

    case 'clear-history': {
      await chrome.storage.local.set({ 'magnetar-history': [] });
      return { ok: true };
    }

    case 'delete-history-item': {
      const data = await chrome.storage.local.get(['magnetar-history']);
      const history = data['magnetar-history'] || [];
      const filtered = history.filter(h => h.hash !== msg.hash);
      await chrome.storage.local.set({ 'magnetar-history': filtered });
      return { ok: true };
    }

    case 'check-history': {
      const data = await chrome.storage.local.get(['magnetar-history']);
      const history = data['magnetar-history'] || [];
      const historyHashes = new Set(history.map(h => h.hash));
      const results = {};
      for (const h of (msg.hashes || [])) {
        results[h] = historyHashes.has(h);
      }
      return results;
    }

    case 'check-single-history': {
      const data = await chrome.storage.local.get(['magnetar-history']);
      const history = data['magnetar-history'] || [];
      return { inHistory: history.some(h => h.hash === msg.hash) };
    }

    // ── Saved-for-later queue ──────────────────────────────────────────
    case 'save-torrent': {
      const data = await chrome.storage.local.get(['magnetar-saved']);
      const saved = data['magnetar-saved'] || [];
      if (saved.some(s => s.hash === msg.hash)) {
        return { ok: true, alreadySaved: true };
      }
      saved.unshift({
        hash: msg.hash,
        name: msg.name || 'Unknown',
        magnetUri: msg.magnetUri || '',
        category: msg.category || '',
        sourceUrl: msg.sourceUrl || '',
        savedAt: Date.now()
      });
      if (saved.length > 500) saved.length = 500;
      await chrome.storage.local.set({ 'magnetar-saved': saved });
      return { ok: true };
    }

    case 'get-saved': {
      const data = await chrome.storage.local.get(['magnetar-saved']);
      return data['magnetar-saved'] || [];
    }

    case 'delete-saved-item': {
      const data = await chrome.storage.local.get(['magnetar-saved']);
      const saved = data['magnetar-saved'] || [];
      const filtered = saved.filter(s => s.hash !== msg.hash);
      await chrome.storage.local.set({ 'magnetar-saved': filtered });
      return { ok: true };
    }

    case 'clear-saved': {
      await chrome.storage.local.set({ 'magnetar-saved': [] });
      return { ok: true };
    }

    case 'check-saved': {
      const data = await chrome.storage.local.get(['magnetar-saved']);
      const saved = data['magnetar-saved'] || [];
      return { isSaved: saved.some(s => s.hash === msg.hash) };
    }

    case 'get-whatsnew': {
      const data = await chrome.storage.local.get(['magnetar-whatsnew']);
      return data['magnetar-whatsnew'] || null;
    }

    case 'dismiss-whatsnew': {
      const data = await chrome.storage.local.get(['magnetar-whatsnew']);
      if (data['magnetar-whatsnew']) {
        data['magnetar-whatsnew'].seen = true;
        await chrome.storage.local.set({ 'magnetar-whatsnew': data['magnetar-whatsnew'] });
      }
      return { ok: true };
    }

    case 'get-send-count': {
      const data = await chrome.storage.local.get(['magnetar-send-count']);
      return { count: data['magnetar-send-count'] || 0 };
    }

    case 'dismiss-review-prompt': {
      await chrome.storage.local.set({ 'magnetar-review-dismissed': true });
      return { ok: true };
    }

    case 'get-review-status': {
      const [countData, dismissData] = await Promise.all([
        chrome.storage.local.get(['magnetar-send-count']),
        chrome.storage.local.get(['magnetar-review-dismissed'])
      ]);
      return {
        count: countData['magnetar-send-count'] || 0,
        dismissed: dismissData['magnetar-review-dismissed'] === true
      };
    }

    case 'export-history-csv': {
      const data = await chrome.storage.local.get(['magnetar-history']);
      const history = data['magnetar-history'] || [];
      const header = 'Name,Hash,Provider,Category,URL,Date';
      const rows = history.map(h => {
        const date = new Date(h.timestamp).toISOString();
        const esc = (s) => `"${(s || '').replace(/"/g, '""')}"`;
        return `${esc(h.name)},${esc(h.hash)},${esc(h.provider)},${esc(h.category)},${esc(h.url)},${esc(date)}`;
      });
      return { csv: header + '\n' + rows.join('\n') };
    }

    case 'get-theme': {
      const data = await chrome.storage.sync.get(['magnetar']);
      return { theme: data.magnetar?.preferences?.theme || 'light' };
    }

    case 'set-theme': {
      const s = (await chrome.storage.sync.get(['magnetar'])).magnetar || {};
      s.preferences = s.preferences || {};
      s.preferences.theme = msg.theme;
      await chrome.storage.sync.set({ magnetar: s });
      return { ok: true };
    }

    case 'open-options': {
      chrome.runtime.openOptionsPage();
      return { ok: true };
    }

    default:
      return { error: 'Unknown message type: ' + msg.type };
  }
}
