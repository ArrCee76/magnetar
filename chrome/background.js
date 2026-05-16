/**
 * Magnetar — Background Service Worker
 * 
 * Coordinates: icon states, context menus, Shield, provider API calls,
 * download history, batch sends,
 * and message passing between content scripts and popup.
 */

// Firefox MV2 loads libs via manifest.background.scripts (no importScripts in
// non-worker background pages). Chrome MV3 service workers must call this.
// The polyfill+shim load first so every subsequent lib sees the Promise API.
if (typeof importScripts === 'function') {
  importScripts(
    'lib/browser-polyfill.min.js',
    'lib/api-shim.js',
    'lib/fetch-helper.js',
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

const providerLabels = {
  local: 'Local torrent client',
  realdebrid: 'Real-Debrid',
  rdtclient: 'RDT Client',
  torbox: 'TorBox',
  premiumize: 'Premiumize',
  alldebrid: 'AllDebrid'
};

const providerOrder = ['local', 'realdebrid', 'rdtclient', 'torbox', 'premiumize', 'alldebrid'];

const providerDashboardUrls = {
  realdebrid: 'https://real-debrid.com/torrents',
  torbox: 'https://torbox.app/dashboard',
  premiumize: 'https://www.premiumize.me/transfers',
  alldebrid: 'https://alldebrid.com/magnets/'
};

const DEFAULT_SETTINGS = {
  mode: 'local',
  credentials: {},
  providerStatus: {},
  customSites: [],
  ignoredWebsites: [],
  preferences: {
    theme: 'light',
    bannerPosition: 'top',
    bannerStyle: 'full',
    interfaceMode: 'advanced',
    bannerEnabled: true,
    batchMode: false,
    batchMax: 25,
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
};

function mergeSettingsDefaults(settings = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    credentials: settings.credentials && typeof settings.credentials === 'object' ? settings.credentials : {},
    providerStatus: settings.providerStatus && typeof settings.providerStatus === 'object' ? settings.providerStatus : {},
    customSites: Array.isArray(settings.customSites) ? settings.customSites : [],
    ignoredWebsites: Array.isArray(settings.ignoredWebsites) ? settings.ignoredWebsites : [],
    preferences: {
      ...DEFAULT_SETTINGS.preferences,
      ...(settings.preferences && typeof settings.preferences === 'object' ? settings.preferences : {}),
      categoryMap: {
        ...DEFAULT_SETTINGS.preferences.categoryMap,
        ...(settings.preferences?.categoryMap && typeof settings.preferences.categoryMap === 'object'
          ? settings.preferences.categoryMap
          : {})
      },
      defaultTrackers: Array.isArray(settings.preferences?.defaultTrackers)
        ? settings.preferences.defaultTrackers
        : []
    }
  };
}

function hasUsableProviderCredentials(settings, mode) {
  if (mode === 'local') return true;
  const creds = settings.credentials?.[mode];
  if (!creds || typeof creds !== 'object') return false;
  if (mode === 'rdtclient') return !!(creds.url && creds.username);
  return !!creds.apiKey;
}

function isQuickSendProviderAvailable(settings, mode) {
  if (mode === 'local') return true;
  const status = settings.providerStatus?.[mode];
  if (status?.valid === true) return true;
  if (status?.valid === false) return false;
  return hasUsableProviderCredentials(settings, mode);
}

function getQuickSendProviders(settings) {
  const currentMode = settings.mode || 'local';
  return providerOrder
    .filter(mode => mode !== currentMode)
    .filter(mode => isQuickSendProviderAvailable(settings, mode))
    .map(mode => ({
      id: mode,
      label: providerLabels[mode] || mode,
      isDefault: false
    }));
}

function normaliseDashboardUrl(value) {
  if (!value || typeof value !== 'string') return '';
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    if (url.username || url.password) return '';
    return url.href;
  } catch (e) {
    return '';
  }
}

function normaliseSourceUrl(value) {
  if (!value || typeof value !== 'string') return '';
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch (e) {
    return '';
  }
}

function getSourceDomain(sourceUrl) {
  if (!sourceUrl) return '';
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./i, '');
  } catch (e) {
    return '';
  }
}

function buildMagnetUriFromHistory(entry = {}) {
  if (entry.magnetUri && typeof entry.magnetUri === 'string') return entry.magnetUri;
  if (!entry.hash) return '';
  const dn = entry.name ? `&dn=${encodeURIComponent(entry.name)}` : '';
  return `magnet:?xt=urn:btih:${entry.hash}${dn}`;
}

