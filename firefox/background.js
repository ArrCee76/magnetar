/**
 * Magnetar — Firefox Background Script
 * 
 * Same logic as Chrome but adapted for MV2:
 * - Uses browser.* instead of chrome.* (Firefox polyfills chrome.* but prefer browser.*)
 * - Shield uses webRequest.onBeforeRequest instead of declarativeNetRequest
 * - Scripts loaded via manifest background.scripts, not importScripts
 */

// ── Provider Registry ────────────────────────────────────────────────────

const providers = {
  local: ProviderLocal,
  realdebrid: ProviderRealDebrid,
  rdtclient: ProviderRdtClient,
  torbox: ProviderTorBox
};

// ── Shield: Firefox uses webRequest blocking ─────────────────────────────

const FirefoxShield = {
  blockedDomains: new Set(),
  enabled: true,

  async init() {
    const data = await browser.storage.local.get(['shield']);
    const shield = data.shield || {
      enabled: true,
      blockedDomains: [...MagnetarShield.DEFAULT_BLOCKLIST]
    };

    if (!data.shield) {
      await browser.storage.local.set({ shield });
    }

    this.enabled = shield.enabled;
    this.blockedDomains = new Set(shield.blockedDomains);
    this.updateListener();
    return shield;
  },

  updateListener() {
    // Remove existing listener if any
    if (browser.webRequest.onBeforeRequest.hasListener(this.blockHandler)) {
      browser.webRequest.onBeforeRequest.removeListener(this.blockHandler);
    }

    if (this.enabled && this.blockedDomains.size > 0) {
      browser.webRequest.onBeforeRequest.addListener(
        this.blockHandler,
        { urls: ["<all_urls>"] },
        ["blocking"]
      );
    }
  },

  blockHandler(details) {
    try {
      const url = new URL(details.url);
      const domain = url.hostname.replace(/^www\./, '');

      for (const blocked of FirefoxShield.blockedDomains) {
        if (domain === blocked || domain.endsWith('.' + blocked)) {
          // Close the tab if it's a main frame navigation
          if (details.type === 'main_frame' && details.tabId > 0) {
            browser.tabs.remove(details.tabId).catch(() => {});
          }
          return { cancel: true };
        }
      }
    } catch (e) {}
    return {};
  },

  async reload() {
    const data = await browser.storage.local.get(['shield']);
    const shield = data.shield || { enabled: true, blockedDomains: [] };
    this.enabled = shield.enabled;
    this.blockedDomains = new Set(shield.blockedDomains);
    this.updateListener();
  }
};

// Override MagnetarShield methods for Firefox
MagnetarShield.applyRules = async function(domains) {
  FirefoxShield.blockedDomains = new Set(domains);
  FirefoxShield.updateListener();
};

MagnetarShield.clearRules = async function() {
  FirefoxShield.blockedDomains = new Set();
  FirefoxShield.updateListener();
};

// ── Init ─────────────────────────────────────────────────────────────────

browser.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    browser.tabs.create({ url: browser.runtime.getURL('options.html') });
  }

  browser.contextMenus.create({
    id: 'magnetar-block',
    title: 'Block this site with Magnetar',
    contexts: ['page']
  });

  browser.contextMenus.create({
    id: 'magnetar-unblock',
    title: 'Unblock this site',
    contexts: ['page']
  });

  await FirefoxShield.init();

  const data = await browser.storage.sync.get(['magnetar']);
  if (!data.magnetar) {
    await browser.storage.sync.set({
      magnetar: {
        mode: 'local',
        credentials: {},
        customSites: [],
        preferences: {
          bannerPosition: 'top',
          defaultTrackers: [],
          categoryMap: {
            audiobooks: 'audiobooks', music: 'music', video: 'video',
            ebooks: 'ebooks', software: 'software', games: 'games', general: ''
          }
        }
      }
    });
  }
});

FirefoxShield.init();


// ── Context Menu ─────────────────────────────────────────────────────────

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.url) return;
  try {
    const url = new URL(tab.url);
    const domain = url.hostname.replace(/^www\./, '');

    if (info.menuItemId === 'magnetar-block') {
      await MagnetarShield.blockDomain(domain);
      await FirefoxShield.reload();
      browser.tabs.remove(tab.id).catch(() => {});
    }
    if (info.menuItemId === 'magnetar-unblock') {
      await MagnetarShield.unblockDomain(domain);
      await FirefoxShield.reload();
    }
  } catch (e) {
    console.error('Magnetar: context menu error', e);
  }
});


// ── Icon State ───────────────────────────────────────────────────────────

const iconStates = {
  default: { '16': 'icons/icon16.png', '48': 'icons/icon48.png', '128': 'icons/icon128.png' },
  dimmed: { '16': 'icons/icon16-dimmed.png', '48': 'icons/icon48-dimmed.png', '128': 'icons/icon128-dimmed.png' },
  active: { '16': 'icons/icon16-active.png', '48': 'icons/icon48-active.png', '128': 'icons/icon128-active.png' }
};

// Tab detection result storage (Firefox doesn't have chrome.storage.session)
const tabDetections = new Map();

function setIconState(tabId, state) {
  const icons = iconStates[state] || iconStates.default;
  browser.browserAction.setIcon({ tabId, path: icons }).catch(() => {});
}

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    setIconState(tabId, 'default');
    tabDetections.delete(tabId);
  }
});

browser.tabs.onRemoved.addListener((tabId) => {
  tabDetections.delete(tabId);
});


// ── Message Handling ─────────────────────────────────────────────────────

browser.runtime.onMessage.addListener((msg, sender) => {
  return handleMessage(msg, sender);
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
      tabDetections.set(tabId, msg.data || null);
      return { ok: true };
    }

    case 'get-settings': {
      const data = await browser.storage.sync.get(['magnetar']);
      return data.magnetar || {};
    }

    case 'save-settings': {
      await browser.storage.sync.set({ magnetar: msg.data });
      return { ok: true };
    }

    case 'send-magnet': {
      const settings = (await browser.storage.sync.get(['magnetar'])).magnetar || {};
      const mode = settings.mode || 'local';
      const provider = providers[mode];
      if (!provider) return { success: false, error: 'Unknown mode: ' + mode };
      const creds = settings.credentials?.[mode] || {};
      if (mode === 'local') {
        return { success: true, action: 'open-magnet', magnetUri: msg.magnetUri };
      }
      return await provider.sendMagnet(msg.magnetUri, creds, { category: msg.category || '' });
    }

    case 'check-cache': {
      const settings = (await browser.storage.sync.get(['magnetar'])).magnetar || {};
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
      const data = await browser.storage.local.get(['shield']);
      return data.shield || { enabled: true, blockedDomains: [] };
    }

    case 'shield-toggle': {
      const result = await MagnetarShield.toggle(msg.enabled);
      await FirefoxShield.reload();
      return result;
    }

    case 'shield-block': {
      const result = await MagnetarShield.blockDomain(msg.domain);
      await FirefoxShield.reload();
      return result;
    }

    case 'shield-unblock': {
      const result = await MagnetarShield.unblockDomain(msg.domain);
      await FirefoxShield.reload();
      return result;
    }

    case 'get-detection': {
      if (msg.tabId) return tabDetections.get(msg.tabId) || null;
      return null;
    }

    default:
      return { error: 'Unknown message type: ' + msg.type };
  }
}
