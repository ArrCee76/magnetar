/**
 * Magnetar — Content Script
 * 
 * Runs on every page. Two banner modes + batch panel:
 * 1. Full banner — name, cache, Send, Share, Copy Magnet, Copy Hash, ✕
 * 2. Compact banner — Send + ✕ only
 * 3. Batch mode — checkbox table for multi-hash pages
 */

(async () => {
  if (!document.body) return;
  if (document.contentType && !document.contentType.includes('html')) return;
  if (window !== window.top) return;

  // ── i18n helper ──
  const t = (key, ...subs) => {
    const msg = MAGNETAR_API.i18n.getMessage(key, subs);
    return msg || key;
  };

  function safeRuntimeMessage(message, fallback) {
    try {
      return MAGNETAR_API.runtime.sendMessage(message).catch(() => fallback);
    } catch (e) {
      return Promise.resolve(fallback);
    }
  }

  function normaliseInterfaceMode(value) {
    return value === 'advanced' ? 'advanced' : 'standard';
  }

  function normaliseDomain(domain) {
    domain = String(domain || '').trim().toLowerCase().replace(/^www\./, '');
    if (!domain || /[\s/?#:*\\]/.test(domain)) return '';
    if (domain.length > 253 || !domain.includes('.')) return '';
    const labels = domain.split('.');
    const valid = labels.every(label =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[a-z0-9-]+$/.test(label) &&
      !label.startsWith('-') &&
      !label.endsWith('-')
    );
    return valid ? domain : '';
  }

  function isIgnoredDomain(domain, ignoredDomains) {
    domain = normaliseDomain(domain);
    if (!domain) return false;
    return (ignoredDomains || []).some(d => {
      d = normaliseDomain(d);
      return d && (domain === d || domain.endsWith('.' + d));
    });
  }

  // Browser detection. After webextension-polyfill, `browser` exists on both
  // Chromium and Firefox, but `browser.runtime.getBrowserInfo` is gecko-only.
  const IS_FIREFOX = typeof browser !== 'undefined'
    && typeof browser.runtime?.getBrowserInfo === 'function';
  const STORE_URL = IS_FIREFOX
    ? 'https://addons.mozilla.org/firefox/addon/magnetar/'
    : 'https://chromewebstore.google.com/detail/magnetar/cllbehlfiahgijdojkopgnnmcoenhlla';
  const COFFEE_URL = 'https://buymeacoffee.com/arrcee76';

  // ── Get settings ──
  let settings;
  try {
    settings = await MAGNETAR_API.runtime.sendMessage({ type: 'get-settings' });
  } catch (e) {
    return;
  }

  const customSites = settings?.customSites || [];
  const bannerEnabled = settings?.preferences?.bannerEnabled !== false;
  const bannerStyle = settings?.preferences?.bannerStyle || 'full'; // 'full' or 'compact'
  let batchMode = settings?.preferences?.batchMode === true;
  let batchMax = settings?.preferences?.batchMax || 25;
  const bannerPosition = settings?.preferences?.bannerPosition || 'top';
  const mode = settings?.mode || 'local';
  let theme = settings?.preferences?.theme || 'dark';
  let interfaceMode = normaliseInterfaceMode(settings?.preferences?.interfaceMode);
  let isAdvancedMode = interfaceMode === 'advanced';
  let pinBanner = (await safeRuntimeMessage({ type: 'get-tab-pin' }, { pinned: false }))?.pinned === true;
  const currentDomain = normaliseDomain(window.location.hostname);
  const siteIgnored = isIgnoredDomain(currentDomain, settings?.ignoredWebsites || []);
  let currentQuickSendTarget = mode;
  let quickSendProviders = [];
  let quickSendTargets = [];
  await reloadQuickSendTargets();
  let lastSentProvider = null;
  let bannerAutoHideTimer = null;
  let bannerInteractedAfterSuccess = false;

  // ── Run detection ──
  const result = siteIgnored ? null : MagnetarDetector.detect(customSites);

  const allMagnets = siteIgnored ? [] : MagnetarDetector.detectAll();

  const category = siteIgnored ? null : MagnetarCategories.detect();
  if (result) result.category = category;

  // Report to background
  safeRuntimeMessage({ type: 'detection-result', data: result });

  MAGNETAR_API.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'open-toolbar') return;
    return Promise.resolve(openToolbarFromPopup());
  });

  if (siteIgnored) return;

  // ── Batch mode: show panel if multiple magnets found ──
  const batchMagnets = getBatchMagnets();
  if (isBatchModeActive() && batchMagnets.length > 0) {
    const limited = batchMagnets.slice(0, batchMax);
    injectBatchPanel(limited, batchMagnets.length, mode);
    return;
  }

  // ── Single hash logic ──
  if (!result || !result.hash || result.lowConfidence) return;
  if (!bannerEnabled) return;
  if (window._magnetarDismissed && window._magnetarDismissed.includes(result.hash)) return;

  // ── Duplicate detection ──
  let alreadySent = false;
  try {
    const histCheck = await safeRuntimeMessage({ type: 'check-single-history', hash: result.hash }, null);
    alreadySent = histCheck?.inHistory === true;
  } catch (e) {}
  if (result) result.alreadySent = alreadySent;

  // ── Cache check ──
  let cacheStatus = 'unknown';
  if (mode !== 'local') {
    safeRuntimeMessage({ type: 'check-cache', hash: result.hash })
      .then(res => {
        if (res?.status) {
          cacheStatus = res.status;
          updateCacheBadge(cacheStatus);
        }
      })
      .catch(() => {});
  }

  // ── Inject banner ──
  injectBanner(result, mode, category);


  // ════════════════════════════════════════════════════════════════════════
  // BANNER (Full + Compact modes)
  // ════════════════════════════════════════════════════════════════════════

  function injectBanner(detection, mode, category) {
    document.getElementById('magnetar-banner')?.remove();

    const banner = document.createElement('div');
    banner.id = 'magnetar-banner';
    applyInterfaceMode(banner);
    if (bannerPosition === 'bottom') banner.classList.add('magnetar-bottom');
    if (theme === 'dark') banner.classList.add('magnetar-theme-dark');
    const isManualShell = detection?.manualOnly === true;
    banner.classList.toggle('magnetar-manual-shell', isManualShell);
    banner.innerHTML = buildBannerHTML(detection, mode);
    document.body.appendChild(banner);
    prepareTitleReveal(banner);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        banner.classList.add('magnetar-visible');
      });
    });

    if (!isManualShell) {
      banner.querySelector('#magnetar-send')?.addEventListener('click', (e) => {
        const retryProvider = e.currentTarget.dataset.retryProvider || mode;
        handleSend(detection, category, retryProvider);
      });
    }
    banner.querySelector('#magnetar-quick-send-toggle')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isManualShell) {
        showProviderTargetMenu(e.currentTarget, getQuickSendTargetOptions(), providerMode => {
          currentQuickSendTarget = providerMode;
          updateQuickSendTargetButtons();
        });
        return;
      }
      handleQuickSendMenu(detection, category, e.currentTarget);
    });
    banner.querySelector('#magnetar-share')?.addEventListener('click', () => handleShare(detection));
    banner.querySelector('#magnetar-open-downloads')?.addEventListener('click', handleOpenDownloadsFolder);
    banner.querySelector('#magnetar-ignore-site')?.addEventListener('click', handleIgnoreCurrentSite);
    banner.querySelector('#magnetar-manual-send-toggle')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleManualSendMenu(e.currentTarget);
    });
    banner.querySelector('#magnetar-pin-banner')?.addEventListener('click', handlePinBannerToggle);
    banner.querySelector('#magnetar-copy-magnet')?.addEventListener('click', () => handleCopy(detection.magnetUri, t('magnetCopied')));
    banner.querySelector('#magnetar-copy-hash')?.addEventListener('click', () => handleCopy(detection.hash, t('hashCopied')));
    banner.querySelector('#magnetar-expand')?.addEventListener('click', () => toggleBannerExpand(detection, mode));
    banner.querySelector('#magnetar-dismiss')?.addEventListener('click', () => dismissBanner());
    banner.querySelector('#magnetar-banner-settings')?.addEventListener('click', (e) => {
      e.preventDefault();
      safeRuntimeMessage({ type: 'open-options' });
    });
    banner.querySelector('#magnetar-banner-batch-mode')?.addEventListener('change', (e) => {
      saveBatchModePreference(e.target.checked);
    });
    banner.addEventListener('pointerdown', () => {
      if (banner.classList.contains('magnetar-success')) bannerInteractedAfterSuccess = true;
    });
    banner.addEventListener('focusin', () => {
      if (banner.classList.contains('magnetar-success')) bannerInteractedAfterSuccess = true;
    });
    showOpenProviderAction(currentQuickSendTarget, banner);

    // Save-for-later button
    const saveBtn = banner.querySelector('#magnetar-save');
    if (saveBtn && !isManualShell) {
      // Initial state: is this torrent already in the saved queue?
      safeRuntimeMessage({ type: 'check-saved', hash: detection.hash })
        .then(res => {
          if (res?.isSaved) markSaveButtonSaved(saveBtn);
        })
        .catch(() => {});

      saveBtn.addEventListener('click', async () => {
        if (saveBtn.classList.contains('magnetar-btn-saved')) return;
        try {
          await MAGNETAR_API.runtime.sendMessage({
            type: 'save-torrent',
            hash: detection.hash,
            name: detection.name,
            magnetUri: detection.magnetUri,
            category,
            sourceUrl: window.location.href
          });
          markSaveButtonSaved(saveBtn);
          showToast('Saved for later');
          // If the expanded panel is open, refresh its saved list
          if (expandedBuilt) {
            await populateExpanded(detection, mode);
          }
        } catch (e) {}
      });
    }

    applyTheme(theme);

    banner.querySelector('#magnetar-theme')?.addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      applyTheme(theme);
      safeRuntimeMessage({ type: 'set-theme', theme });
    });
  }

  function getBatchMagnets() {
    if (allMagnets.length > 0) return allMagnets;
    if (result && result.hash && !result.lowConfidence) return [result];
    return [];
  }

  function canShowSingleBanner() {
    if (!result || !result.hash || result.lowConfidence) return false;
    if (!bannerEnabled) return false;
    return !(window._magnetarDismissed && window._magnetarDismissed.includes(result.hash));
  }

  function hasValidSingleDetection() {
    return !!(result && result.hash && !result.lowConfidence);
  }

  function isBatchModeActive() {
    return isAdvancedMode && batchMode;
  }

  function renderCurrentMode(options = {}) {
    const force = options.force === true;
    if (isBatchModeActive()) {
      const batchItems = getBatchMagnets();
      if (batchItems.length > 0) {
        document.getElementById('magnetar-banner')?.remove();
        injectBatchPanel(batchItems.slice(0, batchMax), batchItems.length, mode);
        return;
      }
    }

    document.getElementById('magnetar-batch')?.remove();
    if (force ? hasValidSingleDetection() : canShowSingleBanner()) {
      injectBanner(result, mode, category);
    }
  }

  function openToolbarFromPopup() {
    if (isBatchModeActive() && getBatchMagnets().length > 0) {
      renderCurrentMode({ force: true });
      return { ok: true };
    }
    if (!hasValidSingleDetection()) {
      document.getElementById('magnetar-batch')?.remove();
      injectBanner(createManualShellDetection(), mode, category);
      return { ok: true, manual: true };
    }
    if (window._magnetarDismissed) {
      window._magnetarDismissed = window._magnetarDismissed.filter(hash => hash !== result.hash);
    }
    renderCurrentMode({ force: true });
    return { ok: true };
  }

  function createManualShellDetection() {
    return {
      manualOnly: true,
      name: isAdvancedMode
        ? 'No torrent detected. Paste a magnet or hash manually.'
        : 'No torrent detected. Enable Advanced mode to paste manually.'
    };
  }

  function markSaveButtonSaved(btn) {
    btn.classList.add('magnetar-btn-saved');
    const label = btn.querySelector('.magnetar-save-label');
    if (label) label.textContent = 'Saved';
  }

  // Apply theme to whichever banner / batch panel is live right now.
  function applyTheme(t) {
    const banner = document.getElementById('magnetar-banner');
    const batch  = document.getElementById('magnetar-batch');
    banner?.classList.toggle('magnetar-theme-dark', t === 'dark');
    batch?.classList.toggle('magnetar-theme-dark', t === 'dark');
    const iconDark  = banner?.querySelector('.magnetar-theme-icon-dark');
    const iconLight = banner?.querySelector('.magnetar-theme-icon-light');
    if (iconDark)  iconDark.style.display  = t === 'dark' ? 'none' : '';
    if (iconLight) iconLight.style.display = t === 'dark' ? '' : 'none';
  }

  function applyInterfaceMode(root) {
    if (!root) return;
    root.dataset.interfaceMode = interfaceMode;
    root.classList.toggle('magnetar-advanced-mode', isAdvancedMode);
  }

  function prepareTitleReveal(root = document) {
    requestAnimationFrame(() => {
      root.querySelectorAll('.magnetar-name, .magnetar-batch-title').forEach(el => {
        const text = el.querySelector('.magnetar-name-text') || el;
        el.classList.toggle('magnetar-title-overflow', text.scrollWidth > el.clientWidth + 2);
      });
    });
  }

  function applyInterfaceModeToLiveUi() {
    applyInterfaceMode(document.getElementById('magnetar-banner'));
    applyInterfaceMode(document.getElementById('magnetar-batch'));
  }

  function updateBatchModeToggle() {
    document.querySelectorAll('.magnetar-batch-mode-input').forEach(input => {
      input.checked = batchMode;
    });
  }

  function updatePinBannerToggle() {
    document.querySelectorAll('.magnetar-pin-banner').forEach(btn => {
      btn.classList.toggle('magnetar-pin-banner-active', pinBanner);
      btn.setAttribute('aria-pressed', String(pinBanner));
      btn.title = 'Pin to keep toolbar open after send';
      btn.setAttribute('aria-label', btn.title);
    });
  }

  function getProviderName(providerMode) {
    const names = {
      local: 'Local torrent client',
      realdebrid: 'Real-Debrid',
      rdtclient: 'RDT Client',
      torbox: 'TorBox',
      premiumize: 'Premiumize',
      alldebrid: 'AllDebrid'
    };
    return names[providerMode] || providerMode;
  }

  function getSendLabel(providerMode) {
    return `Send: ${getCompactProviderName(providerMode)}`;
  }

  function getSendingLabel() {
    return 'Sending...';
  }

  function getSentLabel(providerMode) {
    return `Sent: ${getCompactProviderName(providerMode)}`;
  }

  function getCompactProviderName(providerMode) {
    const names = {
      local: 'Locally',
      realdebrid: 'R-Debrid',
      rdtclient: 'RDT',
      torbox: 'TorBox',
      premiumize: 'Premium',
      alldebrid: 'A-Debrid'
    };
    return names[providerMode] || getProviderName(providerMode);
  }

  function getCurrentQuickSendCompactLabel() {
    return getCompactProviderName(currentQuickSendTarget);
  }

  function getCurrentToolbarSendLabel() {
    return `Send: ${getCurrentQuickSendCompactLabel()}`;
  }

  function getCurrentQuickSendLabel() {
    const target = quickSendTargets.find(provider => provider.id === currentQuickSendTarget);
    return target?.label || getProviderName(currentQuickSendTarget);
  }

  async function reloadQuickSendTargets() {
    quickSendProviders = [];
    if (isAdvancedMode) {
      const providers = await safeRuntimeMessage({ type: 'get-quick-send-providers' }, []);
      quickSendProviders = Array.isArray(providers) ? providers : [];
    }
    quickSendTargets = [{ id: mode, label: getProviderName(mode), isDefault: true }, ...quickSendProviders];
    if (!quickSendTargets.some(provider => provider.id === currentQuickSendTarget)) {
      currentQuickSendTarget = mode;
    }
  }

  function getQuickSendTargetOptions() {
    return quickSendTargets.filter(provider => provider.id !== currentQuickSendTarget);
  }

  function getPostSendQuickSendProviders() {
    return quickSendProviders.filter(provider => provider.id !== lastSentProvider);
  }

  function updateQuickSendTargetButtons() {
    const label = getCurrentToolbarSendLabel();
    document.querySelectorAll('.magnetar-panel-send-target-label').forEach(el => {
      el.textContent = label;
    });
    const batchLabel = document.querySelector('#magnetar-batch-send .magnetar-btn-label');
    if (batchLabel) batchLabel.textContent = label;
    document.querySelectorAll('[data-detection-detail="target"]').forEach(el => {
      const target = getCurrentQuickSendLabel();
      el.textContent = target;
      el.title = target;
    });
    const banner = document.getElementById('magnetar-banner');
    if (banner) showOpenProviderAction(currentQuickSendTarget, banner);
  }

  async function getProviderOpenTarget(providerMode) {
    const target = await safeRuntimeMessage({ type: 'get-provider-open-target', mode: providerMode }, null);
    if (!target?.url || !target?.label) return null;
    return target;
  }

  function ensureSentStatus(root) {
    const statusGroup = root.querySelector('.magnetar-status-group');
    if (!statusGroup || statusGroup.querySelector('.magnetar-already-sent')) return;
    const sent = document.createElement('span');
    sent.className = 'magnetar-already-sent';
    sent.textContent = t('batchSentBadge');
    const expand = statusGroup.querySelector('#magnetar-expand');
    statusGroup.insertBefore(sent, expand || null);
  }

  async function showOpenProviderAction(providerMode, root = document) {
    const target = await getProviderOpenTarget(providerMode);
    root.querySelectorAll('.magnetar-open-provider').forEach(btn => btn.remove());
    if (root.id === 'magnetar-banner' && providerMode !== currentQuickSendTarget) return;
    if (!target && root.id !== 'magnetar-banner') return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'magnetar-open-provider';
    if (target) {
      btn.textContent = `Open ${target.label}`;
      btn.addEventListener('click', () => window.open(target.url, '_blank', 'noopener'));
    } else {
      btn.classList.add('magnetar-local-provider-info');
      btn.textContent = providerMode === 'local' && lastSentProvider === 'local' ? 'Sent locally' : 'Local client';
      btn.addEventListener('click', () => showToast('Local sends are handed to your browser or system torrent app.'));
    }

    const toolsRow = root.querySelector('.magnetar-tools-primary') || root.querySelector('.magnetar-tools-row');
    if (toolsRow) {
      toolsRow.prepend(btn);
      return;
    }
    if (root.id === 'magnetar-banner') return;

    const sendStack = root.querySelector('.magnetar-send-stack');
    if (sendStack) {
      sendStack.appendChild(btn);
      return;
    }

    const statusGroup = root.querySelector('.magnetar-status-group');
    if (statusGroup) {
      const expand = statusGroup.querySelector('#magnetar-expand');
      statusGroup.insertBefore(btn, expand || null);
      return;
    }

    const batchStatus = root.querySelector('#magnetar-batch-send-status');
    if (batchStatus) {
      batchStatus.appendChild(btn);
      return;
    }

    root.querySelector('.magnetar-inner-compact')?.appendChild(btn);
  }

  async function saveBatchModePreference(enabled) {
    const previous = batchMode;
    batchMode = enabled === true;
    updateBatchModeToggle();

    try {
      const current = (await MAGNETAR_API.runtime.sendMessage({ type: 'get-settings' })) || {};
      current.preferences = current.preferences || {};
      current.preferences.batchMode = batchMode;
      if (batchMode) current.preferences.bannerEnabled = true;
      await MAGNETAR_API.runtime.sendMessage({ type: 'save-settings', data: current });
      renderCurrentMode();
    } catch (e) {
      batchMode = previous;
      updateBatchModeToggle();
    }
  }

  // Live-sync: follow preference changes made on any other surface (popup, options).
  MAGNETAR_API.storage?.onChanged?.addListener(async (changes, area) => {
    if (area !== 'sync' || !changes.magnetar) return;
    const prefs = changes.magnetar.newValue?.preferences || {};
    const newTheme = changes.magnetar.newValue?.preferences?.theme;
    if (newTheme && newTheme !== theme) {
      theme = newTheme;
      applyTheme(theme);
    }

    const newInterfaceMode = normaliseInterfaceMode(changes.magnetar.newValue?.preferences?.interfaceMode);
    if (newInterfaceMode !== interfaceMode) {
      interfaceMode = newInterfaceMode;
      isAdvancedMode = interfaceMode === 'advanced';
      await reloadQuickSendTargets();
      document.getElementById('magnetar-quick-send-menu')?.remove();
      applyInterfaceModeToLiveUi();
      renderCurrentMode();
    }

    if (Object.prototype.hasOwnProperty.call(prefs, 'batchMode')) {
      const newBatchMode = prefs.batchMode === true;
      if (newBatchMode !== batchMode) {
        batchMode = newBatchMode;
        updateBatchModeToggle();
        renderCurrentMode();
      }
    }
  });

  // ── Expand / collapse (lazy-loaded dashboard panel) ──
  let expandedBuilt = false;

  async function toggleBannerExpand(detection, mode) {
    const banner = document.getElementById('magnetar-banner');
    if (!banner) return;

    const isOpen = banner.classList.contains('magnetar-expanded');
    if (isOpen) {
      banner.classList.remove('magnetar-expanded');
      return;
    }

    const wrap = document.getElementById('magnetar-expanded-section');
    const needsExpandedContent = !expandedBuilt || !wrap?.innerHTML.trim();
    if (needsExpandedContent) {
      try {
        await populateExpanded(detection, mode);
        expandedBuilt = true;
      } catch (e) {
        if (wrap && !wrap.innerHTML) {
          wrap.innerHTML = '<div class="magnetar-expanded-inner"><div class="magnetar-activity-empty">Unable to load expanded details.</div></div>';
        }
      }
    }
    banner.classList.add('magnetar-expanded');
  }

  async function populateExpanded(detection, mode) {
    const wrap = document.getElementById('magnetar-expanded-section');
    if (!wrap) return;

    let sendCount = 0;
    let history = [];
    let shieldData = { blockedDomains: [] };
    let saved = [];
    try {
      const [sc, hi, sh, sv] = await Promise.all([
        safeRuntimeMessage({ type: 'get-send-count' }, {}),
        safeRuntimeMessage({ type: 'get-history' }, []),
        safeRuntimeMessage({ type: 'shield-get' }, {}),
        safeRuntimeMessage({ type: 'get-saved' }, [])
      ]);
      sendCount = sc?.count || 0;
      history = Array.isArray(hi) ? hi : (hi?.history || []);
      shieldData = sh || shieldData;
      saved = Array.isArray(sv) ? sv : [];
    } catch (e) {}

    const cachedCount = history.slice(0, 30).filter(h => h.cacheAtSend === 'cached').length;
    const cacheRate = history.length > 0 ? Math.round((cachedCount / Math.min(30, history.length)) * 100) : null;

    const activityRows = history.slice(0, 4).map(h => {
      const ago = formatRelative(h.timestamp);
      const status = h.cacheAtSend === 'cached' ? 'cached' : 'sent';
      return `
        <div class="magnetar-activity-row">
          <span class="magnetar-activity-name">${escapeHtml(h.name || '—')}</span>
          <span class="magnetar-activity-meta">${ago}</span>
          <span class="magnetar-activity-status magnetar-activity-${status}">${status}</span>
        </div>
      `;
    }).join('');

    const activityHTML = history.length > 0
      ? activityRows
      : '<div class="magnetar-activity-empty">No activity yet</div>';

    const savedRows = saved.map(s => {
      const ago = formatRelative(s.savedAt);
      const hash = escapeAttr(s.hash || '');
      return `
        <div class="magnetar-saved-row" data-hash="${hash}">
          <span class="magnetar-saved-name" title="${escapeHtml(s.name || '—')}">${escapeHtml(s.name || '—')}</span>
          <span class="magnetar-saved-meta">${ago}</span>
          <button class="magnetar-saved-action magnetar-saved-share" data-hash="${hash}" title="Share">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          </button>
          <button class="magnetar-saved-action magnetar-saved-copy" data-hash="${hash}" title="Copy magnet">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
          <button class="magnetar-saved-send" data-hash="${hash}" title="Send now">Send</button>
          <button class="magnetar-saved-delete" data-hash="${hash}" title="Remove">✕</button>
        </div>
      `;
    }).join('');

    const modeUpper = String(mode || 'local').toUpperCase();
    const targetOptions = getQuickSendTargetOptions();
    const expandedTargetControl = isAdvancedMode ? `
      <button class="magnetar-panel-send-target" id="magnetar-expanded-send-target" type="button" ${targetOptions.length ? '' : 'disabled'}>
        <span class="magnetar-panel-send-target-label">${escapeHtml(getCurrentToolbarSendLabel())}</span>
        ${targetOptions.length ? '<span class="magnetar-panel-send-target-arrow">▾</span>' : ''}
      </button>
    ` : '';
    const detectionDetails = isAdvancedMode ? buildDetectionDetailsPanel(detection) : '';

    wrap.innerHTML = `
      <div class="magnetar-expanded-inner">
        ${detectionDetails}
        <div class="magnetar-stats">
          <div class="magnetar-stat">
            <div class="magnetar-stat-label">sent all-time</div>
            <div class="magnetar-stat-value">${sendCount.toLocaleString()}</div>
            <div class="magnetar-stat-delta">total</div>
          </div>
          <div class="magnetar-stat">
            <div class="magnetar-stat-label">cache hit rate</div>
            <div class="magnetar-stat-value">${cacheRate === null ? '—' : cacheRate + '%'}</div>
            <div class="magnetar-stat-delta">last 30 sends</div>
          </div>
          <div class="magnetar-stat">
            <div class="magnetar-stat-label">sites blocked</div>
            <div class="magnetar-stat-value">${(shieldData.blockedDomains || []).length}</div>
            <div class="magnetar-stat-delta">shield</div>
          </div>
        </div>
        <div class="magnetar-section-heading">
          <span>Saved for later${saved.length ? ` <span class="magnetar-saved-count">${saved.length}</span>` : ''}</span>
          ${expandedTargetControl}
        </div>
        <div class="magnetar-saved">${saved.length > 0 ? savedRows : '<div class="magnetar-activity-empty">Nothing saved yet</div>'}</div>
        <div class="magnetar-section-heading">
          <span>Recent activity</span>
          <a id="magnetar-view-history">view history</a>
        </div>
        <div class="magnetar-activity">${activityHTML}</div>
        <div class="magnetar-bfoot">
          <span>v${MAGNETAR_API.runtime.getManifest().version} · ${modeUpper}</span>
          <span class="magnetar-bfoot-tagline">Grab torrents, send them anywhere</span>
        </div>
      </div>
    `;

    wrap.querySelector('#magnetar-view-history')?.addEventListener('click', (e) => {
      e.preventDefault();
      safeRuntimeMessage({ type: 'open-options' });
    });

    wrap.querySelector('#magnetar-expanded-send-target')?.addEventListener('click', (e) => {
      const options = getQuickSendTargetOptions();
      if (!options.length) return;
      showProviderTargetMenu(e.currentTarget, options, providerMode => {
        currentQuickSendTarget = providerMode;
        updateQuickSendTargetButtons();
      });
    });

    wrap.querySelectorAll('.magnetar-detection-copy').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.copyAction;
        if (action === 'hash') {
          await handleCopy(detection.hash, t('hashCopied'));
        } else if (action === 'magnet') {
          await handleCopy(detection.magnetUri, t('magnetCopied'));
        } else if (action === 'page') {
          await handleCopy(window.location.href, 'Page URL copied');
        }
      });
    });

    // Saved-for-later: Send pill
    wrap.querySelectorAll('.magnetar-saved-send').forEach(btn => {
      btn.addEventListener('click', async () => {
        const hash = btn.dataset.hash;
        const item = saved.find(s => s.hash === hash);
        if (!item) return;
        btn.disabled = true;
        btn.textContent = '…';
        try {
          const result = await MAGNETAR_API.runtime.sendMessage({
            type: 'send-magnet',
            hash: item.hash,
            name: item.name,
            magnetUri: item.magnetUri,
            category: item.category || '',
            pageUrl: item.sourceUrl || '',
            mode: currentQuickSendTarget
          });
          if (result?.success || result?.action === 'open-magnet') {
            if (result?.action === 'open-magnet' && result.magnetUri) {
              window.open(result.magnetUri, '_self');
              // Remove from saved queue for local mode (no auto-removal since recordHistory doesn't fire)
              await safeRuntimeMessage({ type: 'delete-saved-item', hash: item.hash });
            }
            showToast(`Sent to ${getCurrentQuickSendLabel()}`);
            await showOpenProviderAction(result.provider || currentQuickSendTarget);
            await populateExpanded(detection, mode);
          } else {
            btn.disabled = false;
            btn.textContent = 'Send';
            showToast(result?.error ? `Send failed: ${result.error}` : 'Send failed');
          }
        } catch (e) {
          btn.disabled = false;
          btn.textContent = 'Send';
        }
      });
    });

    // Saved-for-later: Share (does NOT move to history)
    wrap.querySelectorAll('.magnetar-saved-share').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const hash = btn.dataset.hash;
        const item = saved.find(s => s.hash === hash);
        if (!item) return;
        handleShare({
          name: item.name,
          magnetUri: item.magnetUri,
          hash: item.hash
        }, btn);
      });
    });

    // Saved-for-later: Copy magnet (does NOT move to history)
    wrap.querySelectorAll('.magnetar-saved-copy').forEach(btn => {
      btn.addEventListener('click', async () => {
        const hash = btn.dataset.hash;
        const item = saved.find(s => s.hash === hash);
        if (!item?.magnetUri) return;
        await handleCopy(item.magnetUri, t('magnetCopied'));
        // brief visual confirmation
        btn.classList.add('magnetar-saved-action-done');
        setTimeout(() => btn.classList.remove('magnetar-saved-action-done'), 900);
      });
    });

    // Saved-for-later: remove
    wrap.querySelectorAll('.magnetar-saved-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const hash = btn.dataset.hash;
        await safeRuntimeMessage({ type: 'delete-saved-item', hash });
        await populateExpanded(detection, mode);
        // If the removed hash is the one currently on the banner, also flip Save button back
        if (hash === detection.hash) {
          const sb = document.getElementById('magnetar-save');
          if (sb) {
            sb.classList.remove('magnetar-btn-saved');
            const label = sb.querySelector('.magnetar-save-label');
            if (label) label.textContent = 'Save';
          }
        }
      });
    });
  }

  function formatRelative(ts) {
    if (!ts) return '';
    const d = Date.now() - ts;
    if (d < 60_000)     return Math.max(1, Math.floor(d / 1000)) + 's ago';
    if (d < 3600_000)   return Math.floor(d / 60_000) + 'm ago';
    if (d < 86400_000)  return Math.floor(d / 3600_000) + 'h ago';
    return Math.floor(d / 86400_000) + 'd ago';
  }

  function formatCacheStatus(status) {
    if (status === 'cached') return 'Cached';
    if (status === 'not_cached') return 'Not cached';
    return 'Unknown';
  }

  function getDetectionTypeLabel(detection) {
    if (detection?.source === 'magnet-link') return 'Magnet link';
    if (detection?.hash) return 'Hash';
    return 'Unknown';
  }

  function getDetectionSourceLabel(source) {
    if (source === 'magnet-link') return 'magnet';
    if (source === 'custom-selector' || source === 'custom-regex') return 'custom site';
    if (source === 'labelled-hash' || source === 'data-attr' || source === 'hidden-input' || source === 'code-block' || source === 'broad-sweep') return 'hash match';
    return source || 'Unknown';
  }

  function buildDetectionDetailsPanel(detection) {
    const renderRows = rows => rows.map(([label, value, copyAction, detailKey]) => `
      <div class="magnetar-detection-detail-label">${escapeHtml(label)}</div>
      <div class="magnetar-detection-detail-value" ${detailKey ? `data-detection-detail="${escapeAttr(detailKey)}"` : ''} title="${escapeAttr(value)}">${escapeHtml(value)}</div>
      <div class="magnetar-detection-detail-action">
        ${copyAction ? `<button type="button" class="magnetar-detection-copy" data-copy-action="${escapeAttr(copyAction)}" title="Copy ${escapeAttr(label.toLowerCase())}" aria-label="Copy ${escapeAttr(label.toLowerCase())}">Copy</button>` : ''}
      </div>
    `).join('');
    const primaryRows = [
      ['Hash', detection?.hash || 'Unavailable', detection?.hash ? 'hash' : null],
      ['Magnet', detection?.magnetUri ? 'available' : 'Unavailable', detection?.magnetUri ? 'magnet' : null],
      ['Page URL', window.location.href, 'page']
    ];
    const secondaryRows = [
      ['Detection type', getDetectionTypeLabel(detection)],
      ['Source', getDetectionSourceLabel(detection?.source)],
      ['Cache status', formatCacheStatus(cacheStatus), null, 'cache'],
      ['Current target', getCurrentQuickSendLabel(), null, 'target'],
      ['Page domain', currentDomain || window.location.hostname || 'Unknown']
    ];

    return `
      <details class="magnetar-detection-details">
        <summary class="magnetar-detection-details-head">
          <span>Detection details</span>
          <span class="magnetar-detection-more-label">More</span>
        </summary>
        <div class="magnetar-detection-details-grid">
          ${renderRows(primaryRows)}
        </div>
        <div class="magnetar-detection-details-grid magnetar-detection-secondary">
          ${renderRows(secondaryRows)}
        </div>
      </details>
    `;
  }

  function buildSupportActions(extraClass = '') {
    const className = `magnetar-support-actions${extraClass ? ' ' + extraClass : ''}`;
    return `
      <div class="${className}">
        <button class="magnetar-support-action magnetar-pin-banner ${pinBanner ? 'magnetar-pin-banner-active' : ''}" id="magnetar-pin-banner" title="Pin to keep toolbar open after send" aria-label="Pin to keep toolbar open after send" aria-pressed="${pinBanner ? 'true' : 'false'}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M5 17h14"/><path d="M7 3h10l-2 8 3 4H6l3-4Z"/></svg>
        </button>
        <a class="magnetar-support-action" href="${STORE_URL}" target="_blank" rel="noopener" title="Review Magnetar" aria-label="Review Magnetar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        </a>
        <a class="magnetar-support-action" href="${COFFEE_URL}" target="_blank" rel="noopener" title="Buy me a coffee" aria-label="Buy me a coffee">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a4 4 0 0 1 0 8h-1"/><path d="M3 8h14v6a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5Z"/><path d="M6 2v2"/><path d="M10 2v2"/><path d="M14 2v2"/></svg>
        </a>
      </div>
    `;
  }

  function buildBannerHTML(detection, mode) {
    const isManualShell = detection?.manualOnly === true;
    const name = escapeHtml(detection.name || t('unknownTorrent'));

    const sendLabel = getSendLabel(mode);
    const showCache = !isManualShell && mode !== 'local';
    const isFull = isManualShell || bannerStyle === 'full';
    const quickSendToggle = quickSendProviders.length ? `
      <div class="magnetar-quick-send">
        <button class="magnetar-btn magnetar-btn-secondary magnetar-quick-send-toggle" id="magnetar-quick-send-toggle" title="Send with another provider" aria-label="Send with another provider" aria-haspopup="menu" aria-expanded="false">
          <span>Target</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>
    ` : '';
    const downloadsButton = `
      <button class="magnetar-btn magnetar-btn-secondary magnetar-open-downloads" id="magnetar-open-downloads" title="Open downloads folder" aria-label="Open downloads folder">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
        <span>Downloads</span>
      </button>
    `;
    const ignoreButton = `
      <button class="magnetar-btn magnetar-btn-secondary magnetar-ignore-site" id="magnetar-ignore-site" title="Ignore detections on this site" aria-label="Ignore detections on this site">Ignore site</button>
    `;
    const manualButton = `
      <button class="magnetar-btn magnetar-btn-secondary magnetar-manual-send-toggle" id="magnetar-manual-send-toggle" title="Paste external torrent link, magnet, or hash" aria-label="Paste external torrent link, magnet, or hash" aria-haspopup="dialog" aria-expanded="false">
        <span>Manual</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
    `;
    const batchToggle = `
      <label class="magnetar-batch-mode-toggle" title="Batch mode">
        <input type="checkbox" class="magnetar-batch-mode-input" id="magnetar-banner-batch-mode" ${batchMode ? 'checked' : ''}>
        <span class="magnetar-batch-mode-track" aria-hidden="true"></span>
        <span class="magnetar-batch-mode-label">Batch</span>
      </label>
    `;

    if (isFull) {
      const alreadySentStatus = !isManualShell && detection.alreadySent
        ? `<span class="magnetar-already-sent">${t('batchSentBadge')}</span>`
        : '';
      const sendControl = isManualShell
        ? `
                  <button class="magnetar-btn magnetar-btn-primary magnetar-manual-mode-indicator" id="magnetar-send" disabled>
                    <span class="magnetar-btn-label">Manual mode</span>
                  </button>
        `
        : `
                  <button class="magnetar-btn magnetar-btn-primary" id="magnetar-send">
                    <span class="magnetar-btn-label">${sendLabel}</span>
                    <span class="magnetar-btn-spinner" style="display:none"></span>
                  </button>
        `;
      const detectionActions = isManualShell ? '' : `
                <button class="magnetar-btn magnetar-btn-secondary" id="magnetar-share" title="${t('shareButton')}">${t('shareButton')}</button>
                <button class="magnetar-btn magnetar-btn-secondary" id="magnetar-copy-magnet">${t('copyMagnetButton')}</button>
                <button class="magnetar-btn magnetar-btn-secondary" id="magnetar-copy-hash">${t('copyHashButton')}</button>
                <button class="magnetar-btn magnetar-btn-secondary magnetar-btn-save" id="magnetar-save" title="Save for later">
                  <svg class="magnetar-save-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                  <span class="magnetar-save-label">Save</span>
                </button>
      `;
      const utilityTools = isManualShell
        ? `${downloadsButton}${manualButton}`
        : `${downloadsButton}${manualButton}${ignoreButton}${batchToggle}`;
      const expandControl = isManualShell ? '' : `
                <button class="magnetar-btn magnetar-btn-icon magnetar-btn-expand" id="magnetar-expand" title="Expand" aria-label="Expand">
                  <svg class="magnetar-expand-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
      `;
      return `
        <div class="magnetar-inner">
          <div class="magnetar-title-row">
            <span class="magnetar-brand">
              <span class="magnetar-logo">✦</span>
              <span class="magnetar-wordmark">MAGNETAR</span>
            </span>
            <span class="magnetar-name" title="${name}" tabindex="0"><span class="magnetar-name-text">${name}</span></span>
            <button class="magnetar-btn magnetar-btn-icon magnetar-btn-theme" id="magnetar-theme" title="Toggle theme" aria-label="Toggle theme">
              <svg class="magnetar-theme-icon-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              <svg class="magnetar-theme-icon-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
            </button>
            <button class="magnetar-btn magnetar-btn-icon magnetar-btn-settings" id="magnetar-banner-settings" title="Settings" aria-label="Settings">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
            <button class="magnetar-btn magnetar-btn-cancel" id="magnetar-dismiss" title="Dismiss">✕</button>
          </div>
          <div class="magnetar-button-row">
            <div class="magnetar-action-row">
              <div class="magnetar-send-region">
                <div class="magnetar-send-stack">
                  ${sendControl}
                </div>
                ${quickSendToggle}
              </div>
              <div class="magnetar-utility-region">
                ${detectionActions}
              </div>
              <span class="magnetar-status-group">
                ${showCache ? `
                  <span class="magnetar-cache" id="magnetar-cache">
                    <span class="magnetar-cache-dot magnetar-cache-loading"></span>
                    <span class="magnetar-cache-text">${t('cacheChecking')}</span>
                  </span>
                ` : ''}
                ${alreadySentStatus}
                ${expandControl}
              </span>
            </div>
            <div class="magnetar-tools-row">
              <div class="magnetar-tools-primary">
                ${utilityTools}
              </div>
              ${buildSupportActions()}
            </div>
          </div>
        </div>
        <div class="magnetar-expanded-section" id="magnetar-expanded-section"></div>
      `;
    } else {
      // Compact mode — Send + settings cog + ✕
      return `
        <div class="magnetar-inner magnetar-inner-compact">
          <span class="magnetar-brand">
            <span class="magnetar-logo">✦</span>
            <span class="magnetar-wordmark">MAGNETAR</span>
          </span>
          <div class="magnetar-send-stack">
            <button class="magnetar-btn magnetar-btn-primary" id="magnetar-send">
              <span class="magnetar-btn-label">${sendLabel}</span>
              <span class="magnetar-btn-spinner" style="display:none"></span>
            </button>
          </div>
          ${quickSendToggle}
          ${batchToggle}
          ${downloadsButton}
          <button class="magnetar-btn magnetar-btn-icon magnetar-btn-settings" id="magnetar-banner-settings" title="Settings" aria-label="Settings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
          <button class="magnetar-btn magnetar-btn-cancel" id="magnetar-dismiss">✕</button>
        </div>
      `;
    }
  }


  // ════════════════════════════════════════════════════════════════════════
  // BATCH PANEL
  // ════════════════════════════════════════════════════════════════════════

  async function injectBatchPanel(magnets, totalCount, mode) {
    document.getElementById('magnetar-batch')?.remove();

    let historyMap = {};
    try {
      historyMap = await safeRuntimeMessage({
        type: 'check-history',
        hashes: magnets.map(m => m.hash)
      }, {});
    } catch (e) {}

    const modeLabels = {
      local: t('batchLabelLocal'),
      realdebrid: t('batchLabelRealDebrid'),
      rdtclient: t('batchLabelRdtClient'),
      torbox: t('batchLabelTorBox'),
      premiumize: t('batchLabelPremiumize'),
      alldebrid: t('batchLabelAllDebrid')
    };

    const panel = document.createElement('div');
    panel.id = 'magnetar-batch';
    applyInterfaceMode(panel);
    if (bannerPosition === 'bottom') panel.classList.add('magnetar-batch-bottom');
    if (theme === 'dark') panel.classList.add('magnetar-theme-dark');

    const showCache = mode !== 'local';
    const truncatedNote = totalCount > magnets.length
      ? `<span class="magnetar-batch-truncated">${t('batchShowingOf', String(magnets.length), String(totalCount))}</span>`
      : '';

    // Count options for the 25/50/75 toggle. `batchMax` may not be one of these
    // (user could've picked something custom in settings), so include current if so.
    const batchCountOptions = [25, 50, 75];
    if (!batchCountOptions.includes(batchMax)) batchCountOptions.push(batchMax);
    batchCountOptions.sort((a, b) => a - b);

    // Store original magnets array for sorting/filtering
    let displayMagnets = [...magnets];
    const category = MagnetarCategories.detect();

    function formatSize(bytes) {
      if (!bytes) return '';
      if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
      if (bytes >= 1048576) return (bytes / 1048576).toFixed(0) + ' MB';
      return (bytes / 1024).toFixed(0) + ' KB';
    }

    function buildRows(list) {
      return list.map((m, i) => {
        const origIdx = magnets.indexOf(m);
        const inHistory = historyMap[m.hash] === true;
        const name = escapeHtml(m.name || t('cacheUnknown'));
        const truncName = name.length > 60 ? name.substring(0, 57) + '…' : name;
        const sizeStr = m.size ? formatSize(m.size) : '';
        const seedStr = m.seeders != null ? `↑${m.seeders}` : '';
        const metaStr = [seedStr, sizeStr].filter(Boolean).join(' · ');
        return `
          <label class="magnetar-batch-row ${inHistory ? 'magnetar-batch-done' : ''}" data-index="${origIdx}" data-sort-index="${i}">
            <input type="checkbox" class="magnetar-batch-cb" data-index="${origIdx}" ${inHistory ? 'disabled' : ''}>
            ${showCache ? `<span class="magnetar-batch-cache-dot magnetar-cache-loading" id="magnetar-bcd-${origIdx}"></span>` : ''}
            <span class="magnetar-batch-name" title="${name}">${truncName}</span>
            ${metaStr ? `<span class="magnetar-batch-meta">${metaStr}</span>` : ''}
            ${inHistory ? `<span class="magnetar-batch-badge magnetar-batch-badge-done">${t('batchSentBadge')}</span>` : ''}
            <button class="magnetar-batch-row-save" data-index="${origIdx}" title="Save for later" aria-label="Save for later">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </button>
            <span class="magnetar-batch-status" id="magnetar-bs-${origIdx}"></span>
          </label>
        `;
      }).join('');
    }

    panel.innerHTML = `
        <div class="magnetar-batch-shell">
        <div class="magnetar-batch-drawer" id="magnetar-batch-drawer" aria-hidden="true">
          <div class="magnetar-batch-drawer-inner">
            <div class="magnetar-batch-info-header">
              <span>v${MAGNETAR_API.runtime.getManifest().version}</span>
              <a href="${STORE_URL}" target="_blank" rel="noopener">review</a>
              <a href="${COFFEE_URL}" target="_blank" rel="noopener">coffee</a>
            </div>
            <div class="magnetar-stats">
              <div class="magnetar-stat">
                <div class="magnetar-stat-label">sent all-time</div>
                <div class="magnetar-stat-value" id="magnetar-batch-stat-sent">—</div>
                <div class="magnetar-stat-delta">total</div>
              </div>
              <div class="magnetar-stat">
                <div class="magnetar-stat-label">cache hit rate</div>
                <div class="magnetar-stat-value" id="magnetar-batch-stat-cache">—</div>
                <div class="magnetar-stat-delta">last 30 sends</div>
              </div>
              <div class="magnetar-stat">
                <div class="magnetar-stat-label">sites blocked</div>
                <div class="magnetar-stat-value" id="magnetar-batch-stat-shield">—</div>
                <div class="magnetar-stat-delta">shield</div>
              </div>
            </div>
            <div class="magnetar-section-heading">
              <span>Saved for later <span class="magnetar-saved-count" id="magnetar-batch-drawer-count">0</span></span>
            </div>
            <div class="magnetar-saved" id="magnetar-batch-drawer-saved">
              <div class="magnetar-activity-empty">Nothing saved yet</div>
            </div>
            <div class="magnetar-section-heading">
              <span>Recent activity</span>
              <a id="magnetar-batch-view-history">view history</a>
            </div>
            <div class="magnetar-activity" id="magnetar-batch-drawer-activity">
              <div class="magnetar-activity-empty">No activity yet</div>
            </div>
          </div>
        </div>

        <div class="magnetar-batch-inner">
          <div class="magnetar-batch-header">
            <div class="magnetar-batch-title-row">
              <span class="magnetar-brand">
                <span class="magnetar-logo">✦</span>
                <span class="magnetar-wordmark">MAGNETAR</span>
              </span>
              <span class="magnetar-batch-title">${t('batchTorrentsDetected', String(magnets.length))}</span>
              ${truncatedNote}
            </div>
            <div class="magnetar-batch-header-actions">
              <button class="magnetar-btn magnetar-btn-icon magnetar-btn-theme" id="magnetar-batch-theme" title="Toggle theme" aria-label="Toggle theme">
                <svg class="magnetar-theme-icon-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                <svg class="magnetar-theme-icon-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
              </button>
              <button class="magnetar-btn magnetar-btn-icon magnetar-btn-settings" id="magnetar-batch-settings" title="Settings" aria-label="Settings">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              </button>
              <button class="magnetar-btn magnetar-btn-icon magnetar-batch-drawer-toggle" id="magnetar-batch-drawer-toggle" title="Show saved &amp; history" aria-label="Show saved and history">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <button class="magnetar-batch-close" id="magnetar-batch-close" title="Dismiss">✕</button>
            </div>
          </div>
          <div class="magnetar-batch-toolbar">
            <select class="magnetar-batch-sort" id="magnetar-batch-sort">
              <option value="default">Order: Default</option>
              <option value="name">Name A–Z</option>
              <option value="name-desc">Name Z–A</option>
              <option value="seeders">Seeders ↓</option>
              <option value="size">Size ↓</option>
              <option value="size-asc">Size ↑</option>
            </select>
            <div class="magnetar-batch-count-toggle" role="group" aria-label="Max torrents">
              ${batchCountOptions.map(n => `
                <button class="magnetar-batch-count-opt ${n === batchMax ? 'magnetar-batch-count-opt-active' : ''}" data-count="${n}" type="button">${n}</button>
              `).join('')}
            </div>
            <label class="magnetar-batch-mode-toggle" title="Batch mode">
              <input type="checkbox" class="magnetar-batch-mode-input" id="magnetar-panel-batch-mode" ${batchMode ? 'checked' : ''}>
              <span class="magnetar-batch-mode-track" aria-hidden="true"></span>
              <span class="magnetar-batch-mode-label">Batch</span>
            </label>
          </div>
          <div class="magnetar-batch-controls">
            <label class="magnetar-batch-select-all">
              <input type="checkbox" id="magnetar-batch-all">
              <span>${t('batchSelectAll')}</span>
            </label>
            <span class="magnetar-batch-count" id="magnetar-batch-count">${t('batchSelected', '0')}</span>
          </div>
          <div class="magnetar-batch-list" id="magnetar-batch-list-inner">${buildRows(displayMagnets)}</div>
          <div class="magnetar-batch-progress" id="magnetar-batch-progress" style="display:none">
            <div class="magnetar-batch-progress-bar" id="magnetar-batch-progress-bar"></div>
            <span class="magnetar-batch-progress-text" id="magnetar-batch-progress-text">0/0</span>
          </div>
          <div class="magnetar-batch-footer">
            <button class="magnetar-btn magnetar-btn-primary magnetar-batch-send" id="magnetar-batch-send" disabled>
              <span class="magnetar-btn-label">${escapeHtml(getCurrentToolbarSendLabel())}</span>
              <span class="magnetar-btn-spinner" style="display:none"></span>
            </button>
            ${isAdvancedMode && getQuickSendTargetOptions().length ? `
              <button class="magnetar-btn magnetar-btn-icon magnetar-panel-send-target-toggle" id="magnetar-batch-send-target" title="Choose send target" aria-label="Choose send target" aria-haspopup="menu" aria-expanded="false">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
            ` : ''}
            <span class="magnetar-batch-send-status" id="magnetar-batch-send-status"></span>
            <button class="magnetar-btn magnetar-btn-cancel" id="magnetar-batch-dismiss">${t('batchDismiss')}</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(panel);
    prepareTitleReveal(panel);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        panel.classList.add('magnetar-batch-visible');
      });
    });

    // ── Cache checks ──
    const checkboxes = () => panel.querySelectorAll('.magnetar-batch-cb');
    const selectAll = panel.querySelector('#magnetar-batch-all');
    const countEl = panel.querySelector('#magnetar-batch-count');
    const sendBtn = panel.querySelector('#magnetar-batch-send');
    const listEl = panel.querySelector('#magnetar-batch-list-inner');

    if (showCache) {
      // Throttle concurrent cache probes. RD's probe-add-then-delete path
      // is heavy (3-5 API calls each), and firing 25 in parallel thrashes the
      // provider and risks rate limits. 4 concurrent keeps responses snappy
      // for the top-of-list rows while not overwhelming the provider.
      const CONCURRENCY = 4;
      let cursor = 0;
      const checkOne = async (idx) => {
        const m = magnets[idx];
        try {
          const res = await safeRuntimeMessage({
            type: 'check-cache', hash: m.hash
          }, null);
          const dot = panel.querySelector(`#magnetar-bcd-${idx}`);
          if (!dot) return;
          dot.classList.remove('magnetar-cache-loading');
          if (res?.status === 'cached') {
            dot.classList.add('magnetar-cache-cached');
            dot.title = t('cacheCached');
          } else if (res?.status === 'not_cached') {
            dot.classList.add('magnetar-cache-not-cached');
            dot.title = t('cacheNotCached');
          } else {
            dot.classList.add('magnetar-cache-unknown');
            dot.title = t('cacheUnknown');
          }
        } catch (e) {}
      };
      const worker = async () => {
        while (cursor < magnets.length) {
          const i = cursor++;
          // Bail if the panel's been dismissed mid-loop
          if (!document.getElementById('magnetar-batch')) return;
          await checkOne(i);
        }
      };
      for (let i = 0; i < CONCURRENCY; i++) worker();
    }

    // ── Sort handler ──
    panel.querySelector('#magnetar-batch-sort').addEventListener('change', (e) => {
      const sortBy = e.target.value;
      displayMagnets = [...magnets];
      switch (sortBy) {
        case 'name': displayMagnets.sort((a, b) => (a.name || '').localeCompare(b.name || '')); break;
        case 'name-desc': displayMagnets.sort((a, b) => (b.name || '').localeCompare(a.name || '')); break;
        case 'seeders': displayMagnets.sort((a, b) => (b.seeders || 0) - (a.seeders || 0)); break;
        case 'size': displayMagnets.sort((a, b) => (b.size || 0) - (a.size || 0)); break;
        case 'size-asc': displayMagnets.sort((a, b) => (a.size || 0) - (b.size || 0)); break;
      }
      listEl.innerHTML = buildRows(displayMagnets);
      bindCheckboxes();
      updateCount();
    });

    // ── Event handlers ──
    function updateCount() {
      const checked = panel.querySelectorAll('.magnetar-batch-cb:checked:not(:disabled)');
      countEl.textContent = t('batchSelected', String(checked.length));
      sendBtn.disabled = checked.length === 0;
    }

    function syncSavedRowMarkers(saved) {
      const hashes = new Set((Array.isArray(saved) ? saved : []).map(s => s.hash));
      panel.querySelectorAll('.magnetar-batch-row-save').forEach(btn => {
        const idx = parseInt(btn.dataset.index, 10);
        const m = magnets[idx];
        btn.classList.toggle('magnetar-batch-row-save-done', !!(m && hashes.has(m.hash)));
      });
    }

    function bindCheckboxes() {
      checkboxes().forEach(cb => cb.addEventListener('change', () => {
        updateCount();
        const cbs = [...checkboxes()];
        const enabledCbs = cbs.filter(c => !c.disabled);
        const checkedCbs = enabledCbs.filter(c => c.checked);
        selectAll.checked = enabledCbs.length > 0 && checkedCbs.length === enabledCbs.length;
        selectAll.indeterminate = checkedCbs.length > 0 && checkedCbs.length < enabledCbs.length;
      }));
    }

    bindCheckboxes();

    panel.querySelector('#magnetar-batch-send-target')?.addEventListener('click', (e) => {
      showProviderTargetMenu(e.currentTarget, getQuickSendTargetOptions(), providerMode => {
        currentQuickSendTarget = providerMode;
        updateQuickSendTargetButtons();
      });
    });

    selectAll.addEventListener('change', () => {
      checkboxes().forEach(cb => {
        if (!cb.disabled) cb.checked = selectAll.checked;
      });
      updateCount();
    });

    // Send selected
    sendBtn.addEventListener('click', async () => {
      const selected = [...panel.querySelectorAll('.magnetar-batch-cb:checked:not(:disabled)')]
        .map(cb => magnets[parseInt(cb.dataset.index)])
        .filter(Boolean);

      if (selected.length === 0) return;

      const label = sendBtn.querySelector('.magnetar-btn-label');
      const spinner = sendBtn.querySelector('.magnetar-btn-spinner');
      if (label) label.style.display = 'none';
      if (spinner) spinner.style.display = 'inline-block';
      sendBtn.disabled = true;
      checkboxes().forEach(cb => cb.disabled = true);

      // Show progress bar
      const progressWrap = panel.querySelector('#magnetar-batch-progress');
      const progressBar = panel.querySelector('#magnetar-batch-progress-bar');
      const progressText = panel.querySelector('#magnetar-batch-progress-text');
      if (progressWrap) progressWrap.style.display = 'flex';

      const mappedCategory = settings?.preferences?.categoryMap?.[category] || category;
      let totalProcessed = 0;

      function updateProgress(done, total) {
        const pct = Math.round((done / total) * 100);
        if (progressBar) progressBar.style.width = pct + '%';
        if (progressText) progressText.textContent = `${done}/${total}`;
      }

      const sendTarget = currentQuickSendTarget;
      const sendTargetLabel = getCurrentQuickSendLabel();

      if (sendTarget === 'local') {
        for (let i = 0; i < selected.length; i++) {
          const item = selected[i];
          const statusEl = panel.querySelector(`#magnetar-bs-${magnets.indexOf(item)}`);
          window.open(item.magnetUri, '_blank');
          if (statusEl) statusEl.innerHTML = '<span class="magnetar-batch-badge magnetar-batch-badge-ok">✓</span>';
          totalProcessed++;
          updateProgress(totalProcessed, selected.length);
          if (i < selected.length - 1) await new Promise(r => setTimeout(r, 500));
        }
        showToast(`${t('batchOpenedMagnets', String(selected.length))} (${sendTargetLabel})`);
        await showOpenProviderAction(sendTarget, panel);
      } else {
        try {
          const items = selected.map(m => ({
            hash: m.hash, name: m.name, magnetUri: m.magnetUri, category: mappedCategory
          }));
          const response = await MAGNETAR_API.runtime.sendMessage({
            type: 'batch-send', items, pageUrl: window.location.href, mode: sendTarget
          });
          if (response?.results) {
            let successCount = 0;
            for (const res of response.results) {
              const idx = magnets.findIndex(m => m.hash === res.hash);
              const statusEl = panel.querySelector(`#magnetar-bs-${idx}`);
              totalProcessed++;
              updateProgress(totalProcessed, selected.length);
              if (res.success) {
                successCount++;
                if (statusEl) statusEl.innerHTML = '<span class="magnetar-batch-badge magnetar-batch-badge-ok">✓</span>';
                const row = panel.querySelector(`.magnetar-batch-row[data-index="${idx}"]`);
                if (row) row.classList.add('magnetar-batch-done');
              } else {
                if (statusEl) statusEl.innerHTML = '<span class="magnetar-batch-badge magnetar-batch-badge-fail">✗</span>';
              }
            }
            showToast(`${t('batchSentCount', String(successCount), String(selected.length))} (${sendTargetLabel})`);
            if (successCount > 0) await showOpenProviderAction(sendTarget, panel);
          }
        } catch (e) {
          showToast(t('batchSendFailed', e.message), true);
        }
      }

      if (progressWrap) setTimeout(() => { progressWrap.style.display = 'none'; }, 1500);

      if (label) label.style.display = 'inline';
      if (spinner) spinner.style.display = 'none';
      sendBtn.disabled = false;

      checkboxes().forEach(cb => {
        const idx = parseInt(cb.dataset.index);
        const row = panel.querySelector(`.magnetar-batch-row[data-index="${idx}"]`);
        if (row && row.classList.contains('magnetar-batch-done')) {
          cb.disabled = true;
          cb.checked = false;
        } else {
          cb.disabled = false;
        }
      });
      updateCount();

      // Review prompt check
      try {
        const review = await safeRuntimeMessage({ type: 'get-review-status' }, null);
        if (review?.count >= 200 && !review.dismissed) {
          showReviewPrompt();
        }
      } catch (e) {}
    });

    panel.querySelector('#magnetar-batch-close')?.addEventListener('click', dismissBatch);
    panel.querySelector('#magnetar-batch-dismiss')?.addEventListener('click', dismissBatch);

    // ── Theme toggle ──
    const applyBatchTheme = (t) => {
      panel.classList.toggle('magnetar-theme-dark', t === 'dark');
      const iconDark = panel.querySelector('.magnetar-theme-icon-dark');
      const iconLight = panel.querySelector('.magnetar-theme-icon-light');
      if (iconDark)  iconDark.style.display  = t === 'dark' ? 'none' : '';
      if (iconLight) iconLight.style.display = t === 'dark' ? '' : 'none';
    };
    applyBatchTheme(theme);

    panel.querySelector('#magnetar-batch-theme')?.addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      applyBatchTheme(theme);
      applyTheme(theme); // keep any open banner in sync
      safeRuntimeMessage({ type: 'set-theme', theme });
    });

    // ── Settings cog ──
    panel.querySelector('#magnetar-batch-settings')?.addEventListener('click', () => {
      safeRuntimeMessage({ type: 'open-options' });
    });

    // ── Drawer: slide-out saved + history ──
    const drawer = panel.querySelector('#magnetar-batch-drawer');
    const drawerToggle = panel.querySelector('#magnetar-batch-drawer-toggle');
    let drawerBuilt = false;

    drawerToggle?.addEventListener('click', async () => {
      const willOpen = !panel.classList.contains('magnetar-batch-drawer-open');
      panel.classList.toggle('magnetar-batch-drawer-open', willOpen);
      drawer?.setAttribute('aria-hidden', String(!willOpen));
      if (willOpen) await refreshDrawer();
    });

    panel.querySelector('#magnetar-batch-view-history')?.addEventListener('click', (e) => {
      e.preventDefault();
      safeRuntimeMessage({ type: 'open-options' });
    });

    async function refreshDrawer() {
      const [saved, history, sendCountRes, shieldRes] = await Promise.all([
        safeRuntimeMessage({ type: 'get-saved' }, []),
        safeRuntimeMessage({ type: 'get-history' }, []),
        safeRuntimeMessage({ type: 'get-send-count' }, {}),
        safeRuntimeMessage({ type: 'shield-get' }, {})
      ]);
      const savedList = Array.isArray(saved) ? saved : [];
      const histList = Array.isArray(history) ? history : (history?.history || []);
      const sendCount = sendCountRes?.count || 0;
      const shieldData = shieldRes || {};
      syncSavedRowMarkers(savedList);

      // Stats cards
      const statSent = panel.querySelector('#magnetar-batch-stat-sent');
      const statCache = panel.querySelector('#magnetar-batch-stat-cache');
      const statShield = panel.querySelector('#magnetar-batch-stat-shield');
      if (statSent) statSent.textContent = sendCount.toLocaleString();
      if (statShield) statShield.textContent = String((shieldData.blockedDomains || []).length);
      if (statCache) {
        const recent = histList.slice(0, 30);
        const cached = recent.filter(h => h.cacheAtSend === 'cached').length;
        statCache.textContent = recent.length > 0
          ? Math.round((cached / recent.length) * 100) + '%'
          : '—';
      }

      const savedCountEl = panel.querySelector('#magnetar-batch-drawer-count');
      if (savedCountEl) savedCountEl.textContent = String(savedList.length);

      const savedHost = panel.querySelector('#magnetar-batch-drawer-saved');
      if (savedHost) {
        savedHost.innerHTML = savedList.length
          ? savedList.map(s => {
              const ago = formatRelative(s.savedAt);
              const hash = escapeAttr(s.hash || '');
              return `
                <div class="magnetar-saved-row" data-hash="${hash}">
                  <span class="magnetar-saved-name" title="${escapeHtml(s.name || '—')}">${escapeHtml(s.name || '—')}</span>
                  <span class="magnetar-saved-meta">${ago}</span>
                  <button class="magnetar-saved-action magnetar-saved-share" data-hash="${hash}" title="Share">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                  </button>
                  <button class="magnetar-saved-action magnetar-saved-copy" data-hash="${hash}" title="Copy magnet">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  </button>
                  <button class="magnetar-saved-send" data-hash="${hash}" title="Send now">Send</button>
                  <button class="magnetar-saved-delete" data-hash="${hash}" title="Remove">✕</button>
                </div>
              `;
            }).join('')
          : '<div class="magnetar-activity-empty">Nothing saved yet</div>';

        // Share — does NOT remove from saved queue
        savedHost.querySelectorAll('.magnetar-saved-share').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const item = savedList.find(s => s.hash === btn.dataset.hash);
            if (!item) return;
            handleShare({
              name: item.name,
              magnetUri: item.magnetUri,
              hash: item.hash
            }, btn);
          });
        });

        // Copy magnet — does NOT remove from saved queue
        savedHost.querySelectorAll('.magnetar-saved-copy').forEach(btn => {
          btn.addEventListener('click', async () => {
            const item = savedList.find(s => s.hash === btn.dataset.hash);
            if (!item?.magnetUri) return;
            await handleCopy(item.magnetUri, t('magnetCopied'));
            btn.classList.add('magnetar-saved-action-done');
            setTimeout(() => btn.classList.remove('magnetar-saved-action-done'), 900);
          });
        });

        savedHost.querySelectorAll('.magnetar-saved-send').forEach(btn => {
          btn.addEventListener('click', async () => {
            const item = savedList.find(s => s.hash === btn.dataset.hash);
            if (!item) return;
            btn.disabled = true;
            btn.textContent = '…';
            try {
              const result = await MAGNETAR_API.runtime.sendMessage({
                type: 'send-magnet',
                hash: item.hash, name: item.name, magnetUri: item.magnetUri,
                category: item.category || '', pageUrl: item.sourceUrl || '',
                mode: currentQuickSendTarget
              });
              if (result?.success || result?.action === 'open-magnet') {
                if (result?.action === 'open-magnet' && result.magnetUri) {
                  window.open(result.magnetUri, '_self');
                  await safeRuntimeMessage({ type: 'delete-saved-item', hash: item.hash });
                }
                showToast(`Sent to ${getCurrentQuickSendLabel()}`);
                await showOpenProviderAction(result.provider || currentQuickSendTarget, panel);
                await refreshDrawer();
              } else {
                btn.disabled = false;
                btn.textContent = 'Send';
              }
            } catch (e) {
              btn.disabled = false;
              btn.textContent = 'Send';
            }
          });
        });

        savedHost.querySelectorAll('.magnetar-saved-delete').forEach(btn => {
          btn.addEventListener('click', async () => {
            await safeRuntimeMessage({ type: 'delete-saved-item', hash: btn.dataset.hash });
            await refreshDrawer();
          });
        });
      }

      const histHost = panel.querySelector('#magnetar-batch-drawer-activity');
      if (histHost) {
        const top = histList.slice(0, 30);
        histHost.innerHTML = top.length
          ? top.map(h => {
              const ago = formatRelative(h.timestamp);
              const status = h.cacheAtSend === 'cached' ? 'cached' : 'sent';
              return `
                <div class="magnetar-activity-row">
                  <span class="magnetar-activity-name" title="${escapeHtml(h.name || '—')}">${escapeHtml(h.name || '—')}</span>
                  <span class="magnetar-activity-meta">${ago}</span>
                  <span class="magnetar-activity-status magnetar-activity-${status}">${status}</span>
                </div>
              `;
            }).join('')
          : '<div class="magnetar-activity-empty">No activity yet</div>';
      }
    }

    // ── 25/50/75 count toggle ──
    panel.querySelectorAll('.magnetar-batch-count-opt').forEach(btn => {
      btn.addEventListener('click', async () => {
        const n = parseInt(btn.dataset.count, 10);
        if (!n || n === batchMax) return;
        batchMax = n;
        // Persist
        try {
          const current = (await MAGNETAR_API.runtime.sendMessage({ type: 'get-settings' })) || {};
          current.preferences = current.preferences || {};
          current.preferences.batchMax = n;
          await MAGNETAR_API.runtime.sendMessage({ type: 'save-settings', data: current });
        } catch (e) {}
        // Redraw panel — simplest path: remove it and re-detect.
        // `allMagnets` is captured in the outer closure; we re-slice here.
        panel.remove();
        const batchItems = getBatchMagnets();
        const fresh = batchItems.slice(0, n);
        injectBatchPanel(fresh, batchItems.length, mode);
      });
    });

    // ── Per-row save ──
    panel.querySelector('#magnetar-panel-batch-mode')?.addEventListener('change', (e) => {
      saveBatchModePreference(e.target.checked);
    });

    panel.querySelectorAll('.magnetar-batch-row-save').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation(); // don't toggle the row checkbox
        const idx = parseInt(btn.dataset.index, 10);
        const m = magnets[idx];
        if (!m) return;
        if (btn.classList.contains('magnetar-batch-row-save-done')) return;
        try {
          await MAGNETAR_API.runtime.sendMessage({
            type: 'save-torrent',
            hash: m.hash, name: m.name, magnetUri: m.magnetUri,
            category: MagnetarCategories.detect(),
            sourceUrl: window.location.href
          });
          btn.classList.add('magnetar-batch-row-save-done');
          // Refresh drawer count if drawer has been opened at least once
          if (panel.classList.contains('magnetar-batch-drawer-open')) await refreshDrawer();
        } catch (err) {}
      });
    });

    // Pre-mark rows for items already in the saved queue
    safeRuntimeMessage({ type: 'get-saved' }, []).then(saved => {
      syncSavedRowMarkers(saved);
    }).catch(() => {});
  }

  function dismissBatch() {
    const panel = document.getElementById('magnetar-batch');
    if (!panel) return;
    panel.classList.remove('magnetar-batch-visible');
    panel.classList.add('magnetar-batch-hiding');
    setTimeout(() => panel.remove(), 300);
  }


  // ════════════════════════════════════════════════════════════════════════
  // SHARED ACTIONS
  // ════════════════════════════════════════════════════════════════════════

  async function handleSend(detection, category, providerMode = mode) {
    const btn = document.getElementById('magnetar-send');
    if (!btn) return;
    const providerLabel = getProviderName(providerMode);

    const label = btn.querySelector('.magnetar-btn-label');
    const spinner = btn.querySelector('.magnetar-btn-spinner');
    btn.dataset.retryProvider = providerMode;
    btn.classList.remove('magnetar-btn-sent');
    if (label) {
      label.textContent = getSendingLabel();
      label.style.display = 'inline';
    }
    if (spinner) spinner.style.display = 'none';
    btn.disabled = true;

    try {
      const response = await MAGNETAR_API.runtime.sendMessage({
        type: 'send-magnet',
        magnetUri: detection.magnetUri,
        hash: detection.hash,
        name: detection.name,
        category: settings?.preferences?.categoryMap?.[category] || category,
        pageUrl: window.location.href,
        mode: providerMode
      });

      if (response?.action === 'open-magnet') {
        window.location.assign(response.magnetUri);
        await showSuccess(providerLabel, response.provider || providerMode);
      } else if (response?.success) {
        await showSuccess(providerLabel, response.provider || providerMode);
        // Review prompt check
        try {
          const review = await safeRuntimeMessage({ type: 'get-review-status' }, null);
          if (review?.count >= 200 && !review.dismissed) {
            setTimeout(() => showReviewPrompt(), 3000);
          }
        } catch (e) {}
      } else {
        showError(`${providerLabel}: ${response?.error || t('sendFailed')}`, providerMode);
      }
    } catch (e) {
      showError(`${providerLabel}: ${e.message}`, providerMode);
    }
  }

  function handleQuickSendMenu(detection, category, anchorBtn) {
    showProviderTargetMenu(anchorBtn, getPostSendQuickSendProviders(), providerMode => {
      currentQuickSendTarget = providerMode;
      updateQuickSendTargetButtons();
      handleSend(detection, category, providerMode);
    });
  }

  function normaliseManualDisplayName(raw) {
    const value = String(raw || '').trim().replace(/\s+/g, ' ');
    return value ? value.slice(0, 180) : '';
  }

  function getManualHashFallback(hash) {
    return `Manual hash ${hash.substring(0, 8)}`;
  }

  function parseManualSendInput(raw, manualNameRaw = '') {
    const value = String(raw || '').trim();
    if (!value) return { error: 'Paste a magnet link or info hash.' };
    const manualName = normaliseManualDisplayName(manualNameRaw);

    if (/^magnet:\?/i.test(value)) {
      const hash = MagnetarDetector.hashFromMagnet(value);
      if (!hash) return { error: 'That magnet link does not contain a valid torrent hash.' };
      const name = MagnetarDetector.nameFromMagnet(value) || manualName || getManualHashFallback(hash);
      return {
        detection: {
          hash,
          magnetUri: value,
          name,
          source: 'manual-input',
          category
        }
      };
    }

    const hash = MagnetarDetector.normaliseHash(value);
    if (hash) {
      const name = manualName || getManualHashFallback(hash);
      return {
        detection: {
          hash,
          magnetUri: MagnetarDetector.buildMagnet(hash, name),
          name,
          source: 'manual-input',
          category
        }
      };
    }

    if (/^https?:\/\//i.test(value)) {
      return { error: 'Torrent page URLs are not supported here. Paste a magnet link or info hash.' };
    }

    return { error: 'Enter a valid magnet link or torrent info hash.' };
  }

  function positionFloatingMenu(menu, anchorBtn, aboveClass) {
    menu.style.position = 'fixed';
    menu.style.zIndex = '2147483647';
    document.body.appendChild(menu);

    const rect = anchorBtn.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const gap = 6;
    const flipUp = (vh - rect.bottom) < menuRect.height + gap + 8;

    if (flipUp) {
      menu.style.top = Math.max(8, rect.top - menuRect.height - gap) + 'px';
      if (aboveClass) menu.classList.add(aboveClass);
    } else {
      menu.style.top = (rect.bottom + gap) + 'px';
    }

    let left = rect.left;
    if (left + menuRect.width + 8 > vw) left = Math.max(8, vw - menuRect.width - 8);
    menu.style.left = left + 'px';
  }

  function handleManualSendMenu(anchorBtn) {
    if (!anchorBtn || !isAdvancedMode) return;

    const existingMenu = document.getElementById('magnetar-manual-menu');
    if (existingMenu) {
      const existingAnchorId = existingMenu.dataset.anchorId || '';
      if (typeof existingMenu.closeManualMenu === 'function') {
        existingMenu.closeManualMenu(true);
      } else {
        existingMenu.remove();
      }
      if (existingAnchorId === (anchorBtn.id || '')) return;
    }

    document.getElementById('magnetar-quick-send-menu')?.remove();
    document.getElementById('magnetar-share-menu')?.remove();

    const menu = document.createElement('div');
    menu.id = 'magnetar-manual-menu';
    menu.dataset.anchorId = anchorBtn.id || '';
    if (theme === 'dark') menu.classList.add('magnetar-theme-dark');
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', 'Manual send');
    menu.innerHTML = `
      <div class="magnetar-manual-title">Manual send</div>
      <input class="magnetar-manual-input" type="text" placeholder="Paste torrent link, magnet, or hash" autocomplete="off" spellcheck="false">
      <label class="magnetar-manual-name-label">
        <span>Name optional</span>
        <input class="magnetar-manual-name-input" type="text" placeholder="Name for this hash" autocomplete="off" spellcheck="false" maxlength="180">
      </label>
      <div class="magnetar-manual-actions">
        <button type="button" class="magnetar-manual-clear">Clear</button>
        <button type="button" class="magnetar-manual-submit">Send</button>
      </div>
      <div class="magnetar-manual-message" role="status">Name your hash for your client.</div>
    `;

    positionFloatingMenu(menu, anchorBtn, 'magnetar-manual-menu-above');
    anchorBtn.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => menu.classList.add('magnetar-manual-menu-visible'));

    const input = menu.querySelector('.magnetar-manual-input');
    const nameInput = menu.querySelector('.magnetar-manual-name-input');
    const message = menu.querySelector('.magnetar-manual-message');
    const submit = menu.querySelector('.magnetar-manual-submit');
    const clear = menu.querySelector('.magnetar-manual-clear');
    setTimeout(() => input?.focus(), 0);

    const manualHelperText = 'Name your hash for your client.';
    const setMessage = (text, isError = false) => {
      const messageText = text || manualHelperText;
      message.textContent = messageText;
      message.classList.toggle('magnetar-manual-message-error', isError);
      message.classList.toggle('magnetar-manual-message-ok', !isError && !!text);
    };

    const sendManual = async () => {
      const parsed = parseManualSendInput(input?.value, nameInput?.value);
      if (parsed.error) {
        setMessage(parsed.error, true);
        return;
      }

      const providerMode = currentQuickSendTarget;
      const providerLabel = getProviderName(providerMode);
      submit.disabled = true;
      setMessage('Sending...');
      try {
        const response = await MAGNETAR_API.runtime.sendMessage({
          type: 'send-magnet',
          magnetUri: parsed.detection.magnetUri,
          hash: parsed.detection.hash,
          name: parsed.detection.name,
          category: settings?.preferences?.categoryMap?.[category] || category,
          pageUrl: window.location.href,
          mode: providerMode
        });

        if (response?.action === 'open-magnet') {
          closeManualMenu(true);
          window.location.assign(response.magnetUri);
          await showSuccess(providerLabel, response.provider || providerMode);
          return;
        }

        if (response?.success) {
          closeManualMenu();
          await showSuccess(providerLabel, response.provider || providerMode);
          return;
        }

        const errorMessage = `${providerLabel}: ${response?.error || t('sendFailed')}`;
        clearBannerAutoHide();
        setMessage(errorMessage, true);
        showToast(errorMessage, true);
      } catch (e) {
        const errorMessage = `${providerLabel}: ${e.message}`;
        clearBannerAutoHide();
        setMessage(errorMessage, true);
        showToast(errorMessage, true);
      } finally {
        submit.disabled = false;
      }
    };

    submit.addEventListener('click', sendManual);
    clear.addEventListener('click', () => {
      input.value = '';
      nameInput.value = '';
      setMessage('');
      input.focus();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendManual();
      }
    });

    const closeHandler = (e) => {
      if (!menu.contains(e.target) && e.target !== anchorBtn) {
        closeManualMenu();
      }
    };

    const keyHandler = (e) => {
      if (e.key === 'Escape') closeManualMenu();
    };

    setTimeout(() => document.addEventListener('click', closeHandler), 50);
    document.addEventListener('keydown', keyHandler);
    menu.closeManualMenu = closeManualMenu;

    function closeManualMenu(immediate = false) {
      anchorBtn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', closeHandler);
      document.removeEventListener('keydown', keyHandler);
      menu.classList.remove('magnetar-manual-menu-visible');
      if (immediate) {
        menu.remove();
      } else {
        setTimeout(() => menu.remove(), 150);
      }
    }
  }

  function showProviderTargetMenu(anchorBtn, providers, onSelect) {
    if (!anchorBtn || !providers.length) return;

    const anchorId = anchorBtn.id || '';
    const existingMenu = document.getElementById('magnetar-quick-send-menu');
    if (existingMenu) {
      const existingAnchorId = existingMenu.dataset.anchorId || '';
      if (typeof existingMenu.closeQuickSendMenu === 'function') {
        existingMenu.closeQuickSendMenu(true);
      } else {
        existingMenu.remove();
      }
      if (existingAnchorId === anchorId) return;
    }

    document.getElementById('magnetar-share-menu')?.remove();
    const manualMenu = document.getElementById('magnetar-manual-menu');
    if (manualMenu && typeof manualMenu.closeManualMenu === 'function') {
      manualMenu.closeManualMenu(true);
    } else {
      manualMenu?.remove();
    }

    const menu = document.createElement('div');
    menu.id = 'magnetar-quick-send-menu';
    menu.dataset.anchorId = anchorId;
    if (theme === 'dark') menu.classList.add('magnetar-theme-dark');
    menu.setAttribute('role', 'menu');
    menu.innerHTML = providers.map(provider => `
      <button type="button" class="magnetar-quick-send-option" role="menuitem" data-mode="${provider.id}">
        <span class="magnetar-provider-menu-icon" data-provider="${provider.id}" aria-hidden="true"></span>
        <span class="magnetar-provider-menu-label">${escapeHtml(provider.label)}</span>
      </button>
    `).join('');

    menu.style.position = 'fixed';
    menu.style.zIndex = '2147483647';
    document.body.appendChild(menu);

    const rect = anchorBtn.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const gap = 6;
    const flipUp = (vh - rect.bottom) < menuRect.height + gap + 8;

    if (flipUp) {
      menu.style.top = Math.max(8, rect.top - menuRect.height - gap) + 'px';
      menu.classList.add('magnetar-quick-send-menu-above');
    } else {
      menu.style.top = (rect.bottom + gap) + 'px';
    }

    let left = rect.left;
    if (left + menuRect.width + 8 > vw) left = Math.max(8, vw - menuRect.width - 8);
    menu.style.left = left + 'px';

    anchorBtn.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => menu.classList.add('magnetar-quick-send-menu-visible'));

    menu.addEventListener('click', (e) => {
      const item = e.target.closest('.magnetar-quick-send-option');
      if (!item) return;
      closeQuickSendMenu();
      onSelect(item.dataset.mode);
    });

    const closeHandler = (e) => {
      if (!menu.contains(e.target) && e.target !== anchorBtn) {
        closeQuickSendMenu();
      }
    };

    const keyHandler = (e) => {
      if (e.key === 'Escape') closeQuickSendMenu();
    };

    setTimeout(() => document.addEventListener('click', closeHandler, { once: true }), 50);
    document.addEventListener('keydown', keyHandler);
    menu.closeQuickSendMenu = closeQuickSendMenu;

    function closeQuickSendMenu(immediate = false) {
      anchorBtn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('keydown', keyHandler);
      menu.classList.remove('magnetar-quick-send-menu-visible');
      if (immediate) {
        menu.remove();
      } else {
        setTimeout(() => menu.remove(), 150);
      }
    }
  }

  async function handleShare(detection, anchorBtn) {
    // Remove any existing share menu
    document.getElementById('magnetar-share-menu')?.remove();
    const manualMenu = document.getElementById('magnetar-manual-menu');
    if (manualMenu && typeof manualMenu.closeManualMenu === 'function') {
      manualMenu.closeManualMenu(true);
    } else {
      manualMenu?.remove();
    }

    const btn = anchorBtn || document.getElementById('magnetar-share');
    if (!btn) return;

    const magnetUri = detection.magnetUri || '';
    const name = detection.name || t('unknownTorrent');
    const pageUrl = window.location.href;

    // Encode for share URLs
    const encodedName = encodeURIComponent(name);
    const encodedMagnet = encodeURIComponent(magnetUri);
    const encodedPage = encodeURIComponent(pageUrl);

    const menu = document.createElement('div');
    menu.id = 'magnetar-share-menu';
    if (theme === 'dark') menu.classList.add('magnetar-theme-dark');
    menu.innerHTML = `
      <button class="magnetar-share-item" data-action="email" title="${t('shareEmail')}">
        <span class="magnetar-share-icon">✉</span><span>${t('shareEmail')}</span>
      </button>
      <button class="magnetar-share-item" data-action="x" title="${t('shareX')}">
        <span class="magnetar-share-icon">𝕏</span><span>${t('shareX')}</span>
      </button>
      <button class="magnetar-share-item" data-action="reddit" title="${t('shareReddit')}">
        <span class="magnetar-share-icon">↗</span><span>${t('shareReddit')}</span>
      </button>
      <button class="magnetar-share-item" data-action="telegram" title="${t('shareTelegram')}">
        <span class="magnetar-share-icon">➤</span><span>${t('shareTelegram')}</span>
      </button>
      <button class="magnetar-share-item" data-action="copy" title="${t('shareCopyLink')}">
        <span class="magnetar-share-icon">⎘</span><span>${t('shareCopyLink')}</span>
      </button>
    `;

    // Position relative to the share button. Flip above if there's no room below.
    // Also clamp horizontally so the menu never spills off the viewport edges.
    menu.style.position = 'fixed';
    menu.style.zIndex = '2147483647';
    document.body.appendChild(menu);

    // Menu dimensions aren't known until it's in the DOM
    const rect = btn.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const gap = 6;

    const spaceBelow = vh - rect.bottom;
    const flipUp = spaceBelow < menuRect.height + gap + 8;  // 8px breathing room

    if (flipUp) {
      menu.style.top = Math.max(8, rect.top - menuRect.height - gap) + 'px';
      menu.classList.add('magnetar-share-menu-above');
    } else {
      menu.style.top = (rect.bottom + gap) + 'px';
    }

    // Horizontal clamp: prefer aligning to left edge of the button, but nudge
    // in if it would overflow the right side of the viewport.
    let left = rect.left;
    if (left + menuRect.width + 8 > vw) left = Math.max(8, vw - menuRect.width - 8);
    menu.style.left = left + 'px';

    requestAnimationFrame(() => menu.classList.add('magnetar-share-menu-visible'));

    // Handle clicks
    menu.addEventListener('click', async (e) => {
      const item = e.target.closest('.magnetar-share-item');
      if (!item) return;
      const action = item.dataset.action;

      switch (action) {
        case 'email':
          window.open(`mailto:?subject=${encodedName}&body=${encodeURIComponent(t('shareEmailSubject'))}%3A%0A%0A${encodedMagnet}%0A%0A${encodedPage}`);
          break;
        case 'x':
          window.open(`https://x.com/intent/tweet?text=${encodedName}&url=${encodedPage}`, '_blank');
          break;
        case 'reddit':
          window.open(`https://reddit.com/submit?url=${encodedPage}&title=${encodedName}`, '_blank');
          break;
        case 'telegram':
          window.open(`https://t.me/share/url?url=${encodedMagnet}&text=${encodedName}`, '_blank');
          break;
        case 'copy':
          await handleCopy(magnetUri, t('magnetLinkCopied'));
          break;
      }
      closeShareMenu();
    });

    // Close on click outside
    const closeHandler = (e) => {
      if (!menu.contains(e.target) && e.target !== btn) {
        closeShareMenu();
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler, { once: true }), 50);

    function closeShareMenu() {
      menu.classList.remove('magnetar-share-menu-visible');
      setTimeout(() => menu.remove(), 150);
    }
  }

  async function handleCopy(text, successMsg) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(successMsg);
    } catch (e) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showToast(successMsg);
    }
  }

  async function handleOpenDownloadsFolder() {
    const result = await safeRuntimeMessage(
      { type: 'open-downloads-folder' },
      { success: false, error: 'Downloads folder is not available in this browser.' }
    );
    if (!result?.success) {
      showToast(result?.error || 'Could not open downloads folder.', true);
    }
  }

  async function handleIgnoreCurrentSite() {
    const domain = normaliseDomain(window.location.hostname);
    if (!domain) {
      showToast('Could not ignore this site.', true);
      return;
    }

    const current = await safeRuntimeMessage({ type: 'get-settings' }, null);
    if (!current) {
      showToast('Could not ignore this site.', true);
      return;
    }

    const ignored = [...new Set([...(current.ignoredWebsites || []).map(normaliseDomain).filter(Boolean), domain])].sort();
    current.ignoredWebsites = ignored;
    await safeRuntimeMessage({ type: 'save-settings', data: current }, null);
    showToast('Site ignored');
    setTimeout(() => dismissBanner(), 350);
  }

  async function handlePinBannerToggle() {
    pinBanner = !pinBanner;
    updatePinBannerToggle();
    if (pinBanner) {
      clearBannerAutoHide();
    } else {
      scheduleAutoHideForSuccessfulBanner();
    }
    const result = await safeRuntimeMessage({ type: 'set-tab-pin', pinned: pinBanner }, null);
    if (result?.pinned !== undefined && result.pinned !== pinBanner) {
      pinBanner = result.pinned === true;
      updatePinBannerToggle();
      if (!pinBanner) {
        scheduleAutoHideForSuccessfulBanner();
      }
    }
  }

  function scheduleAutoHideForSuccessfulBanner() {
    const banner = document.getElementById('magnetar-banner');
    if (!banner?.classList.contains('magnetar-success')) return;
    bannerInteractedAfterSuccess = false;
    scheduleBannerAutoHide(banner);
  }

  async function showSuccess(providerLabel, providerMode) {
    const banner = document.getElementById('magnetar-banner');
    if (!banner) return;
    bannerInteractedAfterSuccess = false;
    banner.classList.add('magnetar-success');
    const btn = document.getElementById('magnetar-send');
    const label = btn?.querySelector('.magnetar-btn-label');
    const spinner = btn?.querySelector('.magnetar-btn-spinner');
    if (spinner) spinner.style.display = 'none';
    if (label) {
      label.textContent = getSentLabel(providerMode);
      label.style.display = 'inline';
    }
    if (btn) {
      btn.disabled = true;
      delete btn.dataset.retryProvider;
      btn.classList.add('magnetar-btn-sent');
    }
    lastSentProvider = providerMode;
    const quickSendToggle = banner.querySelector('#magnetar-quick-send-toggle');
    if (quickSendToggle) {
      const hasOtherTargets = getPostSendQuickSendProviders().length > 0;
      quickSendToggle.disabled = !hasOtherTargets;
      quickSendToggle.hidden = !hasOtherTargets;
      quickSendToggle.setAttribute('aria-expanded', 'false');
    }
    document.getElementById('magnetar-quick-send-menu')?.remove();
    ensureSentStatus(banner);
    await showOpenProviderAction(providerMode, banner);
    showToast(providerLabel ? `Sent to ${providerLabel}` : t('sentSuccessfully'));
    scheduleBannerAutoHide(banner);
  }

  function showError(message, providerMode = mode) {
    clearBannerAutoHide();
    const btn = document.getElementById('magnetar-send');
    if (!btn) return;
    const label = btn.querySelector('.magnetar-btn-label');
    const spinner = btn.querySelector('.magnetar-btn-spinner');
    btn.dataset.retryProvider = providerMode;
    btn.classList.remove('magnetar-btn-sent');
    if (label) { label.textContent = t('retryButton'); label.style.display = 'inline'; }
    if (spinner) spinner.style.display = 'none';
    btn.disabled = false;
    btn.classList.add('magnetar-btn-error');
    showToast(message, true);
    setTimeout(() => {
      btn.classList.remove('magnetar-btn-error');
    }, 3000);
  }

  function showToast(message, isError = false) {
    const existing = document.getElementById('magnetar-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'magnetar-toast';
    if (isError) toast.classList.add('magnetar-toast-error');
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('magnetar-toast-visible'));
    setTimeout(() => {
      toast.classList.remove('magnetar-toast-visible');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  function clearBannerAutoHide() {
    if (bannerAutoHideTimer) {
      clearTimeout(bannerAutoHideTimer);
      bannerAutoHideTimer = null;
    }
  }

  function scheduleBannerAutoHide(banner) {
    clearBannerAutoHide();
    if (isAdvancedMode && pinBanner) return;
    bannerAutoHideTimer = setTimeout(() => {
      bannerAutoHideTimer = null;
      const currentBanner = document.getElementById('magnetar-banner');
      if (!currentBanner || currentBanner !== banner) return;
      if (bannerInteractedAfterSuccess) return;
      if (document.getElementById('magnetar-quick-send-menu') || document.getElementById('magnetar-share-menu') || document.getElementById('magnetar-manual-menu')) {
        scheduleBannerAutoHide(currentBanner);
        return;
      }
      dismissBanner();
    }, 3600);
  }

  function dismissBanner() {
    const banner = document.getElementById('magnetar-banner');
    if (!banner) return;
    banner.classList.remove('magnetar-visible');
    banner.classList.add('magnetar-hiding');
    setTimeout(() => banner.remove(), 300);
    if (result?.hash) {
      if (!window._magnetarDismissed) window._magnetarDismissed = [];
      if (!window._magnetarDismissed.includes(result.hash)) {
        window._magnetarDismissed.push(result.hash);
      }
    }
  }

  function updateCacheBadge(status) {
    const badge = document.getElementById('magnetar-cache');
    if (!badge) return;
    const dot = badge.querySelector('.magnetar-cache-dot');
    const text = badge.querySelector('.magnetar-cache-text');
    dot.classList.remove('magnetar-cache-loading');
    if (status === 'cached') {
      dot.classList.add('magnetar-cache-cached');
      text.textContent = t('cacheCached');
    } else if (status === 'not_cached') {
      dot.classList.add('magnetar-cache-not-cached');
      text.textContent = t('cacheNotCached');
    } else {
      dot.classList.add('magnetar-cache-unknown');
      text.textContent = t('cacheUnknown');
    }
    document.querySelectorAll('[data-detection-detail="cache"]').forEach(el => {
      const label = formatCacheStatus(status);
      el.textContent = label;
      el.title = label;
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Review prompt ──
  function showReviewPrompt() {
    if (document.getElementById('magnetar-review-prompt')) return;
    const prompt = document.createElement('div');
    prompt.id = 'magnetar-review-prompt';
    if (theme === 'light') prompt.classList.add('magnetar-theme-light');
    prompt.innerHTML = `
      <div class="magnetar-review-inner">
        <span class="magnetar-review-text">200 sends in. If Magnetar's earned a spot in your toolbox, a quick review or coffee would mean a lot.</span>
        <div class="magnetar-review-btns">
          <a class="magnetar-btn magnetar-btn-primary magnetar-review-btn" href="${STORE_URL}" target="_blank" id="magnetar-review-yes">⭐ Rate</a>
          <a class="magnetar-btn magnetar-btn-secondary magnetar-review-btn" href="${COFFEE_URL}" target="_blank" id="magnetar-review-coffee">☕ Coffee</a>
          <button class="magnetar-btn magnetar-btn-cancel" id="magnetar-review-dismiss">Not now</button>
        </div>
      </div>
    `;
    document.body.appendChild(prompt);
    requestAnimationFrame(() => prompt.classList.add('magnetar-visible'));

    // Any of the three actions permanently dismisses — the user shouldn't
    // see this prompt again whether they rated, donated, or declined.
    const dismiss = () => {
      safeRuntimeMessage({ type: 'dismiss-review-prompt' });
      prompt.classList.remove('magnetar-visible');
      setTimeout(() => prompt.remove(), 300);
    };
    prompt.querySelector('#magnetar-review-yes')?.addEventListener('click', dismiss);
    prompt.querySelector('#magnetar-review-coffee')?.addEventListener('click', dismiss);
    prompt.querySelector('#magnetar-review-dismiss')?.addEventListener('click', dismiss);
  }

})();