function getProviderOpenTarget(settings, mode) {
  const label = providerLabels[mode] || mode;
  if (providerDashboardUrls[mode]) {
    return { mode, label, url: providerDashboardUrls[mode] };
  }

  const creds = settings.credentials?.[mode] || {};
  const customUrl = normaliseDashboardUrl(creds.dashboardUrl);
  if (!customUrl) return null;

  return {
    mode,
    label: mode === 'local' ? 'qBittorrent' : label,
    url: customUrl
  };
}

// ── Init ─────────────────────────────────────────────────────────────────

MAGNETAR_API.runtime.onInstalled.addListener(async (details) => {
  // First install — open onboarding
  if (details.reason === 'install') {
    MAGNETAR_API.tabs.create({ url: MAGNETAR_API.runtime.getURL('onboarding.html') });
  }

  // Update — show What's New
  if (details.reason === 'update') {
    const prev = details.previousVersion;
    const curr = MAGNETAR_API.runtime.getManifest().version;
    if (prev !== curr) {
      await MAGNETAR_API.storage.local.set({ 'magnetar-whatsnew': { from: prev, to: curr, seen: false } });
      MAGNETAR_API.tabs.create({ url: MAGNETAR_API.runtime.getURL('whatsnew.html') });
    }
  }

  // Set up context menus
  await MAGNETAR_API.contextMenus.removeAll();

  MAGNETAR_API.contextMenus.create({
    id: 'magnetar-send-magnet',
    title: MAGNETAR_API.i18n.getMessage('contextMenuSendMagnet') || 'Send magnet to Magnetar',
    contexts: ['link'],
    targetUrlPatterns: ['magnet:*']
  });

  MAGNETAR_API.contextMenus.create({
    id: 'magnetar-block',
    title: MAGNETAR_API.i18n.getMessage('contextMenuBlock'),
    contexts: ['page']
  });

  MAGNETAR_API.contextMenus.create({
    id: 'magnetar-unblock',
    title: MAGNETAR_API.i18n.getMessage('contextMenuUnblock'),
    contexts: ['page']
  });

  // Initialise Shield
  await MagnetarShield.init();

  // Set default settings if needed
  const data = await MAGNETAR_API.storage.sync.get(['magnetar']);
  const mergedSettings = mergeSettingsDefaults(data.magnetar);
  if (JSON.stringify(data.magnetar || null) !== JSON.stringify(mergedSettings)) {
    await MAGNETAR_API.storage.sync.set({ magnetar: mergedSettings });
  }

  // Init download history storage if needed
  const hist = await MAGNETAR_API.storage.local.get(['magnetar-history']);
  if (!hist['magnetar-history']) {
    await MAGNETAR_API.storage.local.set({ 'magnetar-history': [] });
  }
});

// Also init Shield on service worker startup (not just install)
// Use catch to handle the race condition if onInstalled also fires
MagnetarShield.init().catch(() => {});


// ── Context Menu Handling ────────────────────────────────────────────────

