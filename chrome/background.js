/**
 * Magnetar — Background Service Worker
 * 
 * Coordinates: icon states, context menus, Shield, provider API calls,
 * download history, batch sends,
 * and message passing between content scripts and popup.
 */

importScripts(
  'lib/shield.js',
  'lib/providers/local.js',
  'lib/providers/realdebrid.js',
  'lib/providers/rdtclient.js',
  'lib/providers/torbox.js',
  'lib/providers/premiumize.js',
  'lib/providers/alldebrid.js'
);

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
        // Open magnet in default client
        chrome.tabs.update(tab.id, { url: info.linkUrl });
      } else if (provider) {
        const creds = settings.credentials?.[mode] || {};
        const result = await provider.sendMagnet(info.linkUrl, creds, { category: '' });
        if (result?.success) {
          // Extract hash for history
          const hashMatch = info.linkUrl.match(/btih:([a-fA-F0-9]{40}|[a-fA-F0-9]{64}|[A-Z2-7]{32})/i);
          const hash = hashMatch ? hashMatch[1].toLowerCase() : '';
          const nameMatch = info.linkUrl.match(/[?&]dn=([^&]+)/);
          const name = nameMatch ? decodeURIComponent(nameMatch[1].replace(/\+/g, ' ')) : '';
          await recordHistory(hash, name, mode, '', tab.url);
          await incrementSendCount();
        }
      }
      return;
    }

    const url = new URL(tab.url);
    const domain = url.hostname.replace(/^www\./, '');

    if (info.menuItemId === 'magnetar-block') {
      await MagnetarShield.blockDomain(domain);
      chrome.tabs.remove(tab.id);
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

function setIconState(tabId, state) {
  const icons = iconStates[state] || iconStates.default;
  chrome.action.setIcon({ tabId, path: icons }).catch(() => {});
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    setIconState(tabId, 'default');
  }
});


// ── Download History ────────────────────────────────────────────────────

async function recordHistory(hash, name, provider, category, pageUrl) {
  const data = await chrome.storage.local.get(['magnetar-history']);
  const history = data['magnetar-history'] || [];

  if (history.some(h => h.hash === hash)) return;

  history.unshift({
    hash,
    name: name || 'Unknown',
    provider,
    category: category || '',
    url: pageUrl || '',
    timestamp: Date.now()
  });

  if (history.length > 500) history.length = 500;
  await chrome.storage.local.set({ 'magnetar-history': history });
}

async function incrementSendCount() {
  const data = await chrome.storage.local.get(['magnetar-send-count']);
  const count = (data['magnetar-send-count'] || 0) + 1;
  await chrome.storage.local.set({ 'magnetar-send-count': count });
  return count;
}


// ── Message Handling ─────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse).catch(err => {
    console.error('Magnetar: message handler error', err);
    sendResponse({ error: err.message });
  });
  return true;
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

      await chrome.storage.session.set({ [`tab-${tabId}`]: msg.data || null });
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
        await recordHistory(
          msg.hash || '',
          msg.name || '',
          mode,
          msg.category || '',
          msg.pageUrl || ''
        );
        await incrementSendCount();
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
          await incrementSendCount();
          continue;
        }

        try {
          const res = await provider.sendMagnet(item.magnetUri, creds, {
            category: item.category || ''
          });
          results.push({ hash: item.hash, ...res });

          if (res?.success) {
            await recordHistory(item.hash, item.name, mode, item.category || '', msg.pageUrl || '');
            await incrementSendCount();
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

      const creds = settings.credentials?.[mode] || {};
      const status = await provider.checkCache(msg.hash, creds);
      return { status };
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
        const data = await chrome.storage.session.get([`tab-${msg.tabId}`]);
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
      return { theme: data.magnetar?.preferences?.theme || 'dark' };
    }

    case 'set-theme': {
      const s = (await chrome.storage.sync.get(['magnetar'])).magnetar || {};
      s.preferences = s.preferences || {};
      s.preferences.theme = msg.theme;
      await chrome.storage.sync.set({ magnetar: s });
      return { ok: true };
    }

    default:
      return { error: 'Unknown message type: ' + msg.type };
  }
}
