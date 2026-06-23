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

const SUPPRESS_WHATSNEW_VERSIONS = new Set(['2.1.2']);

const providerOrder = ['local', 'realdebrid', 'rdtclient', 'torbox', 'premiumize', 'alldebrid'];

const providerDashboardUrls = {
  realdebrid: 'https://real-debrid.com/torrents',
  torbox: 'https://torbox.app/dashboard',
  premiumize: 'https://www.premiumize.me/transfers',
  alldebrid: 'https://alldebrid.com/magnets/'
};

const EXTENSION_OPENED_TAB_TTL = 45 * 1000;
const SHIELD_PENDING_POPUP_TTL = 30 * 1000;
const extensionOpenedTabs = new Map();
const extensionOpenedUrlGuards = new Map();
const shieldPendingPopupTabs = new Map();
let shieldStateCache = { enabled: true, blockedDomains: [] };
let configuredProtectedDomains = [];

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

function domainPatternMatches(hostname, pattern) {
  const host = String(hostname || '').toLowerCase();
  const escaped = String(pattern || '').toLowerCase()
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i').test(host);
}

function testMagnetarCustomSelectorInPage(selector) {
  const hashPattern = /\b(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64}|[A-Z2-7]{32})\b/;
  const magnetPattern = /magnet:\?xt=urn:btih:([a-fA-F0-9]{40}|[a-fA-F0-9]{64}|[A-Z2-7]{32})/i;
  try {
    const elements = Array.from(document.querySelectorAll(selector));
    const texts = elements.map(el => {
      const nodes = [el, ...Array.from(el.querySelectorAll?.('[href], [value], [title], [data-magnet], [data-hash], [data-infohash], [data-info-hash]') || [])];
      const attrs = nodes.flatMap(node => ['href', 'value', 'title', 'data-magnet', 'data-hash', 'data-infohash', 'data-info-hash']
        .map(attr => node.getAttribute?.(attr))
        .filter(Boolean));
      return [el.textContent || '', ...attrs].join(' ').replace(/\s+/g, ' ').trim();
    }).filter(Boolean);
    const joined = texts.join(' ').slice(0, 5000);
    const valid = magnetPattern.test(joined) || hashPattern.test(joined);
    const preview = (texts[0] || '').slice(0, 160);
    return { count: elements.length, preview, valid };
  } catch (e) {
    return { count: 0, preview: '', valid: false };
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

function normaliseHostname(hostname) {
  return String(hostname || '').trim().toLowerCase().replace(/^www\./, '');
}

function getHostnameFromUrl(value) {
  try {
    return normaliseHostname(new URL(value).hostname);
  } catch (e) {
    return '';
  }
}

function isBlankTabUrl(url) {
  return !url || url === 'about:blank' || url === 'about:newtab';
}

function domainMatchesRule(domain, rule) {
  domain = normaliseHostname(domain);
  rule = MagnetarShield.normaliseDomain(rule);
  return Boolean(domain && rule && (domain === rule || domain.endsWith('.' + rule)));
}

function isShieldProtectedDomain(domain) {
  domain = normaliseHostname(domain);
  if (configuredProtectedDomains.includes(domain)) return true;
  return Boolean(MagnetarShield.isProtectedDomain?.(domain));
}

function isBlockedByShieldCache(domain) {
  domain = normaliseHostname(domain);
  if (!domain || shieldStateCache.enabled === false || isShieldProtectedDomain(domain)) return false;
  return (shieldStateCache.blockedDomains || []).some(rule => domainMatchesRule(domain, rule));
}

async function refreshShieldStateCache() {
  const [shieldData, settingsData] = await Promise.all([
    MAGNETAR_API.storage.local.get(['shield']),
    MAGNETAR_API.storage.sync.get(['magnetar'])
  ]);
  const data = shieldData;
  const shield = data.shield || MagnetarShield.getDefaultShield();
  setShieldStateCache(shield);
  await refreshConfiguredShieldProtection(settingsData.magnetar, { reapplyRules: shieldStateCache.enabled !== false });
  return shieldStateCache;
}

function setShieldStateCache(shield) {
  const next = shield || MagnetarShield.getDefaultShield?.() || { enabled: true, blockedDomains: [] };
  shieldStateCache = {
    enabled: next.enabled !== false,
    blockedDomains: MagnetarShield.getEffectiveDomains
      ? MagnetarShield.getEffectiveDomains(next)
      : (Array.isArray(next.blockedDomains) ? next.blockedDomains : [])
  };
  return shieldStateCache;
}

function collectConfiguredProtectedDomains(settings = {}) {
  const merged = mergeSettingsDefaults(settings || {});
  const domains = new Set();
  const addUrl = value => {
    const safeUrl = normaliseDashboardUrl(value);
    if (!safeUrl) return;
    const host = getHostnameFromUrl(safeUrl);
    if (host) domains.add(host);
  };

  Object.values(merged.credentials || {}).forEach(creds => {
    if (!creds || typeof creds !== 'object') return;
    addUrl(creds.dashboardUrl);
  });
  addUrl(merged.credentials?.local?.dashboardUrl);
  addUrl(merged.credentials?.rdtclient?.url);
  addUrl(merged.credentials?.rdtclient?.dashboardUrl);

  return [...domains];
}

async function refreshConfiguredShieldProtection(settings, { reapplyRules = true } = {}) {
  configuredProtectedDomains = collectConfiguredProtectedDomains(settings || {});
  MagnetarShield.setExtraProtectedDomains(configuredProtectedDomains);

  if (reapplyRules && shieldStateCache.enabled !== false) {
    await MagnetarShield.applyRules(shieldStateCache.blockedDomains || []);
  }
  return configuredProtectedDomains;
}

async function fetchRecommendedShieldList() {
  let response;
  try {
    response = await fetch(MagnetarShield.RECOMMENDED_LIST_URL, {
      cache: 'no-store',
      credentials: 'omit'
    });
  } catch (e) {
    throw new Error('Could not fetch recommended list.');
  }
  if (!response?.ok) {
    throw new Error('Could not fetch recommended list.');
  }
  try {
    return await response.json();
  } catch (e) {
    throw new Error('Recommended list is not valid.');
  }
}

function pruneExtensionOpenedTabs(now = Date.now()) {
  for (const [tabId, entry] of extensionOpenedTabs.entries()) {
    if (!entry || now - Number(entry.createdAt || 0) > EXTENSION_OPENED_TAB_TTL) {
      extensionOpenedTabs.delete(tabId);
    }
  }
  for (const [url, entry] of extensionOpenedUrlGuards.entries()) {
    if (!entry || now - Number(entry.createdAt || 0) > 5000) {
      extensionOpenedUrlGuards.delete(url);
    }
  }
}

function isExtensionOpenedTab(tabId, url = '') {
  pruneExtensionOpenedTabs();
  const guarded = extensionOpenedUrlGuards.get(String(url || ''));
  if (guarded) return true;
  const entry = extensionOpenedTabs.get(tabId);
  if (!entry) return false;
  const expectedDomain = entry.expectedDomain || '';
  const actualDomain = getHostnameFromUrl(url);
  return !expectedDomain || !actualDomain || actualDomain === expectedDomain || actualDomain.endsWith('.' + expectedDomain);
}

async function openExtensionTab(createProps, purpose = 'extension') {
  const props = { ...(createProps || {}) };
  const expectedDomain = getHostnameFromUrl(props.url);
  if (props.url) {
    extensionOpenedUrlGuards.set(String(props.url), {
      createdAt: Date.now(),
      purpose
    });
  }
  const tab = await MAGNETAR_API.tabs.create(props);
  if (props.url) extensionOpenedUrlGuards.delete(String(props.url));
  if (tab?.id != null) {
    extensionOpenedTabs.set(tab.id, {
      createdAt: Date.now(),
      expectedDomain,
      purpose
    });
  }
  return tab;
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
    if (prev !== curr && !SUPPRESS_WHATSNEW_VERSIONS.has(curr)) {
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
  await refreshShieldStateCache();

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
MagnetarShield.init()
  .then(() => refreshShieldStateCache())
  .catch(() => {});


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

function pruneShieldPendingPopups(now = Date.now()) {
  for (const [tabId, entry] of shieldPendingPopupTabs.entries()) {
    if (!entry || now - Number(entry.createdAt || 0) > SHIELD_PENDING_POPUP_TTL) {
      shieldPendingPopupTabs.delete(tabId);
    }
  }
}

function rememberShieldPopupTab(tab, source = 'created') {
  if (!tab || tab.id == null) return;
  pruneShieldPendingPopups();
  const existing = shieldPendingPopupTabs.get(tab.id) || {};
  const url = tab.url || tab.pendingUrl || existing.lastUrl || '';
  shieldPendingPopupTabs.set(tab.id, {
    createdAt: existing.createdAt || Date.now(),
    openerTabId: tab.openerTabId ?? existing.openerTabId,
    initialUrl: existing.initialUrl || url || '',
    lastUrl: url || existing.lastUrl || '',
    source,
    blankOnCreate: existing.blankOnCreate || isBlankTabUrl(existing.initialUrl || url)
  });
}

function forgetShieldPopupTab(tabId) {
  if (tabId != null) shieldPendingPopupTabs.delete(tabId);
}

async function closeShieldBlockedTab(tabId, url, source = 'navigation', tab = null) {
  if (tabId == null) return false;
  if (tab) rememberShieldPopupTab(tab, source);
  if (isBlankTabUrl(url)) return false;
  if (isExtensionOpenedTab(tabId, url)) {
    forgetShieldPopupTab(tabId);
    return false;
  }
  const domain = getHostnameFromUrl(url);
  if (!domain) return false;
  if (shieldStateCache.enabled === false) {
    forgetShieldPopupTab(tabId);
    return false;
  }

  let blocked = isBlockedByShieldCache(domain);
  if (!blocked) {
    blocked = await MagnetarShield.isBlocked(domain);
  }
  if (!blocked) return false;

  try {
    await MAGNETAR_API.tabs.remove(tabId);
    forgetShieldPopupTab(tabId);
    return true;
  } catch (e) {
    // Tab may already be closed by DNR or another Shield path.
    forgetShieldPopupTab(tabId);
    return false;
  }
}

MAGNETAR_API.tabs.onCreated.addListener(tab => {
  rememberShieldPopupTab(tab, 'created');
  if (tab?.url) closeShieldBlockedTab(tab.id, tab.url, 'created', tab).catch(() => {});
});

MAGNETAR_API.webNavigation.onBeforeNavigate.addListener(details => {
  if (details.frameId !== 0) return;
  const existing = shieldPendingPopupTabs.get(details.tabId);
  if (existing) {
    rememberShieldPopupTab({
      id: details.tabId,
      openerTabId: existing.openerTabId,
      url: details.url
    }, 'beforeNavigate');
  }
  closeShieldBlockedTab(details.tabId, details.url, 'beforeNavigate').catch(() => {});
});

MAGNETAR_API.tabs.onRemoved.addListener(tabId => {
  forgetShieldPopupTab(tabId);
});

async function closeExistingShieldBlockedTabs(source = 'shield-refresh') {
  if (shieldStateCache.enabled === false) return;
  let tabs = [];
  try {
    tabs = await MAGNETAR_API.tabs.query({});
  } catch (e) {
    return;
  }
  await Promise.all((tabs || []).map(tab => {
    const url = tab?.url || tab?.pendingUrl || '';
    if (!url || isBlankTabUrl(url)) return Promise.resolve(false);
    return closeShieldBlockedTab(tab.id, url, source, tab).catch(() => false);
  }));
}


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

const ALLDEBRID_OPEN_TASK_PREFIX = 'magnetar-ad-open-';
const ALLDEBRID_OPEN_TASK_INDEX = 'magnetar-ad-open-index';
const ALLDEBRID_OPEN_TASK_TTL = 10 * 60 * 1000;

function createTaskId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normaliseAllDebridFileLinks(links) {
  const seen = new Set();
  return (Array.isArray(links) ? links : [])
    .map(link => String(link || '').trim())
    .filter(link => {
      if (!/^https:\/\/(?:www\.)?alldebrid\.com\/f\//i.test(link)) return false;
      if (seen.has(link)) return false;
      seen.add(link);
      return true;
    });
}

async function cleanupAllDebridOpenTasks(now = Date.now()) {
  const data = await sessionStore.get([ALLDEBRID_OPEN_TASK_INDEX]);
  const ids = Array.isArray(data[ALLDEBRID_OPEN_TASK_INDEX]) ? data[ALLDEBRID_OPEN_TASK_INDEX] : [];
  if (!ids.length) return;

  const keys = ids.map(id => `${ALLDEBRID_OPEN_TASK_PREFIX}${id}`);
  const tasks = await sessionStore.get(keys);
  const nextIds = [];
  const cleanup = {};
  ids.forEach((id, index) => {
    const key = keys[index];
    const task = tasks[key];
    if (task && now - Number(task.createdAt || 0) <= ALLDEBRID_OPEN_TASK_TTL) {
      nextIds.push(id);
    } else {
      cleanup[key] = null;
    }
  });
  cleanup[ALLDEBRID_OPEN_TASK_INDEX] = nextIds;
  await sessionStore.set(cleanup);
}

async function createAllDebridOpenTask(resolved = {}) {
  await cleanupAllDebridOpenTasks();
  const links = normaliseAllDebridFileLinks(resolved.links);
  if (!links.length) return null;

  const id = createTaskId();
  const key = `${ALLDEBRID_OPEN_TASK_PREFIX}${id}`;
  const data = await sessionStore.get([ALLDEBRID_OPEN_TASK_INDEX]);
  const ids = Array.isArray(data[ALLDEBRID_OPEN_TASK_INDEX]) ? data[ALLDEBRID_OPEN_TASK_INDEX] : [];
  const task = {
    id,
    provider: 'alldebrid',
    action: 'open',
    title: String(resolved.title || '').slice(0, 180),
    links,
    expectedLinkCount: links.length,
    createdAt: Date.now()
  };
  await sessionStore.set({
    [key]: task,
    [ALLDEBRID_OPEN_TASK_INDEX]: [...ids.filter(existing => existing !== id), id].slice(-20)
  });
  return id;
}

async function consumeAllDebridOpenTask(id) {
  const taskId = String(id || '').trim();
  if (!taskId) return null;
  await cleanupAllDebridOpenTasks();

  const key = `${ALLDEBRID_OPEN_TASK_PREFIX}${taskId}`;
  const data = await sessionStore.get([key, ALLDEBRID_OPEN_TASK_INDEX]);
  const task = data[key];
  const valid = task
    && task.provider === 'alldebrid'
    && task.action === 'open'
    && Date.now() - Number(task.createdAt || 0) <= ALLDEBRID_OPEN_TASK_TTL
    && normaliseAllDebridFileLinks(task.links).length >= 1;

  const ids = Array.isArray(data[ALLDEBRID_OPEN_TASK_INDEX]) ? data[ALLDEBRID_OPEN_TASK_INDEX] : [];
  await sessionStore.set({
    [key]: null,
    [ALLDEBRID_OPEN_TASK_INDEX]: ids.filter(existing => existing !== taskId)
  });

  if (!valid) return null;
  return {
    id: task.id,
    provider: 'alldebrid',
    action: 'open',
    title: task.title || '',
    links: normaliseAllDebridFileLinks(task.links),
    expectedLinkCount: normaliseAllDebridFileLinks(task.links).length
  };
}

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

MAGNETAR_API.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab?.url || tab?.pendingUrl || '';
  if (url) {
    closeShieldBlockedTab(tabId, url, 'updated', tab).catch(() => {});
  }
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
  if (area === 'local' && changes.shield) {
    setShieldStateCache(changes.shield.newValue);
    return;
  }
  if (area !== 'sync' || !changes.magnetar) return;
  const oldS = changes.magnetar.oldValue || {};
  const newS = changes.magnetar.newValue || {};
  refreshConfiguredShieldProtection(newS).catch(() => {});
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

    case 'list-client-items': {
      const settings = mergeSettingsDefaults((await MAGNETAR_API.storage.sync.get(['magnetar'])).magnetar || {});
      const mode = msg.mode || settings.mode || 'local';
      const provider = providers[mode];
      const providerLabel = providerLabels[mode] || mode;
      const debugClientList = (data = {}) => console.debug('Magnetar client panel', {
        provider: providerLabel,
        mode,
        ...data
      });

      debugClientList({ helper: 'background:list-client-items' });

      if (!mode || !provider) {
        return { success: false, setupRequired: true, provider: providerLabel, items: [] };
      }
      if (!hasUsableProviderCredentials(settings, mode)) {
        return { success: false, setupRequired: true, provider: providerLabel, items: [] };
      }
      if (typeof provider.listClientItems !== 'function') {
        debugClientList({ supported: false });
        return {
          success: false,
          unsupported: true,
          provider: providerLabel,
          items: [],
          error: 'This client does not support toolbar browsing yet.'
        };
      }

      const page = Math.max(1, Number(msg.page) || 1);
      const pageSize = Math.min(25, Math.max(1, Number(msg.pageSize) || 8));
      const creds = settings.credentials?.[mode] || {};
      return await withTimeout(
        provider.listClientItems(creds, { page, pageSize, provider: providerLabel }),
        15000,
        { success: false, provider: providerLabel, items: [], error: 'Could not load client items.' }
      );
    }

    case 'open-client-item': {
      const settings = mergeSettingsDefaults((await MAGNETAR_API.storage.sync.get(['magnetar'])).magnetar || {});
      const mode = msg.mode || settings.mode || 'local';
      const provider = providers[mode];
      if (!provider) return { success: false, error: 'Open unavailable.' };
      if (!hasUsableProviderCredentials(settings, mode)) {
        return { success: false, error: 'Set up a client first.' };
      }

      if (mode === 'alldebrid') {
        if (typeof provider.resolveClientDownload !== 'function') {
          return { success: false, error: 'Open unavailable.' };
        }
        const resolved = await withTimeout(
          provider.resolveClientDownload(settings.credentials?.[mode] || {}, msg.item || {}),
          15000,
          { success: false, error: 'Could not open AllDebrid item.' }
        );
        if (resolved?.success && resolved.action === 'alldebrid-service-open') {
          const taskId = await createAllDebridOpenTask(resolved);
          if (!taskId) return { success: false, error: 'Could not get download links.' };
          const createProps = {
            url: `https://alldebrid.com/service/#magnetar-ad-open=${encodeURIComponent(taskId)}`,
            active: true
          };
          if (tabId) createProps.openerTabId = tabId;
          await openExtensionTab(createProps, 'alldebrid-open');
          return { success: true };
        }
        return { success: false, error: resolved?.error || 'Open unavailable.' };
      }

      const target = getProviderOpenTarget(settings, mode);
      if (!target?.url) return { success: false, error: 'Open unavailable.' };
      let url;
      try {
        url = new URL(target.url);
      } catch (e) {
        return { success: false, error: 'Open unavailable.' };
      }
      if (!/^https?:$/.test(url.protocol)) return { success: false, error: 'Open unavailable.' };
      const createProps = { url: url.href };
      if (tabId) createProps.openerTabId = tabId;
      await openExtensionTab(createProps, `client-open:${mode}`);
      return { success: true };
    }

    case 'download-client-item': {
      const settings = mergeSettingsDefaults((await MAGNETAR_API.storage.sync.get(['magnetar'])).magnetar || {});
      const mode = msg.mode || settings.mode || 'local';
      const provider = providers[mode];
      if (!provider) return { success: false, error: 'Download unavailable.' };
      if (!hasUsableProviderCredentials(settings, mode)) {
        return { success: false, error: 'Set up a client first.' };
      }

      const creds = settings.credentials?.[mode] || {};
      const item = msg.item || {};
      let resolved = null;
      if (typeof provider.resolveClientDownload === 'function') {
        resolved = await withTimeout(
          provider.resolveClientDownload(creds, item),
          15000,
          { success: false, error: 'Could not get download link.' }
        );
      } else if (item.link) {
        resolved = { success: true, url: String(item.link || '').trim() };
      } else {
        resolved = { success: false, error: 'Download unavailable.' };
      }

      if (!resolved?.success || !resolved.url) {
        if (resolved?.success && resolved.action === 'alldebrid-service-open') {
          const taskId = await createAllDebridOpenTask(resolved);
          if (!taskId) return { success: false, error: 'Could not get download links.' };
          const createProps = {
            url: `https://alldebrid.com/service/#magnetar-ad-open=${encodeURIComponent(taskId)}`,
            active: true
          };
          if (tabId) createProps.openerTabId = tabId;
          await openExtensionTab(createProps, 'alldebrid-download-open');
          return { success: true };
        }
        return { success: false, error: resolved?.error || 'Download unavailable.' };
      }

      let url;
      try {
        url = new URL(resolved.url);
      } catch (e) {
        return { success: false, error: 'Download unavailable.' };
      }
      if (!/^https?:$/.test(url.protocol)) {
        return { success: false, error: 'Download unavailable.' };
      }

      await openExtensionTab({ url: url.href }, `client-download:${mode}`);
      return { success: true };
    }

    case 'consume-alldebrid-open-task': {
      const task = await consumeAllDebridOpenTask(msg.taskId);
      if (!task) return { success: false, error: 'Could not open AllDebrid item.' };
      return { success: true, task };
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
      return data.shield || MagnetarShield.getDefaultShield();
    }

    case 'shield-toggle': {
      const shield = await MagnetarShield.toggle(msg.enabled);
      setShieldStateCache(shield);
      if (shield.enabled !== false) await closeExistingShieldBlockedTabs('toggle');
      return shield;
    }

    case 'shield-block': {
      const shield = await MagnetarShield.blockDomain(msg.domain);
      setShieldStateCache(shield);
      if (shield.enabled !== false) await closeExistingShieldBlockedTabs('manualBlock');
      return shield;
    }

    case 'shield-unblock': {
      const shield = await MagnetarShield.unblockDomain(msg.domain);
      setShieldStateCache(shield);
      return shield;
    }

    case 'shield-recommended-install':
    case 'shield-recommended-update': {
      try {
        const payload = await fetchRecommendedShieldList();
        const shield = await MagnetarShield.installRecommendedList(payload, MagnetarShield.RECOMMENDED_LIST_URL);
        setShieldStateCache(shield);
        if (shield.enabled !== false) await closeExistingShieldBlockedTabs('recommendedList');
        return { ok: true, shield, message: 'Recommended list updated.' };
      } catch (e) {
        return { ok: false, error: e?.message || 'Could not fetch recommended list.' };
      }
    }

    case 'shield-recommended-remove': {
      const shield = await MagnetarShield.removeRecommendedList();
      setShieldStateCache(shield);
      return { ok: true, shield, message: 'Recommended list removed.' };
    }

    case 'shield-recommended-remove-domain': {
      const shield = await MagnetarShield.removeRecommendedDomain(msg.domain);
      setShieldStateCache(shield);
      return { ok: true, shield, message: 'Domain removed from recommended list.' };
    }

    case 'get-detection': {
      if (msg.tabId) {
        const data = await sessionStore.get([`tab-${msg.tabId}`]);
        return data[`tab-${msg.tabId}`] || null;
      }
      return null;
    }

    case 'test-custom-selector': {
      const domain = String(msg.domain || '').trim();
      const selector = String(msg.selector || '').trim();
      if (!domain || !selector) return { ok: false, error: 'Enter a domain pattern and selector first.' };
      const tabs = await MAGNETAR_API.tabs.query({ active: true, currentWindow: true });
      const tab = tabs?.[0];
      if (!tab?.id || !tab.url || !/^https?:/i.test(tab.url)) {
        return { ok: false, error: 'Open a website tab to test this selector.' };
      }
      const host = new URL(tab.url).hostname;
      if (!domainPatternMatches(host, domain)) {
        return { ok: false, error: `Current tab (${host}) does not match ${domain}.` };
      }
      try {
        let testResult = null;
        if (MAGNETAR_API.scripting?.executeScript) {
          const [result] = await MAGNETAR_API.scripting.executeScript({
            target: { tabId: tab.id },
            func: testMagnetarCustomSelectorInPage,
            args: [selector]
          });
          testResult = result?.result || null;
        } else if (MAGNETAR_API.tabs?.executeScript) {
          const code = `(${testMagnetarCustomSelectorInPage.toString()})(${JSON.stringify(selector)});`;
          const [result] = await MAGNETAR_API.tabs.executeScript(tab.id, { code });
          testResult = result || null;
        } else {
          return { ok: false, error: 'Selector testing is not supported in this browser.' };
        }
        return { ok: true, ...(testResult || { count: 0, preview: '', valid: false }) };
      } catch (e) {
        return { ok: false, error: 'Could not run selector on the current tab.' };
      }
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

    case 'open-external-url': {
      const allowedUrls = new Set([
        'https://arrcee.com/magnetar-mobile'
      ]);
      if (!allowedUrls.has(msg.url)) {
        return { ok: false, error: 'URL not allowed' };
      }
      await openExtensionTab({ url: msg.url }, 'external-link');
      return { ok: true };
    }

    default:
      return { error: 'Unknown message type: ' + msg.type };
  }
}
