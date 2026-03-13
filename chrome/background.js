/**
 * Magnetar — Background Service Worker
 * 
 * Coordinates: icon states, context menus, Shield, provider API calls,
 * and message passing between content scripts and popup.
 */

importScripts(
  'lib/shield.js',
  'lib/providers/local.js',
  'lib/providers/realdebrid.js',
  'lib/providers/rdtclient.js',
  'lib/providers/torbox.js'
);

// ── Provider Registry ────────────────────────────────────────────────────

const providers = {
  local: ProviderLocal,
  realdebrid: ProviderRealDebrid,
  rdtclient: ProviderRdtClient,
  torbox: ProviderTorBox
};

// ── Init ─────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  // First install — open settings
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
  }

  // Set up context menus
  chrome.contextMenus.create({
    id: 'magnetar-block',
    title: 'Block this site with Magnetar',
    contexts: ['page']
  });

  chrome.contextMenus.create({
    id: 'magnetar-unblock',
    title: 'Unblock this site',
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
  }
});

// Also init Shield on service worker startup (not just install)
MagnetarShield.init();


// ── Context Menu Handling ────────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.url) return;

  try {
    const url = new URL(tab.url);
    const domain = url.hostname.replace(/^www\./, '');

    if (info.menuItemId === 'magnetar-block') {
      await MagnetarShield.blockDomain(domain);
      // Close the tab since the site is now blocked
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
  if (details.frameId !== 0) return; // Only main frame

  try {
    const url = new URL(details.url);
    const domain = url.hostname.replace(/^www\./, '');
    const blocked = await MagnetarShield.isBlocked(domain);

    if (blocked) {
      chrome.tabs.remove(details.tabId).catch(() => {});
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

// Reset icon when navigating to a new page
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    setIconState(tabId, 'default');
  }
});


// ── Message Handling ─────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse).catch(err => {
    console.error('Magnetar: message handler error', err);
    sendResponse({ error: err.message });
  });
  return true; // Keep channel open for async response
});

async function handleMessage(msg, sender) {
  const tabId = sender.tab?.id;

  switch (msg.type) {

    // ── Content script reports detection result ──
    case 'detection-result': {
      if (!tabId) return;

      if (msg.data?.hash && !msg.data?.lowConfidence) {
        setIconState(tabId, 'active');
      } else if (msg.data?.noHash || msg.data?.lowConfidence) {
        setIconState(tabId, 'dimmed');
      } else {
        setIconState(tabId, 'default');
      }

      // Store detection result for popup
      await chrome.storage.session.set({ [`tab-${tabId}`]: msg.data || null });
      return { ok: true };
    }

    // ── Get current settings ──
    case 'get-settings': {
      const data = await chrome.storage.sync.get(['magnetar']);
      return data.magnetar || {};
    }

    // ── Save settings ──
    case 'save-settings': {
      await chrome.storage.sync.set({ magnetar: msg.data });
      return { ok: true };
    }

    // ── Send magnet to provider ──
    case 'send-magnet': {
      const settings = (await chrome.storage.sync.get(['magnetar'])).magnetar || {};
      const mode = settings.mode || 'local';
      const provider = providers[mode];
      if (!provider) return { success: false, error: 'Unknown mode: ' + mode };

      const creds = settings.credentials?.[mode] || {};

      // For local mode, we need the content script to handle the magnet: URI
      if (mode === 'local') {
        return { success: true, action: 'open-magnet', magnetUri: msg.magnetUri };
      }

      const result = await provider.sendMagnet(msg.magnetUri, creds, {
        category: msg.category || ''
      });
      return result;
    }

    // ── Check cache ──
    case 'check-cache': {
      const settings = (await chrome.storage.sync.get(['magnetar'])).magnetar || {};
      const mode = settings.mode || 'local';
      const provider = providers[mode];
      if (!provider) return { status: 'unknown' };

      const creds = settings.credentials?.[mode] || {};
      const status = await provider.checkCache(msg.hash, creds);
      return { status };
    }

    // ── Validate credentials ──
    case 'validate-credentials': {
      const provider = providers[msg.mode];
      if (!provider) return { valid: false, error: 'Unknown mode' };
      return await provider.validateCredentials(msg.credentials);
    }

    // ── Shield operations ──
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

    // ── Get detection result for popup ──
    case 'get-detection': {
      if (msg.tabId) {
        const data = await chrome.storage.session.get([`tab-${msg.tabId}`]);
        return data[`tab-${msg.tabId}`] || null;
      }
      return null;
    }

    default:
      return { error: 'Unknown message type: ' + msg.type };
  }
}