MAGNETAR_API.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.url) return;

  try {
    if (info.menuItemId === 'magnetar-send-magnet' && info.linkUrl?.startsWith('magnet:')) {
      const settings = (await MAGNETAR_API.storage.sync.get(['magnetar'])).magnetar || {};
      const mode = settings.mode || 'local';
      const provider = providers[mode];

      if (mode === 'local') {
        // Open magnet in default client. Wrap in catch — the tab may be gone
        // between right-click and execution, which raises "No tab with id: N".
        MAGNETAR_API.tabs.update(tab.id, { url: info.linkUrl }).catch(() => {});
        const hashMatch = info.linkUrl.match(/btih:([a-fA-F0-9]{40}|[a-fA-F0-9]{64}|[A-Z2-7]{32})/i);
        const hash = hashMatch ? hashMatch[1].toLowerCase() : '';
        const nameMatch = info.linkUrl.match(/[?&]dn=([^&]+)/);
        const name = nameMatch ? decodeURIComponent(nameMatch[1].replace(/\+/g, ' ')) : '';
        await commitPostSend({
          hash,
          name,
          provider: mode,
          category: '',
          pageUrl: tab.url,
          magnetUri: info.linkUrl
        });
      } else if (provider) {
        const creds = settings.credentials?.[mode] || {};
        const result = await provider.sendMagnet(info.linkUrl, creds, { category: '' });
        if (result?.success) {
          // Extract hash for history
          const hashMatch = info.linkUrl.match(/btih:([a-fA-F0-9]{40}|[a-fA-F0-9]{64}|[A-Z2-7]{32})/i);
          const hash = hashMatch ? hashMatch[1].toLowerCase() : '';
          const nameMatch = info.linkUrl.match(/[?&]dn=([^&]+)/);
          const name = nameMatch ? decodeURIComponent(nameMatch[1].replace(/\+/g, ' ')) : '';
          const cacheEntry = hash ? await MagnetarCacheStore.get(mode, hash) : null;
          await commitPostSend({
            hash, name, provider: mode, category: '', pageUrl: tab.url,
            magnetUri: info.linkUrl,
            cacheAtSend: cacheEntry?.status
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
      MAGNETAR_API.tabs.remove(tab.id).catch(() => {});
    }

    if (info.menuItemId === 'magnetar-unblock') {
      await MagnetarShield.unblockDomain(domain);
    }
  } catch (e) {
    console.error('Magnetar: context menu error', e);
  }
});


// ── Tab Navigation — close tabs heading to blocked domains ───────────────

MAGNETAR_API.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;

  try {
    const url = new URL(details.url);
    const domain = url.hostname.replace(/^www\./, '');
    const blocked = await MagnetarShield.isBlocked(domain);

    if (blocked) {
      try {
        await MAGNETAR_API.tabs.remove(details.tabId);
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

// Cross-browser action API: MAGNETAR_API.action on MV3, MAGNETAR_API.browserAction on MV2 Firefox.
const browserAction = MAGNETAR_API.action || MAGNETAR_API.browserAction;

// MAGNETAR_API.storage.session is MV3-only. Fall back to an in-memory Map on Firefox.
// Service-worker restarts on Chrome wipe storage.session anyway, so the
// semantics (per-session, non-persistent) are equivalent.
const sessionStore = (() => {
  if (typeof MAGNETAR_API !== 'undefined'
      && MAGNETAR_API.storage
      && MAGNETAR_API.storage.session
      && typeof MAGNETAR_API.storage.session.set === 'function') {
    return {
      async set(obj) { return MAGNETAR_API.storage.session.set(obj); },
      async get(keys) { return MAGNETAR_API.storage.session.get(keys); }
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

MAGNETAR_API.tabs.onUpdated.addListener((tabId, changeInfo) => {
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

MAGNETAR_API.storage.onChanged.addListener((changes, area) => {
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
async function commitPostSend({ hash, name, provider, category, pageUrl, magnetUri, cacheAtSend }) {
  const data = await MAGNETAR_API.storage.local.get([
    'magnetar-history',
    'magnetar-send-count',
    'magnetar-saved'
  ]);

  const history = data['magnetar-history'] || [];
  const saved = data['magnetar-saved'] || [];
  const currentCount = data['magnetar-send-count'] || 0;

  const update = { 'magnetar-send-count': currentCount + 1 };

  const sourceUrl = normaliseSourceUrl(pageUrl);
  const sourceDomain = getSourceDomain(sourceUrl);
  const now = Date.now();
  const existingIndex = hash ? history.findIndex(h => h.hash === hash) : -1;

  // History: dedupe by hash, but keep the existing row useful on repeat sends.
  if (hash && existingIndex === -1) {
    const entry = {
      hash,
      name: name || 'Unknown',
      provider,
      category: category || '',
      url: sourceUrl,
      sourceUrl,
      sourceDomain,
      magnetUri: magnetUri || '',
      timestamp: now,
      lastSentAt: now,
      sendCount: 1
    };
    if (cacheAtSend === 'cached' || cacheAtSend === 'not_cached') {
      entry.cacheAtSend = cacheAtSend;
    }
    history.unshift(entry);
    if (history.length > 500) history.length = 500;
    update['magnetar-history'] = history;
  } else if (existingIndex >= 0) {
    const existing = history[existingIndex];
    const updatedEntry = {
      ...existing,
      name: name || existing.name || 'Unknown',
      provider: provider || existing.provider || '',
      category: category || existing.category || '',
      url: sourceUrl || existing.url || '',
      sourceUrl: sourceUrl || existing.sourceUrl || existing.url || '',
      sourceDomain: sourceDomain || existing.sourceDomain || getSourceDomain(existing.sourceUrl || existing.url || ''),
      magnetUri: magnetUri || existing.magnetUri || '',
      lastSentAt: now,
      sendCount: (existing.sendCount || 1) + 1
    };
    if (cacheAtSend === 'cached' || cacheAtSend === 'not_cached') {
      updatedEntry.cacheAtSend = cacheAtSend;
    }
    history.splice(existingIndex, 1);
    history.unshift(updatedEntry);
    update['magnetar-history'] = history;
  }

  // Saved queue: drop this hash if present
  if (hash && saved.some(s => s.hash === hash)) {
    update['magnetar-saved'] = saved.filter(s => s.hash !== hash);
  }

  await MAGNETAR_API.storage.local.set(update);
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
MAGNETAR_API.runtime.onMessage.addListener((msg, sender) => {
  return handleMessage(msg, sender).catch(err => {
    console.error('Magnetar: message handler error', err);
    return { error: err.message };
  });
});

function withTimeout(promise, ms, timeoutResult) {
  let timer;
  const timeoutPromise = new Promise(resolve => {
    timer = setTimeout(() => resolve(timeoutResult), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

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
      const data = await MAGNETAR_API.storage.sync.get(['magnetar']);
      return data.magnetar || {};
    }

    case 'save-settings': {
      await MAGNETAR_API.storage.sync.set({ magnetar: msg.data });
      return { ok: true };
    }

    case 'get-tab-pin': {
      if (!tabId) return { pinned: false };
      const data = await sessionStore.get([`pin-tab-${tabId}`]);
      return { pinned: data[`pin-tab-${tabId}`] === true };
    }

    case 'set-tab-pin': {
      if (!tabId) return { ok: false };
      await sessionStore.set({ [`pin-tab-${tabId}`]: msg.pinned === true });
      return { ok: true, pinned: msg.pinned === true };
    }

    case 'get-batch-session': {
      if (!tabId) return null;
      const data = await sessionStore.get([`batch-tab-${tabId}`]);
      return data[`batch-tab-${tabId}`] || null;
    }

    case 'save-batch-session': {
      if (!tabId) return { ok: false };
      const session = msg.data && typeof msg.data === 'object' ? msg.data : null;
      await sessionStore.set({ [`batch-tab-${tabId}`]: session });
      return { ok: true };
    }

    case 'clear-batch-session': {
      if (!tabId) return { ok: false };
      await sessionStore.set({ [`batch-tab-${tabId}`]: null });
      return { ok: true };
    }

    case 'get-quick-send-providers': {
      const settings = (await MAGNETAR_API.storage.sync.get(['magnetar'])).magnetar || {};
      return getQuickSendProviders(settings);
    }

    case 'get-provider-open-target': {
      const settings = (await MAGNETAR_API.storage.sync.get(['magnetar'])).magnetar || {};
      const mode = msg.mode || settings.mode || 'local';
      return getProviderOpenTarget(settings, mode);
    }

    case 'open-downloads-folder': {
      const downloadsApi = MAGNETAR_API.downloads;
      if (!downloadsApi || typeof downloadsApi.showDefaultFolder !== 'function') {
        return { success: false, error: 'Downloads folder is not available in this browser.' };
      }

      try {
        const result = downloadsApi.showDefaultFolder();
        if (result && typeof result.then === 'function') await result;
        return { success: true };
      } catch (e) {
        return { success: false, error: e?.message || 'Could not open downloads folder.' };
      }
    }

    case 'send-magnet': {
      const settings = (await MAGNETAR_API.storage.sync.get(['magnetar'])).magnetar || {};
      const mode = msg.mode || settings.mode || 'local';
      const provider = providers[mode];
      if (!provider) return { success: false, error: 'Unknown mode: ' + mode };

      const creds = settings.credentials?.[mode] || {};

      if (mode === 'local') {
        await commitPostSend({
          hash: msg.hash || '',
          name: msg.name || '',
          provider: mode,
          category: msg.category || '',
          pageUrl: msg.pageUrl || '',
          magnetUri: msg.magnetUri || ''
        });
        return { success: true, action: 'open-magnet', magnetUri: msg.magnetUri, provider: mode };
      }

      const result = await provider.sendMagnet(msg.magnetUri, creds, {
        category: msg.category || ''
      }) || { success: false, error: 'Provider returned no response' };

      if (result?.success) {
        const cacheEntry = msg.hash ? await MagnetarCacheStore.get(mode, msg.hash) : null;
        const displayName = result.name || result.title || result.filename || msg.name || '';
        await commitPostSend({
          hash: msg.hash || '',
          name: displayName,
          provider: mode,
          category: msg.category || '',
          pageUrl: msg.pageUrl || '',
          magnetUri: msg.magnetUri || '',
          cacheAtSend: cacheEntry?.status
        });
        // Seed the cache store — a successful add means it's now cached
        // for this provider. Skips a probe next time someone views this torrent.
        if (msg.hash) MagnetarCacheStore.set(mode, msg.hash, 'cached');
      }

      return { ...result, provider: mode };
    }

    case 'batch-send': {
      const settings = (await MAGNETAR_API.storage.sync.get(['magnetar'])).magnetar || {};
      const mode = msg.mode || settings.mode || 'local';
      const provider = providers[mode];
      if (!provider) return { success: false, error: 'Unknown mode: ' + mode };

      const creds = settings.credentials?.[mode] || {};
      const items = msg.items || [];
      const results = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        if (mode === 'local') {
          results.push({ hash: item.hash, success: true, action: 'open-magnet', magnetUri: item.magnetUri, provider: mode });
          await commitPostSend({
            hash: item.hash,
            name: item.name,
            provider: mode,
            category: item.category || '',
            pageUrl: msg.pageUrl || '',
            magnetUri: item.magnetUri || ''
          });
          continue;
        }

        try {
          const res = await provider.sendMagnet(item.magnetUri, creds, {
            category: item.category || ''
          }) || { success: false, error: 'Provider returned no response' };
          results.push({ hash: item.hash, ...res, provider: mode });

          if (res?.success) {
            const cacheEntry = item.hash ? await MagnetarCacheStore.get(mode, item.hash) : null;
            await commitPostSend({
              hash: item.hash,
              name: item.name,
              provider: mode,
              category: item.category || '',
              pageUrl: msg.pageUrl || '',
              magnetUri: item.magnetUri || '',
              cacheAtSend: cacheEntry?.status
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
      const settings = (await MAGNETAR_API.storage.sync.get(['magnetar'])).magnetar || {};
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
      return await withTimeout(
        provider.validateCredentials(msg.credentials || {}),
        15000,
        { valid: false, error: 'Connection timed out. Check the API key, network, or provider status.' }
      );
    }

    case 'shield-get': {
      const data = await MAGNETAR_API.storage.local.get(['shield']);
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
      const data = await MAGNETAR_API.storage.local.get(['magnetar-history']);
      return data['magnetar-history'] || [];
    }

    case 'clear-history': {
      await MAGNETAR_API.storage.local.set({ 'magnetar-history': [] });
      return { ok: true };
    }

    case 'delete-history-item': {
      const data = await MAGNETAR_API.storage.local.get(['magnetar-history']);
      const history = data['magnetar-history'] || [];
      const filtered = history.filter(h => h.hash !== msg.hash);
      await MAGNETAR_API.storage.local.set({ 'magnetar-history': filtered });
      return { ok: true };
    }

    case 'check-history': {
      const data = await MAGNETAR_API.storage.local.get(['magnetar-history']);
      const history = data['magnetar-history'] || [];
      const historyHashes = new Set(history.map(h => h.hash));
      const results = {};
      for (const h of (msg.hashes || [])) {
        results[h] = historyHashes.has(h);
      }
      return results;
    }

    case 'check-single-history': {
      const data = await MAGNETAR_API.storage.local.get(['magnetar-history']);
      const history = data['magnetar-history'] || [];
      return { inHistory: history.some(h => h.hash === msg.hash) };
    }

    case 'resend-history-item': {
      const data = await MAGNETAR_API.storage.local.get(['magnetar-history']);
      const history = data['magnetar-history'] || [];
      const entry = history.find(h => h.hash === msg.hash);
      if (!entry) return { success: false, error: 'History item not found.' };

      const settings = (await MAGNETAR_API.storage.sync.get(['magnetar'])).magnetar || {};
      const preferredMode = entry.provider || '';
      const mode = isQuickSendProviderAvailable(settings, preferredMode)
        ? preferredMode
        : (settings.mode || 'local');
      const magnetUri = buildMagnetUriFromHistory(entry);
      if (!providers[mode] || !magnetUri) {
        return { success: false, error: 'This history item cannot be resent.' };
      }

      const resend = await handleMessage({
        type: 'send-magnet',
        hash: entry.hash || '',
        name: entry.name || '',
        magnetUri,
        category: entry.category || '',
        pageUrl: entry.sourceUrl || entry.url || '',
        mode
      }, sender);

      return {
        ...resend,
        provider: resend?.provider || mode,
        usedFallbackProvider: !!preferredMode && preferredMode !== mode
      };
    }

    // ── Saved-for-later queue ──────────────────────────────────────────
    case 'save-torrent': {
      const data = await MAGNETAR_API.storage.local.get(['magnetar-saved']);
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
      await MAGNETAR_API.storage.local.set({ 'magnetar-saved': saved });
      return { ok: true };
    }

    case 'get-saved': {
      const data = await MAGNETAR_API.storage.local.get(['magnetar-saved']);
      return data['magnetar-saved'] || [];
    }

    case 'delete-saved-item': {
      const data = await MAGNETAR_API.storage.local.get(['magnetar-saved']);
      const saved = data['magnetar-saved'] || [];
      const filtered = saved.filter(s => s.hash !== msg.hash);
      await MAGNETAR_API.storage.local.set({ 'magnetar-saved': filtered });
      return { ok: true };
    }

    case 'clear-saved': {
      await MAGNETAR_API.storage.local.set({ 'magnetar-saved': [] });
      return { ok: true };
    }

    case 'check-saved': {
      const data = await MAGNETAR_API.storage.local.get(['magnetar-saved']);
      const saved = data['magnetar-saved'] || [];
      return { isSaved: saved.some(s => s.hash === msg.hash) };
    }

    case 'get-whatsnew': {
      const data = await MAGNETAR_API.storage.local.get(['magnetar-whatsnew']);
      return data['magnetar-whatsnew'] || null;
    }

    case 'dismiss-whatsnew': {
      const data = await MAGNETAR_API.storage.local.get(['magnetar-whatsnew']);
      if (data['magnetar-whatsnew']) {
        data['magnetar-whatsnew'].seen = true;
        await MAGNETAR_API.storage.local.set({ 'magnetar-whatsnew': data['magnetar-whatsnew'] });
      }
      return { ok: true };
    }

    case 'get-send-count': {
      const data = await MAGNETAR_API.storage.local.get(['magnetar-send-count']);
      return { count: data['magnetar-send-count'] || 0 };
    }

    case 'dismiss-review-prompt': {
      await MAGNETAR_API.storage.local.set({ 'magnetar-review-dismissed': true });
      return { ok: true };
    }

    case 'get-review-status': {
      const [countData, dismissData] = await Promise.all([
        MAGNETAR_API.storage.local.get(['magnetar-send-count']),
        MAGNETAR_API.storage.local.get(['magnetar-review-dismissed'])
      ]);
      return {
        count: countData['magnetar-send-count'] || 0,
        dismissed: dismissData['magnetar-review-dismissed'] === true
      };
    }

    case 'export-history-csv': {
      const data = await MAGNETAR_API.storage.local.get(['magnetar-history']);
      const history = data['magnetar-history'] || [];
      const header = 'Name,Hash,Provider,Category,Source URL,Source Domain,Date';
      const rows = history.map(h => {
        const date = new Date(h.timestamp).toISOString();
        const esc = (s) => `"${(s || '').replace(/"/g, '""')}"`;
        const sourceUrl = h.sourceUrl || h.url || '';
        const sourceDomain = h.sourceDomain || getSourceDomain(sourceUrl);
        return `${esc(h.name)},${esc(h.hash)},${esc(h.provider)},${esc(h.category)},${esc(sourceUrl)},${esc(sourceDomain)},${esc(date)}`;
      });
      return { csv: header + '\n' + rows.join('\n') };
    }

    case 'get-theme': {
      const data = await MAGNETAR_API.storage.sync.get(['magnetar']);
      return { theme: data.magnetar?.preferences?.theme || 'dark' };
    }

    case 'set-theme': {
      const s = (await MAGNETAR_API.storage.sync.get(['magnetar'])).magnetar || {};
      s.preferences = s.preferences || {};
      s.preferences.theme = msg.theme;
      await MAGNETAR_API.storage.sync.set({ magnetar: s });
      return { ok: true };
    }

    case 'open-options': {
      MAGNETAR_API.runtime.openOptionsPage();
      return { ok: true };
    }

    default:
      return { error: 'Unknown message type: ' + msg.type };
  }
}
