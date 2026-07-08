/**
 * Magnetar � Content Script
 * 
 * Runs on every page. Two banner modes + batch panel:
 * 1. Full banner � name, cache, Send, Share, Copy Magnet, Copy Hash, ?
 * 2. Compact banner � Send + ? only
 * 3. Batch mode � checkbox table for multi-hash pages
 */

(async () => {
  if (!document.body) return;
  if (document.contentType && !document.contentType.includes('html')) return;
  if (window !== window.top) return;

  // -- i18n helper --
  const t = (key, ...subs) => {
    const msg = MAGNETAR_API.i18n.getMessage(key, subs);
    return msg || key;
  };

  const ORGANISED_FOLDER_COLORS = [
    { id: 'default', label: 'Default' },
    { id: 'sage', label: 'Sage' },
    { id: 'blue', label: 'Blue' },
    { id: 'lavender', label: 'Lavender' },
    { id: 'rose', label: 'Rose' },
    { id: 'peach', label: 'Peach' },
    { id: 'yellow', label: 'Yellow' },
    { id: 'grey', label: 'Grey' }
  ];
  const ORGANISED_FOLDER_COLOR_IDS = new Set(ORGANISED_FOLDER_COLORS.map(entry => entry.id));
  const MAGNETAR_WHATS_NEW_VERSION = '2.2';
  let whatsNewTourVisible = false;
  let whatsNewAutoCheckDone = false;

  function normaliseOrganisedFolderColor(value) {
    const clean = String(value || '').trim().toLowerCase();
    return ORGANISED_FOLDER_COLOR_IDS.has(clean) ? clean : 'default';
  }
  function safeRuntimeMessage(message, fallback) {
    try {
      return MAGNETAR_API.runtime.sendMessage(message).catch(() => fallback);
    } catch (e) {
      return Promise.resolve(fallback);
    }
  }

  function getAllDebridOpenTaskId() {
    if (!/(^|\.)alldebrid\.com$/i.test(window.location.hostname)) return '';
    if (!/^\/service\/?$/i.test(window.location.pathname)) return '';
    const hash = String(window.location.hash || '').replace(/^#/, '');
    const params = new URLSearchParams(hash);
    return params.get('magnetar-ad-open') || '';
  }

  function runInPageContext(source) {
    const script = document.createElement('script');
    script.textContent = `;(() => { try { ${source} } catch (e) { console.warn('Magnetar: AllDebrid service action failed.'); } })();`;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  }

  function updateAllDebridBridgeStatus(message, data = {}) {
    const safeData = Object.fromEntries(Object.entries(data).filter(([key]) => !/link|url|token|key|auth/i.test(key)));
    console.debug('Magnetar AllDebrid service bridge', { step: message, ...safeData });
  }

  function waitForAllDebridElement(selector, timeoutMs = 10000) {
    const existing = document.querySelector(selector);
    if (existing) return Promise.resolve(existing);
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeoutMs);
      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) {
          clearTimeout(timer);
          observer.disconnect();
          resolve(found);
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  async function handleAllDebridOpenBridge() {
    const taskId = getAllDebridOpenTaskId();
    if (!taskId) return false;
    updateAllDebridBridgeStatus('task id found', { taskIdFound: true });

    const result = await safeRuntimeMessage(
      { type: 'consume-alldebrid-open-task', taskId },
      { success: false, error: 'Could not open AllDebrid item.' }
    );
    const task = result?.task;
    const links = Array.isArray(task?.links) ? task.links.filter(link => /^https:\/\/(?:www\.)?alldebrid\.com\/f\//i.test(String(link || ''))) : [];
    if (!result?.success || task?.provider !== 'alldebrid' || task?.action !== 'open' || links.length < 1) {
      updateAllDebridBridgeStatus('task load failed', { taskLoaded: false });
      console.warn('Magnetar: could not open AllDebrid item.');
      return true;
    }
    updateAllDebridBridgeStatus('task loaded', {
      taskLoaded: true,
      expectedLinkCount: Number(task.expectedLinkCount) || links.length
    });

    const textarea = await waitForAllDebridElement('textarea#links, textarea[name="links"]', 10000);
    if (!textarea) {
      updateAllDebridBridgeStatus('textarea not found', { textareaFound: false });
      console.warn('Magnetar: AllDebrid service links textarea was not found.');
      return true;
    }
    updateAllDebridBridgeStatus('textarea found', { textareaFound: true });

    textarea.value = links.join('\n');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    const expectedLinkCount = Math.max(Number(task.expectedLinkCount) || 0, links.length);
    const textareaLinkCount = textarea.value.split(/\n+/).map(link => link.trim()).filter(Boolean).length;
    updateAllDebridBridgeStatus('textarea filled', { expectedLinkCount, textareaLinkCount });
    if (textareaLinkCount !== expectedLinkCount) {
      updateAllDebridBridgeStatus('textarea count mismatch', { expectedLinkCount, textareaLinkCount });
      console.warn('Magnetar: AllDebrid service did not receive every file link.');
      return true;
    }

    runInPageContext(`
      let started = false;
      const available = typeof window.processLinks === 'function';
      document.documentElement.setAttribute('data-magnetar-ad-process-available', available ? '1' : '0');
      if (typeof window.processLinks === 'function') {
        window.processLinks();
        started = true;
      } else {
        const button = document.querySelector('#giveMeMyLinks');
        if (button) {
          button.click();
          started = true;
        }
      }
      if (started) document.documentElement.setAttribute('data-magnetar-ad-process-started', '1');
    `);
    await new Promise(resolve => setTimeout(resolve, 250));
    const processAvailable = document.documentElement.getAttribute('data-magnetar-ad-process-available') === '1';
    let processCalled = document.documentElement.getAttribute('data-magnetar-ad-process-started') === '1';
    updateAllDebridBridgeStatus('processLinks attempted', { processAvailable, processCalled });
    if (!processCalled) {
      document.querySelector('#giveMeMyLinks')?.click();
      await new Promise(resolve => setTimeout(resolve, 250));
      processCalled = document.documentElement.getAttribute('data-magnetar-ad-process-started') === '1';
      updateAllDebridBridgeStatus('generate button fallback clicked', { processCalled });
    }
    updateAllDebridBridgeStatus('ready in AllDebrid', { expectedLinkCount, processCalled });
    return true;
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
  const HELP_URL = 'https://arrcee.com/magnetarhelp';
  const MOBILE_URL = 'https://arrcee.com/magnetar-mobile';
  const MAGNETAR_LOGO_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAC4jAAAuIwF4pT92AAAFJUlEQVRogd2aW0wUVxjHf2d2WZZdLgJRBBRMjGms1qKUmGKDFq2XKoLFl7baVm2taVRqWn1u4qO1FmmsNaVttG36UC26CkhvNtY2MVJprNfEFhBBFOXmsrCXOc0MO2SX6BOLzPpPJjPnzJzJ77/nmzPfnjNCSsnDJIRIA4qAQuAJICl46uGNRiYR3HcDV4FfAJeUsv2hLTQDwzcgAdgVvJEc4607yJLwQNYHwM8HGk0ALodtGtP84bwiNISEECu0LgvtoZkznmTr5k3MmDGdxEStYwZNj0r8iMEI6unp5eLFy+z9ZD//XLw0/LIiKeXxoTYGjBDiWeAP40RKSjKf7SvnxWWLGUtV19Tx9jtl3LvXGVqdL6X8c8iAEMIOtACpWmV21mR+OnmMjIx0zKDW1jYWLVlJU/MNo+ouMElK2a8EK3Ya8PHx8VQfP2waeE0ai8aksQWVGmRGEUKMA7YYZw7sL2dKdhZm05TsLJ0tRFs0dq0HSoBYrSZ3Tg7FRcsxq4qLluuMQWnMJZqBpUbNhnWvYXZtCGdcqhmYbpRyc4fcmVa54YzTNQNOo+RwODC7HOGMTmMUilopoYnZaL1hIykZzigfix4YNRm5TVQakGqAuIREHE6HfhxVBqSUOBJSuHC+gX+v/4fdMZjFRo2BGKsFYbGztex9Dh76FostASnV6DAgVRWbM5WbTVc5dfoMNbV1+kBntzuiw4DFatFvu3vPXr189tx5fq5zYYlNQqp+cxuQagB7/ATqz55hT/k+UpKTsCiCrWXbQfpwjstEDQTMZ0BKlZgYK85xGdxouk7JqlIUAfFOB+kT07h05RqlpS/p18YnZ+hTD5F6JpSRkavExdlxJqUTE5fK0arD5OfPo6W1nUmZ6fj9AX1ESk8bz5EfjrO4sIBrVy4Ql5imt7FaLfozMyYGtHeUYo2ls8tN7YljlK4qpmTVatra2skKwusepURRFDLT0/jx19Pk5c1l+3vb+LvhHF4/WGOsY2Mgxh5Pd4+bzZvfZdmKYo5UHWN8ajKZmRn4h8W5MQUyJWsSA14/H370MTmz8/h0/+fYYuOw2WyP3oDP48bpsLFz5wcc/KqS+QXPceduJ7dv39FDY3hKYVEUGptb8Hp9rHn1FWqqXaxd8zL9/f34fL5Hb0CiogjJ1GnZrH19Pad+O80XlQeItdtobmnDag0JDSm50XqLvNxZnPn9FIe+/oaly1YwPiURNeAbURY8ggAcTNT6eu+jqt04HE7WrX+LvNzZLCh8gbZb7UxMmzAEv6iwgNqTJ7FY7Qy47+D3+xFC0bcxH0YVxYLH46Gvp42ZTz/Dke+/w+cP4PH0c+t2B1lZk3G5XDr8/a5WAgF1xOARf5ENps4KA+4OCp5fwsY336DjXic+v5+K8l3YHYm4u27qZk2dSviDD+SOHdv0fW7OU6wsWU3A24NQRjZkPkgRv6NQFLx9HUydNou8OTksXLhAy5Do97gjFjahivxPog2xPh826aVi7259Rlv1jQ78qBnQYN09Hcydlw8BH+7ebkSEYz/UgBiN/7BCWPD09gweRxBehDOKUemBRzlNowBuo9DX14fZ1RfO6NYMXDZK9fUNmF314YyXNQO1Rqnyy4OYXZXhjLWagSpgQCvV/9XAUdcJzKqjrhM6Y1Aac5UipewCKozajZvKaGxqxmxqbGrW2UJUobE/Hot8Usr+4CcFurQL584r1Jc4x1rVNXU6Swi8sVasMUf/QjfR/qkB0f6xh4j2z23+B0ZTCG8RPV3dAAAAAElFTkSuQmCC';

  // -- Get settings --
  let settings;
  try {
    settings = await MAGNETAR_API.runtime.sendMessage({ type: 'get-settings' });
  } catch (e) {
    return;
  }

  if (await handleAllDebridOpenBridge()) return;

  const customSites = settings?.customSites || [];
  const bannerEnabled = settings?.preferences?.bannerEnabled !== false;
  const bannerStyle = settings?.preferences?.bannerStyle || 'full'; // 'full' or 'compact'
  let batchMode = settings?.preferences?.batchMode === true;
  let batchMax = settings?.preferences?.batchMax || 25;
  const bannerPosition = settings?.preferences?.bannerPosition || 'top';
  const mode = settings?.mode || 'local';
  let theme = settings?.preferences?.theme === 'dark' ? 'dark' : 'light';
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

  // -- Run detection --
  const genericResult = siteIgnored ? null : MagnetarDetector.detect(customSites);
  const extToResult = !siteIgnored && (!genericResult?.hash || genericResult.lowConfidence || genericResult.noHash)
    ? await detectExtToMagnet()
    : null;
  const result = extToResult || genericResult;

  const allMagnets = siteIgnored ? [] : MagnetarDetector.detectAll();

  const category = siteIgnored ? null : MagnetarCategories.detect();
  if (result) result.category = category;

  // Report to background
  safeRuntimeMessage({ type: 'detection-result', data: result });

  MAGNETAR_API.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'open-toolbar') return Promise.resolve(openToolbarFromPopup());
    if (msg?.type === 'open-sync-panel') return Promise.resolve(openSyncPanelWithNotice(''));
    return undefined;
  });

  if (siteIgnored) return;

  // -- Batch mode: show panel if multiple magnets found --
  const batchMagnets = getBatchMagnets();
  if (isBatchModeActive() && batchMagnets.length > 0) {
    const limited = batchMagnets.slice(0, batchMax);
    injectBatchPanel(limited, batchMagnets.length, mode);
    return;
  }

  // -- Single hash logic --
  if (!result || !result.hash || result.lowConfidence) return;
  if (!bannerEnabled) return;
  if (window._magnetarDismissed && window._magnetarDismissed.includes(result.hash)) return;

  // -- Duplicate detection --
  let alreadySent = false;
  try {
    const histCheck = await safeRuntimeMessage({ type: 'check-single-history', hash: result.hash }, null);
    alreadySent = histCheck?.inHistory === true;
  } catch (e) {}
  if (result) result.alreadySent = alreadySent;

  // -- Cache check --
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

  // -- Inject banner --
  injectBanner(result, mode, category);


  // ------------------------------------------------------------------------
  // BANNER (Full + Compact modes)
  // ------------------------------------------------------------------------

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
    banner.querySelector('#magnetar-banner-client-mode')?.addEventListener('change', (e) => {
      toggleClientPanel(detection, e.target.checked);
    });
    banner.querySelector('#magnetar-banner-sync-mode')?.addEventListener('click', (e) => {
      e.preventDefault();
      syncPanelNotice = '';
      toggleSyncPanel();
    });
    banner.querySelector('#magnetar-app-review')?.addEventListener('click', (e) => {
      e.preventDefault();
      handleAppReview(detection);
    });
    banner.querySelector('#magnetar-dismiss')?.addEventListener('click', () => dismissBanner());
    banner.querySelector('#magnetar-banner-settings')?.addEventListener('click', (e) => {
      e.preventDefault();
      safeRuntimeMessage({ type: 'open-options' });
    });
    banner.querySelector('#magnetar-mobile-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      safeRuntimeMessage({ type: 'open-external-url', url: MOBILE_URL });
    });
    banner.querySelector('#magnetar-sync-pull-latest')?.addEventListener('click', (e) => {
      e.preventDefault();
      handlePullSyncSavedHistory(e);
    });
    if (!isManualShell && (detection?.hash || detection?.magnetUri)) {
      const detectionKey = "detection:" + window.location.href + ":" + (detection.hash || detection.magnetUri);
      queueDetectionAutoPull('hash-detected', detectionKey);
    }
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
    bindWhatsNewOpeners(banner);
    maybeShowWhatsNewTour('auto').catch(() => {});
    updateExpandedToggleState();

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
          // If the saved/activity panel is open, refresh its saved list.
          if (expandedBuilt && activeExpandedPanel === 'details') {
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

  async function detectExtToMagnet() {
    if (!/(^|\.)ext\.to$/i.test(window.location.hostname)) return null;
    const detail = getExtToDetailInfo();
    if (!detail) return null;

    const display = document.querySelector('#torrent-hash-display');
    const button = document.querySelector('#show-hash-btn[data-id]');
    if (!display || !button) return null;
    if (String(button.dataset.id || '') !== detail.id) return null;

    const existingHash = extractExtToHash(display.textContent || '');
    if (existingHash) return buildExtToDetection(existingHash);

    const revealKey = `${detail.id}:${detail.code}`;
    if (window._magnetarExtToRevealKey === revealKey) return null;
    window._magnetarExtToRevealKey = revealKey;

    const hash = await revealExtToHash(button, display);
    if (hash) return buildExtToDetection(hash);
    return null;
  }

  function getExtToTitle() {
    const titleNode = document.querySelector('h1, .torrent-title, [itemprop="name"]');
    const title = titleNode?.textContent?.trim() || document.title;
    return title.replace(/\s*[-|:]\s*ext\.to.*$/i, '').trim();
  }

  function getExtToDetailInfo() {
    const slug = window.location.pathname
      .split('/')
      .filter(Boolean)
      .pop() || '';
    const match = slug.match(/^(.+)-(\d{2,})$/);
    if (!match) return null;
    return { id: match[2], code: match[0] };
  }

  function buildExtToDetection(hash) {
    const name = getExtToTitle();
    return {
      hash,
      magnetUri: MagnetarDetector.buildMagnet(hash, name),
      name,
      source: 'ext-to-xhr',
      confidence: 10
    };
  }

  function revealExtToHash(button, display) {
    return new Promise(resolve => {
      let done = false;
      const finish = hash => {
        if (done) return;
        done = true;
        observer.disconnect();
        clearTimeout(timer);
        resolve(hash || '');
      };

      const readHash = () => extractExtToHash(display.textContent || '');
      const observer = new MutationObserver(() => {
        const hash = readHash();
        if (hash) finish(hash);
      });
      const timer = setTimeout(() => finish(readHash()), 4500);

      observer.observe(display, { childList: true, subtree: true, characterData: true });
      try {
        button.click();
      } catch (e) {
        finish('');
      }
      const immediateHash = readHash();
      if (immediateHash) finish(immediateHash);
    });
  }

  function extractExtToHash(value) {
    const raw = String(value || '');
    const labelled = raw.match(/(?:btih|info[_ -]?hash|torrent[_ -]?hash|hash)[^a-fA-F0-9A-Z2-7]{0,20}([a-fA-F0-9]{40}|[a-fA-F0-9]{64}|[A-Z2-7]{32})/i);
    const broad = labelled || raw.match(/\b([a-fA-F0-9]{40}|[A-Z2-7]{32})\b/);
    return broad ? MagnetarDetector.normaliseHash(broad[1]) : '';
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
    if (activeExpandedPanel === 'client' && banner?.classList.contains('magnetar-expanded')) {
      populateClientPanel(result, currentQuickSendTarget, 1);
    }
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

  async function saveBatchModePreference(enabled, options = {}) {
    const previous = batchMode;
    batchMode = enabled === true;
    if (batchMode) {
      closeClientPanel();
    }
    updateBatchModeToggle();

    try {
      const current = (await MAGNETAR_API.runtime.sendMessage({ type: 'get-settings' })) || {};
      current.preferences = current.preferences || {};
      current.preferences.batchMode = batchMode;
      if (batchMode) current.preferences.bannerEnabled = true;
      await MAGNETAR_API.runtime.sendMessage({ type: 'save-settings', data: current });
      if (!batchMode) await safeRuntimeMessage({ type: 'clear-batch-session' }, null);
      if (options.render !== false) renderCurrentMode();
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

  // -- Expand / collapse (lazy-loaded dashboard panel) --
  let expandedBuilt = false;
  let activeExpandedPanel = '';
  let toolbarExpanded = false;
  let clientPanelOpen = false;
  let syncPanelOpen = false;
  let whatsNewPreviousPanel = '';
  let syncPanelNotice = "";
  const AUTO_PULL_MIN_INTERVAL_MS = 30000;
  const AUTO_PULL_FAILURE_BACKOFF_MS = 30000;
  const autoPullDetectionKeys = new Map();
  let autoPullInFlight = false;
  let lastAutoPullAt = 0;
  let autoPullBackoffUntil = 0;
  const CLIENT_PANEL_PAGE_SIZE = 25;
  const clientPanelCache = new Map();
  let currentClientPanelItems = [];
  let clientPanelView = 'provider';
  let organisedOpenFolderId = '';
  let organisedQuickviewFolderId = '';
  let organisedQuickviewPopover = null;
  let organisedQuickviewOutsideHandler = null;
  let organisedFolderFilter = '';
  let organisedFolderPage = 1;
  let organisedFilterTimer = null;
  let organisedOpenItemFilter = '';
  let organisedOpenItemSort = 'newest';
  let organisedOpenItemPage = 1;
  let organisedOpenItemPageSize = 25;
  let organisedOpenItemFilterTimer = null;
  const ORGANISED_FOLDER_PAGE_SIZE = 9;

  function setExpandedPanel(panel) {
    activeExpandedPanel = panel || '';
    toolbarExpanded = activeExpandedPanel === 'details';
    clientPanelOpen = activeExpandedPanel === 'client';
    syncPanelOpen = activeExpandedPanel === 'sync';
  }

  async function restoreAfterWhatsNew() {
    const banner = document.getElementById('magnetar-banner');
    const wrap = document.getElementById('magnetar-expanded-section');
    const previousPanel = whatsNewPreviousPanel;
    whatsNewPreviousPanel = '';
    if (!banner || !wrap) return;
    if (previousPanel === 'sync') {
      await populateSyncPanel();
      setExpandedPanel('sync');
      banner.classList.add('magnetar-expanded');
    } else if (previousPanel === 'client') {
      banner.classList.add('magnetar-expanded');
      await populateClientPanel(result, currentQuickSendTarget, 1);
    } else if (previousPanel === 'details') {
      await populateExpanded(result, mode);
      setExpandedPanel('details');
      banner.classList.add('magnetar-expanded');
    } else {
      wrap.innerHTML = '';
      setExpandedPanel('');
      banner.classList.remove('magnetar-expanded');
    }
    updateExpandedToggleState();
  }

  async function toggleBannerExpand(detection, mode) {
    const banner = document.getElementById('magnetar-banner');
    if (!banner) return;

    const isOpen = banner.classList.contains('magnetar-expanded');
    if (isOpen && toolbarExpanded) {
      banner.classList.remove('magnetar-expanded');
      setExpandedPanel('');
      updateExpandedToggleState();
      return;
    }

    const wrap = document.getElementById('magnetar-expanded-section');
    const needsExpandedContent = !toolbarExpanded || !expandedBuilt || !wrap?.innerHTML.trim();
    if (needsExpandedContent) {
      try {
        await populateExpanded(detection, mode);
        expandedBuilt = true;
        setExpandedPanel('details');
      } catch (e) {
        if (wrap && !wrap.innerHTML) {
          wrap.innerHTML = '<div class="magnetar-expanded-inner"><div class="magnetar-activity-empty">Unable to load expanded details.</div></div>';
        }
      }
    }
    banner.classList.add('magnetar-expanded');
    updateExpandedToggleState();
    maybePullLatest('expanded-open').catch(() => {});
  }

  function updateExpandedToggleState() {
    const banner = document.getElementById('magnetar-banner');
    const isOpen = banner?.classList.contains('magnetar-expanded') === true;
    const detailsOpen = isOpen && toolbarExpanded;
    const clientOpen = isOpen && clientPanelOpen;
    const expandBtn = document.getElementById('magnetar-expand');
    const clientInput = document.getElementById('magnetar-banner-client-mode');
    const clientToggle = document.querySelector('#magnetar-banner .magnetar-client-mode-toggle');
    expandBtn?.setAttribute('aria-expanded', String(detailsOpen));
    expandBtn?.classList.toggle('magnetar-btn-active', detailsOpen);
    if (clientInput) {
      clientInput.checked = clientOpen;
      clientInput.setAttribute('aria-expanded', String(clientOpen));
    }
    clientToggle?.classList.toggle('magnetar-client-mode-toggle-active', clientOpen);
  }

  function isUsableSyncSettings(settings) {
    return !!(settings?.enabled && settings.syncId && settings.syncToken && settings.encryptionKey);
  }

  function queueDetectionAutoPull(reason, detectionKey) {
    try {
      maybePullLatest(reason || 'detection', { detectionKey }).catch(() => {});
    } catch (e) {}
  }

  async function refreshAfterPull(pullResult) {
    if (!pullResult?.ok || pullResult.skipped) return;
    if (syncPanelOpen) await populateSyncPanel();
    else if (clientPanelOpen) await populateClientPanel(result, currentQuickSendTarget, 1);
    else if (activeExpandedPanel === 'details') await populateExpanded(result, mode);
  }

  async function forcePullLatest(reason = 'toolbar-button') {
    const pullResult = await safeRuntimeMessage({ type: 'sync-pull-saved-history', reason }, null);
    await refreshAfterPull(pullResult);
    return pullResult;
  }

  async function maybePullLatest(reason, options = {}) {
    const now = Date.now();
    try {
      const detectionKey = options.detectionKey || '';
      if (detectionKey) {
        const lastForKey = autoPullDetectionKeys.get(detectionKey) || 0;
        if (lastForKey && now - lastForKey < AUTO_PULL_MIN_INTERVAL_MS) {
          console.debug('Magnetar Sync: auto pull skipped', { reason, status: 'throttled-page' });
          return { ok: false, skipped: true, reason: 'throttled-page' };
        }
        autoPullDetectionKeys.set(detectionKey, now);
      }
      const settings = await safeRuntimeMessage({ type: 'get-sync-settings' }, null);
      if (!isUsableSyncSettings(settings)) {
        console.debug('Magnetar Sync: auto pull skipped', { reason, status: 'unpaired' });
        return { ok: false, skipped: true, reason: 'unpaired' };
      }
      if (autoPullInFlight) {
        console.debug('Magnetar Sync: auto pull skipped', { reason, status: 'in-flight' });
        return { ok: false, skipped: true, reason: 'in-flight' };
      }
      if (now < autoPullBackoffUntil) {
        console.debug('Magnetar Sync: auto pull skipped', { reason, status: 'backoff' });
        return { ok: false, skipped: true, reason: 'backoff' };
      }
      if (lastAutoPullAt && now - lastAutoPullAt < AUTO_PULL_MIN_INTERVAL_MS) {
        console.debug('Magnetar Sync: auto pull skipped', { reason, status: 'throttled' });
        return { ok: false, skipped: true, reason: 'throttled' };
      }
      autoPullInFlight = true;
      console.debug('Magnetar Sync: auto pull started', { reason });
      const pullResult = await forcePullLatest(reason || 'event');
      if (pullResult?.ok) {
        lastAutoPullAt = Date.now();
        autoPullBackoffUntil = 0;
        console.debug('Magnetar Sync: auto pull completed', {
          reason,
          savedCount: pullResult.savedCount || 0,
          historyCount: pullResult.historyCount || 0
        });
      } else {
        autoPullBackoffUntil = Date.now() + AUTO_PULL_FAILURE_BACKOFF_MS;
        console.debug('Magnetar Sync: auto pull failed', { reason, error: pullResult?.error || 'unknown' });
      }
      return pullResult;
    } catch (e) {
      autoPullBackoffUntil = Date.now() + AUTO_PULL_FAILURE_BACKOFF_MS;
      console.debug('Magnetar Sync: auto pull failed', { reason, error: e?.message || 'unknown' });
      return { ok: false, error: e?.message || 'Auto pull failed.' };
    } finally {
      autoPullInFlight = false;
    }
  }
  function appReviewSourceDomain() {
    try { return new URL(window.location.href).hostname.replace(/^www\./, ''); } catch { return ''; }
  }

  function buildAppReviewItem(detection) {
    const hash = String(detection?.hash || '').trim();
    const magnet = String(detection?.magnetUri || '').trim();
    const title = String(detection?.name || document.title || 'Review item').trim();
    return {
      title,
      hash,
      infoHash: hash,
      magnet,
      sourceUrl: window.location.href,
      sourceDomain: appReviewSourceDomain(),
      status: 'pending',
      addedAt: Date.now()
    };
  }

  function buildBatchAppReviewItem(item) {
    const hash = String(item?.hash || '').trim();
    const magnet = String(item?.magnetUri || item?.magnet || '').trim();
    return {
      title: String(item?.name || item?.title || 'Review item').trim(),
      hash,
      infoHash: hash,
      magnet,
      sourceUrl: window.location.href,
      sourceDomain: appReviewSourceDomain(),
      status: 'pending',
      addedAt: Date.now()
    };
  }

  async function openSyncPanelWithNotice(message) {
    syncPanelNotice = message;
    document.getElementById('magnetar-batch')?.remove();
    if (!document.getElementById('magnetar-banner')) {
      injectBanner(hasValidSingleDetection() ? result : createManualShellDetection(), mode, category);
    }
    if (!syncPanelOpen || !document.getElementById('magnetar-banner')?.classList.contains('magnetar-expanded')) {
      await toggleSyncPanel();
    } else {
      await populateSyncPanel();
    }
  }
  async function handleAppReview(detection) {
    const settings = await safeRuntimeMessage({ type: 'get-sync-settings' }, null);
    if (!isUsableSyncSettings(settings)) {
      await openSyncPanelWithNotice('Pair Magnetar Mobile to use Send to mobile. Send items from your browser straight to your phone\'s Review queue.');
      return;
    }
    const result = await safeRuntimeMessage({ type: 'sync-send-app-review', item: buildAppReviewItem(detection) }, null);
    if (result?.ok) {
      const count = Number(result.appReviewSendCount || 0);
      showToast(count > 0 && count <= 3 ? 'Sent to Magnetar Mobile Review. Open the app\'s Review tab to continue.' : 'Sent to mobile');
      return;
    }
    showToast(result?.error || 'Could not send to mobile', true);
  }

  async function toggleSyncPanel() {
    const banner = document.getElementById('magnetar-banner');
    const wrap = document.getElementById('magnetar-expanded-section');
    if (!banner || !wrap) return;
    const isOpen = banner.classList.contains('magnetar-expanded');
    if (isOpen && syncPanelOpen) {
      banner.classList.remove('magnetar-expanded');
      setExpandedPanel('');
      updateExpandedToggleState();
      return;
    }
    closeClientPanel();
    await populateSyncPanel();
    setExpandedPanel('sync');
    banner.classList.add('magnetar-expanded');
    updateExpandedToggleState();
    maybePullLatest('panel-open').catch(() => {});
  }

  function buildSyncPairingPayloadFromSettings(settings) {
    if (!isUsableSyncSettings(settings)) return null;
    return {
      type: 'magnetar-sync-pairing',
      version: 1,
      serverUrl: settings.serverUrl || 'https://sync.arrcee.com',
      syncId: settings.syncId,
      syncToken: settings.syncToken,
      encryptionKey: settings.encryptionKey
    };
  }

  async function populateSyncPanel() {
    const wrap = document.getElementById('magnetar-expanded-section');
    if (!wrap) return;
    const settings = await safeRuntimeMessage({ type: 'get-sync-settings' }, null);
    const autoStatus = await safeRuntimeMessage({ type: 'get-sync-auto-status' }, null);
    const mobileAck = await safeRuntimeMessage({ type: 'get-sync-mobile-ack' }, null);
    const paired = isUsableSyncSettings(settings);
    const mobileAcknowledged = paired && !!mobileAck?.paired;
    const syncStatusLabel = mobileAcknowledged ? 'Magnetar Mobile paired' : (paired ? 'Waiting for Magnetar Mobile' : 'Not paired');
    const pairingPayload = buildSyncPairingPayloadFromSettings(settings);
    let pairingQr = '';
    if (pairingPayload && globalThis.MagnetarSyncQr?.renderPairingSvg) {
      try {
        pairingQr = globalThis.MagnetarSyncQr.renderPairingSvg(pairingPayload);
      } catch (e) {
        pairingQr = '';
      }
    }
    const lastSyncAt = settings?.lastSyncAt || autoStatus?.lastSuccessAt;
    const pairingContent = paired ? `
        <div class="magnetar-sync-card magnetar-sync-how-card">
          <div class="magnetar-sync-card-label">how to pair</div>
          <div class="magnetar-sync-copy"><strong>Open Magnetar Mobile</strong></div>
          <div class="magnetar-sync-copy">Settings &gt; Sync &gt; Scan QR</div>
          <div class="magnetar-sync-copy">Then scan this code.</div>
          <div class="magnetar-sync-scope">Syncs saved, sent and customised folder details. Provider API keys are never synced.</div>
        </div>
        <div class="magnetar-sync-card magnetar-sync-qr-card">
          <div class="magnetar-sync-card-label">qr code</div>
          <div class="magnetar-sync-qr-wrap">${pairingQr || '<div class="magnetar-sync-qr-error">QR unavailable. Use the pairing code fallback.</div>'}</div>
        </div>
        <div class="magnetar-sync-card magnetar-sync-pairing-card">
          <div class="magnetar-sync-card-label">pairing</div>
          <div class="magnetar-sync-actions magnetar-sync-pairing-actions">
            <button type="button" class="magnetar-btn magnetar-btn-secondary magnetar-sync-copy-code" id="magnetar-sync-copy-pairing">Copy pairing code</button>
            <button type="button" class="magnetar-btn magnetar-btn-secondary magnetar-sync-reset" id="magnetar-sync-reset-pairing">Reset pairing</button>
          </div>
          <div class="magnetar-sync-warning">This code can pair another device. Only show it to your own phone.</div>
        </div>` : `
        <div class="magnetar-sync-card magnetar-sync-how-card">
          <div class="magnetar-sync-card-label">how to pair</div>
          <div class="magnetar-sync-copy"><strong>Open Magnetar Mobile</strong></div>
          <div class="magnetar-sync-copy">Settings &gt; Sync &gt; Scan QR</div>
          <div class="magnetar-sync-copy">Create a private pairing code here, then scan it.</div>
          <div class="magnetar-sync-scope">Syncs saved, sent and customised folder details. Provider API keys are never synced.</div>
        </div>
        <div class="magnetar-sync-card magnetar-sync-qr-card magnetar-sync-qr-placeholder">
          <div class="magnetar-sync-card-label">qr code</div>
          <div class="magnetar-sync-empty-qr">Pairing code not created yet.</div>
        </div>
        <div class="magnetar-sync-card magnetar-sync-pairing-card">
          <div class="magnetar-sync-card-label">pairing</div>
          <div class="magnetar-sync-copy">Create a pairing QR for the Android app.</div>
          <div class="magnetar-sync-copy">Saved items and history sync encrypted. Provider API keys are never synced.</div>
          <div class="magnetar-sync-actions magnetar-sync-pairing-actions">
            <button type="button" class="magnetar-btn magnetar-btn-primary" id="magnetar-sync-create-pairing">Create pairing QR</button>
          </div>
        </div>`;

    wrap.innerHTML = `
      <div class="magnetar-expanded-inner magnetar-sync-panel">
        <div class="magnetar-section-heading magnetar-sync-heading">
          <span>MAGNETAR SYNC</span>
          <span class="magnetar-sync-status ${mobileAcknowledged ? 'magnetar-sync-status-online' : (paired ? 'magnetar-sync-status-muted' : 'magnetar-sync-status-warning')}">${syncStatusLabel}</span>
        </div>
        ${syncPanelNotice ? `<div class="magnetar-sync-app-review-note">${escapeHtml(syncPanelNotice)}</div>` : ''}
        <div class="magnetar-sync-mobile-strip">
          <span>To sync Magnetar, you&rsquo;ll need the Magnetar Mobile app for Android.</span>
          <button type="button" class="magnetar-btn magnetar-btn-secondary magnetar-sync-mobile-link" id="magnetar-sync-mobile-link">Get Magnetar Mobile</button>
        </div>
        <div class="magnetar-sync-grid">
          ${pairingContent}
        </div>
        <div class="magnetar-sync-card magnetar-sync-data-card">
          <div class="magnetar-sync-data-copy">
            <div class="magnetar-sync-card-label">sync data</div>
            <div class="magnetar-sync-copy">Saved, sent and folder details sync automatically after changes.</div>
            ${paired ? '<div class="magnetar-sync-meta-line magnetar-sync-auto-line">Auto sync: On</div>' : '<div class="magnetar-sync-meta-line">Pair Magnetar Mobile before syncing.</div>'}
            ${lastSyncAt ? `<div class="magnetar-sync-meta-line">Last synced: ${escapeHtml(new Date(lastSyncAt).toLocaleString())}</div>` : ''}
            <div class="magnetar-sync-meta-line magnetar-sync-push-status"></div>
          </div>
          <div class="magnetar-sync-actions magnetar-sync-data-actions">
            <button type="button" class="magnetar-btn magnetar-btn-secondary magnetar-sync-pull" id="magnetar-sync-pull-panel" ${paired ? '' : 'disabled'}>Pull sync</button>
            <button type="button" class="magnetar-btn magnetar-btn-secondary magnetar-sync-push" id="magnetar-sync-push-saved-history" ${paired ? '' : 'disabled'}>Push sync</button>
          </div>
        </div>
        <div class="magnetar-sync-privacy magnetar-sync-privacy-foot"><strong>Encrypted end-to-end.</strong> Saved items, sent history and folder details are encrypted before sync. Provider API keys are never synced.</div>
      </div>
    `;
    wrap.querySelector('#magnetar-sync-mobile-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      safeRuntimeMessage({ type: 'open-external-url', url: MOBILE_URL });
    });
    wrap.querySelector('#magnetar-sync-pull-panel')?.addEventListener('click', handlePullSyncSavedHistory);
    wrap.querySelector('#magnetar-sync-push-saved-history')?.addEventListener('click', handlePushSyncSavedHistory);
    wrap.querySelector('#magnetar-sync-create-pairing')?.addEventListener('click', handleCreateSyncPairing);
    wrap.querySelector('#magnetar-sync-copy-pairing')?.addEventListener('click', handleCopySyncPairingCode);
    wrap.querySelector('#magnetar-sync-reset-pairing')?.addEventListener('click', handleResetSyncPairing);
  }
  async function handleCreateSyncPairing(e) {
    const button = e?.currentTarget;
    const original = button?.textContent;
    if (button) { button.disabled = true; button.textContent = 'Creating...'; }
    const result = await safeRuntimeMessage({ type: 'create-sync-pairing' }, null);
    if (result?.ok) {
      syncPanelNotice = 'Pairing code ready. Scan it in Magnetar Mobile.';
      await populateSyncPanel();
      return;
    }
    if (button) { button.disabled = false; button.textContent = original || 'Create pairing QR'; }
    showToast(result?.error || 'Could not create pairing code', true);
  }

  async function handleCopySyncPairingCode() {
    const settings = await safeRuntimeMessage({ type: 'get-sync-settings' }, null);
    const payload = buildSyncPairingPayloadFromSettings(settings);
    if (!payload || !globalThis.MagnetarSyncQr?.encodePairingPayload) {
      showToast('Pairing code is unavailable', true);
      return;
    }
    try {
      await navigator.clipboard.writeText(globalThis.MagnetarSyncQr.encodePairingPayload(payload));
      showToast('Pairing code copied');
    } catch (e) {
      showToast('Could not copy pairing code', true);
    }
  }

  async function handleResetSyncPairing() {
    if (!(await showMagnetarConfirmDialog({ title: 'Reset pairing', message: 'Reset Magnetar Mobile pairing on this browser?', confirmLabel: 'Reset', destructive: true }))) return;
    await safeRuntimeMessage({ type: 'clear-sync-settings' }, null);
    syncPanelNotice = 'Pairing reset on this browser.';
    await populateSyncPanel();
  }
  async function handlePullSyncSavedHistory(e) {
    const button = e?.currentTarget;
    const wrap = document.getElementById('magnetar-expanded-section');
    const statusNode = wrap?.querySelector('.magnetar-sync-push-status');
    const isIconButton = !!button?.classList?.contains('magnetar-btn-sync-pull');
    const original = isIconButton ? '' : (button?.textContent || '');
    const restoreButton = () => {
      if (!button) return;
      button.disabled = false;
      button.classList.remove('magnetar-sync-pull-active');
      if (isIconButton) button.innerHTML = syncPullIconSvg();
      else if (original) button.textContent = original;
      button.title = 'Pull latest sync';
      button.setAttribute('aria-label', 'Pull latest sync');
    };
    if (button) {
      button.disabled = true;
      button.classList.add('magnetar-sync-pull-active');
      if (isIconButton) button.innerHTML = syncPullIconSvg();
      else if (original) button.textContent = 'Pulling...';
      button.title = 'Pulling latest...';
      button.setAttribute('aria-label', 'Pulling latest sync');
    }
    if (statusNode) statusNode.textContent = 'Pulling latest saved items and history...';
    const pullResult = await forcePullLatest('toolbar-button');
    if (pullResult?.ok) {
      const message = pullResult.empty ? 'Nothing synced yet' : `Synced ${pullResult.savedCount || 0} saved and ${pullResult.historyCount || 0} history items`;
      showToast(message);
      restoreButton();
      if (syncPanelOpen) await populateSyncPanel();
      else if (activeExpandedPanel === 'details') await populateExpanded(result, mode);
      return;
    }
    restoreButton();
    if (statusNode) statusNode.textContent = pullResult?.error || 'Sync pull failed.';
    showToast(pullResult?.error ? `Sync failed: ${pullResult.error}` : 'Could not sync', true);
  }
  async function handlePushSyncSavedHistory(e) {
    const button = e?.currentTarget;
    const wrap = document.getElementById('magnetar-expanded-section');
    const statusNode = wrap?.querySelector('.magnetar-sync-push-status');
    if (button) { button.disabled = true; button.textContent = 'Pushing...'; }
    if (statusNode) statusNode.textContent = 'Encrypting saved items and history...';
    const result = await safeRuntimeMessage({ type: 'sync-push-saved-history' }, null);
    if (result?.ok) {
      showToast(`Synced ${result.savedCount || 0} saved and ${result.historyCount || 0} history items`);
      if (syncPanelOpen) await populateSyncPanel();
      return;
    }
    if (button) { button.disabled = false; button.textContent = 'Push sync'; }
    if (statusNode) statusNode.textContent = result?.error || 'Sync push failed.';
    showToast(result?.error ? `Sync failed: ${result.error}` : 'Sync failed', true);
  }
  function closeClientPanel() {
    if (clientPanelOpen) {
      setExpandedPanel('');
      document.getElementById('magnetar-banner')?.classList.remove('magnetar-expanded');
    }
    updateExpandedToggleState();
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

    const activityRows = history.slice(0, 20).map(h => {
      const ago = formatRelative(h.lastSentAt || h.timestamp);
      const status = h.cacheAtSend === 'cached' ? 'cached' : 'sent';
      const sourceUrl = safeSourceUrl(h);
      return `
        <div class="magnetar-activity-row" data-hash="${escapeAttr(h.hash || '')}">
          <div class="magnetar-activity-main">
            <span class="magnetar-activity-name">${escapeHtml(h.name || '\u2014')}</span>

          </div>
          <div class="magnetar-activity-actions">
            <span class="magnetar-activity-meta">${ago}${h.provider ? ` \u00b7 ${escapeHtml(h.provider)}` : ''}</span>
            <button class="magnetar-activity-pill magnetar-activity-resend" data-hash="${escapeAttr(h.hash || '')}">Resend</button>
            ${sourceUrl ? `<button class="magnetar-activity-pill magnetar-activity-open" data-url="${escapeAttr(sourceUrl)}" title="Open source URL" aria-label="Open source URL">URL</button>` : ''}
            <span class="magnetar-activity-status magnetar-activity-${status}">${status}</span>
          </div>
        </div>
      `;
    }).join('');

    const activityHTML = history.length > 0
      ? activityRows
      : '<div class="magnetar-activity-empty">No history yet</div>';

    const savedRows = saved.map(s => {
      const ago = formatRelative(s.savedAt);
      const hash = escapeAttr(s.hash || '');
      return `
        <div class="magnetar-saved-row" data-hash="${hash}">
          <span class="magnetar-saved-name" title="${escapeHtml(s.name || '�')}">${escapeHtml(s.name || '�')}</span>
          <span class="magnetar-saved-meta">${ago}</span>
          <button class="magnetar-saved-action magnetar-saved-share" data-hash="${hash}" title="Share">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          </button>
          <button class="magnetar-saved-action magnetar-saved-copy" data-hash="${hash}" title="Copy magnet">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
          <button class="magnetar-saved-send" data-hash="${hash}" title="Send now">Send</button>
          <button class="magnetar-saved-delete" data-hash="${hash}" title="Remove" aria-label="Remove">${removeIconSvg()}</button>
        </div>
      `;
    }).join('');

    const modeUpper = String(mode || 'local').toUpperCase();
    const targetOptions = getQuickSendTargetOptions();
    const expandedTargetControl = isAdvancedMode ? `
      <button class="magnetar-panel-send-target" id="magnetar-expanded-send-target" type="button" ${targetOptions.length ? '' : 'disabled'}>
        <span class="magnetar-panel-send-target-label">${escapeHtml(getCurrentToolbarSendLabel())}</span>
        ${targetOptions.length ? `<span class="magnetar-panel-send-target-arrow">${chevronDownIconSvg()}</span>` : ''}
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
            <div class="magnetar-stat-value">${cacheRate === null ? '�' : cacheRate + '%'}</div>
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
          <span>History</span>
          <a id="magnetar-view-history">view history</a>
        </div>
        <div class="magnetar-activity">${activityHTML}</div>
        <div class="magnetar-bfoot">
          <span>v${MAGNETAR_API.runtime.getManifest().version} � ${modeUpper}</span>
          <span class="magnetar-bfoot-tagline">Grab torrents, send them anywhere</span>
        </div>
      </div>
    `;

    bindActivityActions(wrap);

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
        btn.textContent = '�';
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

  async function toggleClientPanel(detection, enabled) {
    const banner = document.getElementById('magnetar-banner');
    if (!banner) return;

    const isOpen = banner.classList.contains('magnetar-expanded');
    if (!enabled || (isOpen && clientPanelOpen)) {
      banner.classList.remove('magnetar-expanded');
      setExpandedPanel('');
      updateExpandedToggleState();
      return;
    }

    if (batchMode) {
      await saveBatchModePreference(false, { render: false });
      document.getElementById('magnetar-batch')?.remove();
    }

    setExpandedPanel('client');
    banner.classList.add('magnetar-expanded');
    updateExpandedToggleState();
    await populateClientPanel(detection, currentQuickSendTarget, 1);
    maybePullLatest('panel-open').catch(() => {});
  }

  function getClientPanelCacheKey(providerMode, page) {
    return `${providerMode || 'local'}:${page || 1}`;
  }

  function getClientPanelTitle(providerMode, providerLabel) {
    const label = providerMode === 'rdtclient'
      ? 'RDT'
      : String(providerLabel || providerMode || 'Client').replace(/\s+client$/i, '');
    return `${label.toUpperCase()} CLIENT`;
  }

  async function populateClientPanel(detection, providerMode, page = 1) {
    const wrap = document.getElementById('magnetar-expanded-section');
    if (!wrap) return;

    const targetMode = providerMode || mode || 'local';
    const targetLabel = getProviderName(targetMode);
    const safePage = Math.max(1, Number(page) || 1);
    const panelTitle = getClientPanelTitle(targetMode, targetLabel);
    const cacheKey = getClientPanelCacheKey(targetMode, safePage);

    setExpandedPanel('client');
    updateExpandedToggleState();

    if (clientPanelCache.has(cacheKey)) {
      await renderClientPanel(clientPanelCache.get(cacheKey), detection);
      return;
    }

    wrap.innerHTML = `
      <div class="magnetar-expanded-inner magnetar-client-files-panel">
        <div class="magnetar-section-heading">
          <span>${escapeHtml(panelTitle)}</span>
          <span class="magnetar-provider-files-page">Loading</span>
        </div>
        <div class="magnetar-provider-files">
          <div class="magnetar-activity-empty">Loading client...</div>
        </div>
      </div>
    `;

    const result = await safeRuntimeMessage({
      type: 'list-client-items',
      mode: targetMode,
      page: safePage,
      pageSize: CLIENT_PANEL_PAGE_SIZE
    }, null);

    const payload = {
      ...(result || {}),
      mode: targetMode,
      provider: result?.provider || targetLabel,
      page: safePage,
      pageSize: CLIENT_PANEL_PAGE_SIZE
    };

    if (payload.success) clientPanelCache.set(cacheKey, payload);
    await renderClientPanel(payload, detection);
  }

  function folderText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function isRawFolderKeyLabel(value) {
    const clean = folderText(value);
    if (!clean) return true;
    if (/^(hash:)?[a-f0-9]{32,64}$/i.test(clean)) return true;
    if (/^[A-Z2-7]{32}$/i.test(clean)) return true;
    if (/^(provider|magnet|fallback):/i.test(clean)) return true;
    return false;
  }

  function folderLabelCandidate(value) {
    const clean = folderText(value);
    return clean && !isRawFolderKeyLabel(clean) ? clean : '';
  }

  function extractFolderHashFromMagnet(value) {
    const magnet = folderText(value);
    const match = magnet.match(/btih:([a-z0-9]{32,40})/i);
    return match ? match[1].toLowerCase() : '';
  }

  function shortFolderFallback(value) {
    const clean = folderText(value).replace(/^(hash|provider|magnet|fallback):/i, '');
    if (!clean) return 'Client item';
    return clean.length > 14 ? `${clean.slice(0, 12)}...` : clean;
  }

  function labelFromKnownFolderSource(item) {
    if (!item) return '';
    const fileLabel = Array.isArray(item.files)
      ? item.files.map(file => folderLabelCandidate(file.displayName) || folderLabelCandidate(file.title) || folderLabelCandidate(file.name) || folderLabelCandidate(file.filename)).find(Boolean)
      : '';
    return (
      folderLabelCandidate(item.displayName) ||
      folderLabelCandidate(item.name) ||
      folderLabelCandidate(item.title) ||
      folderLabelCandidate(item.mediaName) ||
      fileLabel ||
      ''
    );
  }

  function folderItemKeys(item) {
    const keys = new Set();
    const provider = folderText(item?.provider || item?.sourceProvider || item?.providerId || item?.target).toLowerCase();
    const providerId = folderText(item?.providerItemId || item?.providerItemKey || item?.torrentId || item?.transferId || item?.clientItemId || item?.id);
    if (provider && providerId) keys.add(`provider:${provider}:${providerId}`);
    const hash = folderText(item?.hash || item?.infoHash) || extractFolderHashFromMagnet(item?.magnet || item?.magnetUri);
    if (provider && hash) keys.add(`provider-hash:${provider}:${hash.toLowerCase()}`);
    if (hash) keys.add(`hash:${hash.toLowerCase()}`);
    const magnet = folderText(item?.magnet || item?.magnetUri);
    if (magnet) keys.add(`magnet:${magnet}`);
    const parentItemKey = folderText(item?.parentItemKey);
    const providerFileId = folderText(item?.providerFileId || item?.fileId);
    if (parentItemKey && providerFileId) keys.add(`provider-file:${parentItemKey}:${providerFileId}`);
    const filePath = folderText(item?.filePath);
    if (parentItemKey && filePath) keys.add(`provider-file-path:${parentItemKey}:${filePath.toLowerCase()}`);
    const itemKey = folderText(item?.itemKey);
    if (itemKey) keys.add(itemKey);
    if (/^hash:/i.test(itemKey)) keys.add(`hash:${itemKey.slice(5).toLowerCase()}`);
    const sourceUrl = folderText(item?.sourceUrl || item?.url);
    const title = folderText(item?.title || item?.name || item?.displayName).toLowerCase();
    if (provider && sourceUrl && title) keys.add(`provider-source:${provider}:${sourceUrl}:${title}`);
    if (sourceUrl || title) keys.add(`fallback:${sourceUrl}:${title}`);
    return [...keys];
  }

  function organisedItemsShareStableKey(a, b) {
    const aKeys = new Set(folderItemKeys(a));
    return folderItemKeys(b).some(key => aKeys.has(key));
  }

  function folderContainsStableItem(folder, item) {
    return Array.isArray(folder?.items) && folder.items.some(entry => organisedItemsShareStableKey(entry, item));
  }

  function closeMagnetarOwnedDialogs() {
    document.querySelectorAll('.magnetar-owned-dialog-overlay').forEach(node => {
      const close = node.querySelector('.magnetar-owned-dialog-close, .magnetar-owned-dialog-cancel');
      if (close) close.click();
      else node.remove();
    });
  }
  function buildFolderLabelIndex(groups) {
    const index = new Map();
    const add = item => {
      const label = labelFromKnownFolderSource(item);
      if (!label) return;
      folderItemKeys(item).forEach(key => {
        if (key && !index.has(key)) index.set(key, label);
      });
    };
    (groups || []).flat().filter(Boolean).forEach(add);
    return index;
  }

  function resolveFolderItemLabel(item, labelIndex) {
    const direct = folderLabelCandidate(item?.displayName) || folderLabelCandidate(item?.name) || folderLabelCandidate(item?.title);
    if (direct) return direct;
    for (const key of folderItemKeys(item)) {
      const indexed = labelIndex?.get(key);
      if (indexed) return indexed;
    }
    return shortFolderFallback(item?.hash || item?.infoHash || item?.itemKey || item?.providerItemKey || item?.sourceUrl || item?.url || item?.id);
  }

  async function loadOrganisedFoldersState() {
    const [settings, mobileAck, folders, savedData, historyData] = await Promise.all([
      safeRuntimeMessage({ type: 'get-sync-settings' }, null),
      safeRuntimeMessage({ type: 'get-sync-mobile-ack' }, null),
      safeRuntimeMessage({ type: 'get-organised-folders' }, null),
      safeRuntimeMessage({ type: 'get-saved' }, []),
      safeRuntimeMessage({ type: 'get-history' }, [])
    ]);
    const paired = isUsableSyncSettings(settings);
    const mobileAcknowledged = paired && !!mobileAck?.paired;
    const section = mobileAcknowledged && folders && Array.isArray(folders.folders) ? folders : null;
    const saved = Array.isArray(savedData) ? savedData : [];
    const history = Array.isArray(historyData) ? historyData : (historyData?.history || []);
    return {
      paired,
      mobileAcknowledged,
      section,
      folders: section ? section.folders : [],
      labelIndex: buildFolderLabelIndex([currentClientPanelItems, saved, history])
    };
  }
  function renderClientViewSwitch(folderCount) {
    return `
      <div class="magnetar-client-view-switch" role="tablist" aria-label="Client view">
        <button type="button" class="magnetar-client-view-btn magnetar-client-view-btn-provider ${clientPanelView === 'provider' ? 'magnetar-client-view-btn-active' : ''}" data-client-view="provider" role="tab" aria-selected="${clientPanelView === 'provider'}">Provider</button>
        <button type="button" class="magnetar-client-view-btn magnetar-client-view-btn-organised ${clientPanelView === 'organised' ? 'magnetar-client-view-btn-active' : ''}" data-client-view="organised" role="tab" aria-selected="${clientPanelView === 'organised'}">Organised${folderCount ? ` <span>${folderCount}</span>` : ''}</button>
      </div>
    `;
  }

  function renderOrganisedItemList(items, labelIndex, emptyText = 'No items in this folder yet.') {
    if (!Array.isArray(items) || items.length === 0) {
      return `<div class="magnetar-organised-empty">${escapeHtml(emptyText)}</div>`;
    }
    return `
      <div class="magnetar-organised-item-list">
        ${items.map(item => `<div class="magnetar-organised-item-row" title="${escapeAttr(resolveFolderItemLabel(item, labelIndex))}">${escapeHtml(resolveFolderItemLabel(item, labelIndex))}</div>`).join('')}
      </div>
    `;
  }

  function organisedItemTimestamp(item) {
    const value = Number(item?.updatedAt || item?.addedAt || item?.createdAt || item?.sentAt || item?.timestamp || 0);
    return Number.isFinite(value) ? value : 0;
  }

  function organisedItemProviderLabel(item) {
    return folderText(item?.sourceProvider || item?.provider || item?.providerId || item?.target || item?.sourceDomain);
  }

  function organisedItemSearchText(item, labelIndex) {
    return [
      resolveFolderItemLabel(item, labelIndex),
      item?.displayName,
      item?.name,
      item?.title,
      item?.hash,
      item?.infoHash,
      item?.itemKey,
      item?.providerItemKey,
      item?.providerItemId,
      item?.torrentId,
      item?.magnet,
      item?.magnetUri,
      item?.sourceUrl,
      item?.url,
      item?.sourceDomain,
      item?.sourceProvider,
      item?.provider
    ].map(folderText).join(' ').toLowerCase();
  }

  function getFilteredSortedOrganisedItems(folder, labelIndex) {
    const query = folderText(organisedOpenItemFilter).toLowerCase();
    const entries = (Array.isArray(folder?.items) ? folder.items : [])
      .map((item, index) => ({ item, index, label: resolveFolderItemLabel(item, labelIndex) }))
      .filter(entry => !query || organisedItemSearchText(entry.item, labelIndex).includes(query));
    entries.sort((a, b) => {
      if (organisedOpenItemSort === 'name') {
        const byName = a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
        if (byName !== 0) return byName;
      } else {
        const diff = organisedItemTimestamp(a.item) - organisedItemTimestamp(b.item);
        if (diff !== 0) return organisedOpenItemSort === 'oldest' ? diff : -diff;
      }
      return a.index - b.index;
    });
    return entries;
  }

  function pagedOrganisedOpenItems(entries) {
    const pageSize = [25, 50, 75].includes(Number(organisedOpenItemPageSize)) ? Number(organisedOpenItemPageSize) : 25;
    const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
    if (organisedOpenItemPage > totalPages) organisedOpenItemPage = totalPages;
    if (organisedOpenItemPage < 1) organisedOpenItemPage = 1;
    const start = (organisedOpenItemPage - 1) * pageSize;
    return { pageSize, totalPages, pageItems: entries.slice(start, start + pageSize) };
  }

  function getOrganisedItemUrl(item) {
    return folderText(item?.sourceUrl || item?.url || item?.providerUrl || item?.link);
  }

  function getOrganisedItemCopyValue(item) {
    return folderText(item?.magnet || item?.magnetUri || item?.hash || item?.infoHash || getOrganisedItemUrl(item) || item?.itemKey || item?.providerItemKey);
  }


  function getOrganisedBrowseMode(item, fallbackMode = '') {
    const raw = folderText(item?.sourceProvider || item?.provider || item?.providerId || fallbackMode).toLowerCase();
    const compact = raw.replace(/[^a-z0-9]/g, '');
    const aliases = {
      local: 'local',
      qbittorrent: 'local',
      localtorrentclient: 'local',
      realdebrid: 'realdebrid',
      rdebrid: 'realdebrid',
      rd: 'realdebrid',
      torbox: 'torbox',
      premiumize: 'premiumize',
      alldebrid: 'alldebrid',
      ad: 'alldebrid',
      rdtclient: 'rdtclient',
      rdt: 'rdtclient'
    };
    return aliases[compact] || raw;
  }

  function organisedFileCopyValue(file, fallback = '') {
    return folderText(file?.link || file?.url || file?.downloadUrl || file?.item?.link || fallback);
  }

  function normaliseTorBoxTorrentIdValue(value) {
    const raw = folderText(value);
    if (!raw) return '';
    const providerMatch = raw.match(/^provider:[^:]+:(.+)$/i);
    return folderText(providerMatch ? providerMatch[1] : raw);
  }

  function getTorBoxTorrentId(item, allowGenericId = false) {
    const raw = item?.raw && typeof item.raw === 'object' ? item.raw : {};
    const torrent = item?.torrent && typeof item.torrent === 'object' ? item.torrent : {};
    const data = item?.data && typeof item.data === 'object' ? item.data : {};
    const candidates = [
      item?.torrent_id,
      item?.torrentId,
      item?.torrentID,
      item?.torrentid,
      item?.torboxTorrentId,
      item?.providerItemId,
      item?.providerItemKey,
      item?.transfer_id,
      item?.transferId,
      item?.clientItemId,
      raw.torrent_id,
      raw.torrentId,
      raw.torrentID,
      raw.torrentid,
      raw.id,
      torrent.torrent_id,
      torrent.torrentId,
      torrent.torrentID,
      torrent.id,
      data.torrent_id,
      data.torrentId,
      data.torrentID,
      data.id,
      allowGenericId ? item?.id : ''
    ];
    for (const candidate of candidates) {
      const id = normaliseTorBoxTorrentIdValue(candidate);
      if (id) return id;
    }
    return '';
  }

  function torBoxTorrentId(item, allowGenericId = false) {
    return getTorBoxTorrentId(item, allowGenericId);
  }

  function isTorBoxProviderItem(item = {}, providerMode = '', providerLabel = '') {
    return [providerMode, item?.sourceProvider, item?.provider, item?.providerId, item?.clientType, providerLabel]
      .some(provider => getOrganisedBrowseMode({ provider }) === 'torbox');
  }

  function isTorBoxOrganisedItem(item) {
    return isTorBoxProviderItem(item);
  }

  function canToggleAirlockItem(item, allowGenericId = false) {
    return isTorBoxOrganisedItem(item) && Boolean(torBoxTorrentId(item, allowGenericId));
  }

  function renderAirlockedBadge() {
    return '<span class="magnetar-airlocked-badge" title="Airlocked in TorBox">Airlocked</span>';
  }

  function renderAirlockToggleButton(index, isAirlocked = false, options = {}) {
    const title = isAirlocked ? 'Remove Airlock in TorBox' : 'Airlock in TorBox';
    const classes = [
      options.organised ? 'magnetar-organised-action magnetar-organised-item-action' : '',
      'magnetar-provider-file-airlock',
      isAirlocked ? 'magnetar-provider-file-airlock-active' : ''
    ].filter(Boolean).join(' ');
    const actionAttr = options.organised ? ' data-organised-item-action="airlock"' : '';
    const disabledAttr = options.disabled ? ' disabled' : '';
    const disabledTitle = options.disabled ? 'Airlock needs a TorBox item id' : title;
    return `<button type="button" class="${classes}"${actionAttr} data-index="${index}" data-item-index="${index}" data-airlocked="${isAirlocked ? 'true' : 'false'}" title="${escapeAttr(disabledTitle)}" aria-label="${escapeAttr(disabledTitle)}" aria-pressed="${isAirlocked ? 'true' : 'false'}"${disabledAttr}>${folderActionIconSvg('lock')}</button>`;
  }

  function renderOrganisedFileRows(files = []) {
    return files.map((file, index) => {
      const name = folderText(file.name || file.title || `File ${index + 1}`);
      const meta = [formatFileSize(file.size), folderText(file.type), folderText(file.status)].filter(Boolean).join(' - ');
      const canCopy = Boolean(organisedFileCopyValue(file));
      return `
        <div class="magnetar-owned-file-row" data-file-index="${index}">
          <div class="magnetar-owned-file-main">
            <span class="magnetar-owned-file-name" title="${escapeAttr(name)}">${escapeHtml(name)}</span>
            <span class="magnetar-owned-file-meta">${escapeHtml(meta || 'Provider file')}</span>
          </div>
          <div class="magnetar-owned-file-actions" aria-label="File actions">
            <button type="button" class="magnetar-organised-action magnetar-owned-file-action" data-file-action="copy" data-file-index="${index}" title="Copy link" aria-label="Copy link" ${canCopy ? '' : 'disabled'}>${folderActionIconSvg('copy')}</button>
          </div>
        </div>
      `;
    }).join('');
  }

  function showOrganisedFileBrowserDialog(options = {}) {
    let state = {
      title: 'Provider files',
      provider: 'Provider',
      mode: '',
      files: [],
      fallbackUrl: '',
      copyValue: '',
      message: '',
      item: null,
      loading: false,
      ...options
    };
    const overlay = document.createElement('div');
    overlay.className = 'magnetar-owned-dialog-overlay';
    overlay.setAttribute('role', 'presentation');

    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
    };
    function onKeyDown(event) {
      if (event.key === 'Escape') cleanup();
    }
    function render() {
      const hasFiles = Array.isArray(state.files) && state.files.length > 0;
      overlay.innerHTML = `
        <div class="magnetar-owned-dialog magnetar-owned-file-browser" role="dialog" aria-modal="true" aria-labelledby="magnetar-owned-dialog-title">
          <div class="magnetar-owned-dialog-head">
            <div>
              <div class="magnetar-owned-dialog-kicker">Magnetar - ${escapeHtml(state.provider || 'Provider')}</div>
              <div class="magnetar-owned-dialog-title" id="magnetar-owned-dialog-title">${escapeHtml(state.title || 'Provider files')}</div>
            </div>
            <button type="button" class="magnetar-owned-dialog-close" aria-label="Close">${closeIconSvg()}</button>
          </div>
          <div class="magnetar-owned-dialog-note">Provider API keys stay local to this browser. Provider files and folders are never changed.</div>
          ${state.loading ? `
            <div class="magnetar-owned-file-loading">
              <span class="magnetar-owned-file-spinner" aria-hidden="true"></span>
              <span>${escapeHtml(state.message || 'Browsing provider files...')}</span>
            </div>
          ` : hasFiles ? `
            <div class="magnetar-owned-file-list">
              ${renderOrganisedFileRows(state.files)}
            </div>
          ` : `
            <div class="magnetar-owned-file-fallback">
              <div class="magnetar-owned-dialog-copy">${escapeHtml(state.message || 'Provider access is needed on this browser to browse these files.')}</div>
              <div class="magnetar-owned-file-fallback-actions">
                <button type="button" class="magnetar-btn magnetar-btn-secondary magnetar-owned-open-provider" ${state.mode ? '' : 'disabled'}>Open in provider</button>
                <button type="button" class="magnetar-btn magnetar-btn-secondary magnetar-owned-copy-item" ${state.copyValue ? '' : 'disabled'}>Copy link/hash</button>
              </div>
            </div>
          `}
          <div class="magnetar-owned-dialog-actions">
            ${!state.loading && hasFiles ? `<button type="button" class="magnetar-btn magnetar-btn-secondary magnetar-owned-download-folder" title="Download folder" aria-label="Download folder" ${state.downloadBusy ? 'disabled' : ''}>${folderActionIconSvg('download')}<span>${state.downloadBusy ? 'Downloading...' : 'Download'}</span></button>` : ''}
            ${!state.loading && hasFiles && state.mode ? '<button type="button" class="magnetar-btn magnetar-btn-secondary magnetar-owned-open-provider">Open in provider</button>' : ''}
            <button type="button" class="magnetar-btn magnetar-btn-secondary magnetar-owned-dialog-cancel">Close</button>
          </div>
        </div>
      `;
      bindDialogActions();
    }
    function bindDialogActions() {
      overlay.querySelector('.magnetar-owned-dialog-close')?.addEventListener('click', cleanup);
      overlay.querySelector('.magnetar-owned-dialog-cancel')?.addEventListener('click', cleanup);
      overlay.querySelectorAll('.magnetar-owned-open-provider').forEach(button => {
        button.addEventListener('click', () => {
          safeRuntimeMessage({ type: 'open-provider-dashboard', mode: state.mode });
        });
      });
      overlay.querySelector('.magnetar-owned-download-folder')?.addEventListener('click', async () => {
        state = { ...state, downloadBusy: true };
        render();
        const downloadItem = state.item || {};
        const response = await safeRuntimeMessage({
          type: 'download-client-item',
          mode: state.mode,
          item: {
            id: downloadItem.id || '',
            fileId: downloadItem.fileId || '',
            type: downloadItem.type || '',
            name: downloadItem.name || state.title || '',
            provider: downloadItem.provider || state.provider || '',
            downloadable: downloadItem.downloadable === true,
            link: downloadItem.link || ''
          }
        }, { success: false, error: 'Could not download folder.' });
        state = { ...state, downloadBusy: false };
        render();
        if (response?.success) showToast('Folder download started');
        else showToast(response?.error || 'Could not download folder', true);
      });
      overlay.querySelector('.magnetar-owned-copy-item')?.addEventListener('click', async () => {
        if (state.copyValue) await handleCopy(state.copyValue, 'Item copied');
      });
      overlay.querySelectorAll('[data-file-action]').forEach(button => {
        button.addEventListener('click', async () => {
          const index = Number(button.dataset.fileIndex);
          const file = Number.isInteger(index) ? state.files[index] : null;
          if (!file) return;
          const action = button.dataset.fileAction;
          if (action === 'copy') {
            const value = organisedFileCopyValue(file, state.copyValue);
            if (value) await handleCopy(value, 'File link copied');
            return;
          }

          if (action === 'download') {
            button.disabled = true;
            button.classList.add('magnetar-provider-file-download-loading');
            const downloadItem = file.item || state.item || file;
            const response = await safeRuntimeMessage({
              type: 'download-client-item',
              mode: state.mode,
              item: {
                id: downloadItem.id || file.id || '',
                fileId: downloadItem.fileId || file.fileId || '',
                type: downloadItem.type || file.type || '',
                name: downloadItem.name || file.name || state.title,
                provider: downloadItem.provider || state.provider,
                downloadable: downloadItem.downloadable === true || file.downloadable === true,
                link: downloadItem.link || file.link || ''
              }
            }, { success: false, error: 'Could not download provider file.' });
            if (!response?.success) showToast(response?.error || 'Could not download provider file', true);
            button.classList.remove('magnetar-provider-file-download-loading');
            button.disabled = false;
          }
        });
      });
    }
    overlay.addEventListener('mousedown', event => {
      if (event.target === overlay) cleanup();
    });
    document.addEventListener('keydown', onKeyDown, true);
    document.body.appendChild(overlay);
    render();
    requestAnimationFrame(() => overlay.querySelector('.magnetar-owned-file-action, .magnetar-owned-open-provider, .magnetar-owned-dialog-cancel')?.focus());
    return {
      update(next = {}) {
        if (settled) return;
        state = { ...state, ...next, loading: next.loading === true };
        render();
      },
      close: cleanup
    };
  }
  async function browseOrganisedFolderItem(item, label, fallbackMode = '') {
    const mode = getOrganisedBrowseMode(item, fallbackMode);
    const fallbackUrl = getOrganisedItemUrl(item);
    const copyValue = getOrganisedItemCopyValue(item);
    const browser = showOrganisedFileBrowserDialog({
      title: label,
      provider: mode || 'Provider',
      mode,
      fallbackUrl,
      copyValue,
      item,
      loading: true,
      message: 'Browsing provider files...'
    });
    const response = await safeRuntimeMessage({
      type: 'browse-organised-client-item',
      mode,
      item: {
        id: item.id || '',
        itemKey: item.itemKey || '',
        kind: item.kind || '',
        clientType: item.clientType || '',
        providerItemId: item.providerItemId || '',
        providerItemKey: item.providerItemKey || '',
        clientItemId: item.clientItemId || '',
        torrentId: item.torrentId || '',
        fileId: item.fileId || '',
        providerFileId: item.providerFileId || '',
        filePath: item.filePath || '',
        parentItemKey: item.parentItemKey || '',
        parentTitle: item.parentTitle || '',
        hash: item.hash || '',
        infoHash: item.infoHash || '',
        magnet: item.magnet || '',
        magnetUri: item.magnetUri || '',
        title: item.title || '',
        name: item.name || '',
        displayName: item.displayName || '',
        provider: item.provider || '',
        sourceProvider: item.sourceProvider || '',
        providerId: item.providerId || '',
        sourceUrl: item.sourceUrl || '',
        url: item.url || '',
        link: item.link || '',
        airlocked: item.airlocked === true
      }
    }, { success: false, error: 'Provider access is needed on this browser to browse these files.' });
    browser.update({
      title: label,
      provider: response?.provider || mode || 'Provider',
      mode: response?.mode || mode,
      files: response?.success ? (response.files || []) : [],
      item: response?.item || item,
      fallbackUrl: response?.providerUrl || fallbackUrl,
      copyValue,
      message: response?.error || 'Provider access is needed on this browser to browse these files.',
      loading: false
    });
  }
  function renderOrganisedOpenControls(totalCount) {
    return `
      <div class="magnetar-organised-open-controls">
        <input id="magnetar-organised-item-filter" class="magnetar-organised-filter magnetar-organised-item-filter" type="search" value="${escapeAttr(organisedOpenItemFilter)}" placeholder="Filter items" aria-label="Filter folder items">
        <select id="magnetar-organised-item-sort" class="magnetar-organised-select" aria-label="Sort folder items">
          <option value="newest" ${organisedOpenItemSort === 'newest' ? 'selected' : ''}>Newest</option>
          <option value="oldest" ${organisedOpenItemSort === 'oldest' ? 'selected' : ''}>Oldest</option>
          <option value="name" ${organisedOpenItemSort === 'name' ? 'selected' : ''}>Name</option>
        </select>
        <select id="magnetar-organised-item-page-size" class="magnetar-organised-select" aria-label="Folder item page size">
          ${[25, 50, 75].map(size => `<option value="${size}" ${Number(organisedOpenItemPageSize) === size ? 'selected' : ''}>${size}</option>`).join('')}
        </select>
        <span class="magnetar-provider-files-page">${totalCount} ${totalCount === 1 ? 'item' : 'items'}</span>
      </div>
    `;
  }

  function renderOrganisedOpenPagination(totalPages, totalCount, pageSize) {
    if (totalPages <= 1) return '';
    const start = Math.min(totalCount, (organisedOpenItemPage - 1) * pageSize + 1);
    const end = Math.min(totalCount, organisedOpenItemPage * pageSize);
    return `
      <div class="magnetar-organised-pagination magnetar-organised-item-pagination">
        <button type="button" class="magnetar-activity-pill magnetar-organised-item-page-prev" ${organisedOpenItemPage <= 1 ? 'disabled' : ''}>Previous</button>
        <span class="magnetar-provider-files-page">${start}-${end} of ${totalCount}</span>
        <button type="button" class="magnetar-activity-pill magnetar-organised-item-page-next" ${organisedOpenItemPage >= totalPages ? 'disabled' : ''}>Next</button>
      </div>
    `;
  }

  function renderOrganisedOpenItemCard(entry, labelIndex) {
    const item = entry.item || {};
    const label = entry.label || resolveFolderItemLabel(item, labelIndex);
    const provider = organisedItemProviderLabel(item);
    const when = organisedItemTimestamp(item) ? formatRelative(organisedItemTimestamp(item)) : '';
    const meta = [when, provider].filter(Boolean).join(' - ');
    const url = getOrganisedItemUrl(item);
    const copyValue = getOrganisedItemCopyValue(item);
    const canOpenItem = Boolean(url || item.providerItemId || item.providerItemKey || item.torrentId || item.id || item.hash || item.infoHash || item.itemKey || item.magnet || item.magnetUri || item.sourceProvider || item.provider);
    const canToggleAirlock = canToggleAirlockItem(item, false);
    return `
      <div class="magnetar-organised-open-item" data-item-index="${entry.index}" title="${escapeAttr(label)}">
        <div class="magnetar-organised-open-item-main">
          <span class="magnetar-organised-open-item-name">${escapeHtml(label)}</span>
          <span class="magnetar-organised-open-item-meta">${escapeHtml(meta || 'Magnetar folder item')}${item.airlocked === true ? ` ${renderAirlockedBadge()}` : ''}</span>
        </div>
        <div class="magnetar-organised-open-item-actions" aria-label="Item actions">
          <button type="button" class="magnetar-organised-action magnetar-organised-item-action" data-organised-item-action="url" data-item-index="${entry.index}" title="Open URL" aria-label="Open URL" ${url ? '' : 'disabled'}>${folderActionIconSvg('link')}</button>
          <button type="button" class="magnetar-organised-action magnetar-organised-item-action" data-organised-item-action="copy" data-item-index="${entry.index}" title="Copy" aria-label="Copy" ${copyValue ? '' : 'disabled'}>${folderActionIconSvg('copy')}</button>
          <button type="button" class="magnetar-organised-action magnetar-organised-item-action" data-organised-item-action="rename" data-item-index="${entry.index}" title="Rename display name" aria-label="Rename display name">${folderActionIconSvg('pencil')}</button>
          <button type="button" class="magnetar-organised-action magnetar-organised-item-action" data-organised-item-action="move" data-item-index="${entry.index}" title="Move to folder" aria-label="Move to folder">${folderActionIconSvg('move')}</button>
          ${canToggleAirlock ? renderAirlockToggleButton(entry.index, item.airlocked === true, { organised: true }) : ''}
          <button type="button" class="magnetar-organised-action magnetar-organised-item-action" data-organised-item-action="open" data-item-index="${entry.index}" title="Browse files" aria-label="Browse files" ${canOpenItem ? '' : 'disabled'}>${folderActionIconSvg('open')}</button>
          <button type="button" class="magnetar-organised-action magnetar-organised-action-danger magnetar-organised-item-action" data-organised-item-action="delete" data-item-index="${entry.index}" title="Remove from folder" aria-label="Remove from folder">${folderActionIconSvg('trash')}</button>
        </div>
      </div>
    `;
  }
  function filterOrganisedFolders(state) {
    const folders = Array.isArray(state.folders) ? state.folders : [];
    const query = folderText(organisedFolderFilter).toLowerCase();
    if (!query) return folders;
    return folders.filter(folder => {
      const nameMatches = folderText(folder.name).toLowerCase().includes(query);
      if (nameMatches) return true;
      return (Array.isArray(folder.items) ? folder.items : []).some(item => resolveFolderItemLabel(item, state.labelIndex).toLowerCase().includes(query));
    });
  }

  function pagedOrganisedFolders(folders) {
    const totalPages = Math.max(1, Math.ceil(folders.length / ORGANISED_FOLDER_PAGE_SIZE));
    if (organisedFolderPage > totalPages) organisedFolderPage = totalPages;
    if (organisedFolderPage < 1) organisedFolderPage = 1;
    const start = (organisedFolderPage - 1) * ORGANISED_FOLDER_PAGE_SIZE;
    return {
      totalPages,
      pageFolders: folders.slice(start, start + ORGANISED_FOLDER_PAGE_SIZE)
    };
  }

  function renderOrganisedFolderControls(canCreateFolder = false) {
    if (clientPanelView !== 'organised') return '';
    return `
      <div class="magnetar-organised-control-group">
        <input id="magnetar-organised-filter" class="magnetar-organised-filter" type="search" value="${escapeAttr(organisedFolderFilter)}" placeholder="Filter folders" aria-label="Filter folders">
        ${canCreateFolder ? `<button type="button" class="magnetar-organised-new-folder" id="magnetar-organised-new-folder" title="New Folder" aria-label="New Folder">${folderActionIconSvg('plus')}</button>` : ''}
      </div>
    `;
  }

  function renderOrganisedPagination(totalPages, totalCount) {
    if (totalPages <= 1) return '';
    const start = Math.min(totalCount, (organisedFolderPage - 1) * ORGANISED_FOLDER_PAGE_SIZE + 1);
    const end = Math.min(totalCount, organisedFolderPage * ORGANISED_FOLDER_PAGE_SIZE);
    return `
      <div class="magnetar-organised-pagination">
        <button type="button" class="magnetar-activity-pill magnetar-organised-page-prev" ${organisedFolderPage <= 1 ? 'disabled' : ''}>Previous</button>
        <span class="magnetar-provider-files-page">${start}-${end} of ${totalCount}</span>
        <button type="button" class="magnetar-activity-pill magnetar-organised-page-next" ${organisedFolderPage >= totalPages ? 'disabled' : ''}>Next</button>
      </div>
    `;
  }

  function renderOrganisedFolderCards(state, folders) {
    if (!Array.isArray(folders) || !folders.length) return '';
    const badge = state.section?.sourceDevice === 'chrome' ? 'Local' : 'Synced';
    return folders.map(folder => {
      const items = Array.isArray(folder.items) ? folder.items : [];
      const count = items.length;
      const quickviewOpen = organisedQuickviewFolderId === folder.id;
      const color = normaliseOrganisedFolderColor(folder.color);
      return `
        <div class="magnetar-organised-folder-card magnetar-organised-folder-color-${color}" data-folder-id="${escapeAttr(folder.id || '')}" data-folder-color="${escapeAttr(color)}">
          <div class="magnetar-organised-folder-card-top">
            <div class="magnetar-organised-folder-icon" aria-hidden="true">${folderIconSvg()}</div>
            <div class="magnetar-organised-folder-main">
              <div class="magnetar-organised-folder-name" title="${escapeAttr(folder.name || 'Folder')}">${escapeHtml(folder.name || 'Folder')}</div>
            </div>
            <span class="magnetar-organised-folder-badge">${badge}</span>
          </div>
          <div class="magnetar-organised-folder-card-bottom">
            <div class="magnetar-organised-folder-meta">${count} ${count === 1 ? 'item' : 'items'}</div>
            <div class="magnetar-organised-folder-actions" aria-label="Folder actions">
              <button type="button" class="magnetar-organised-action" data-organised-action="rename" data-folder-id="${escapeAttr(folder.id || '')}" title="Rename" aria-label="Rename folder">${folderActionIconSvg('pencil')}</button>
              <button type="button" class="magnetar-organised-action ${quickviewOpen ? 'magnetar-organised-action-active' : ''}" data-organised-action="quickview" data-folder-id="${escapeAttr(folder.id || '')}" title="Quickview" aria-label="Quickview folder" aria-expanded="${quickviewOpen}">${folderActionIconSvg(quickviewOpen ? 'chevronUp' : 'chevronDown')}</button>
              <button type="button" class="magnetar-organised-action" data-organised-action="open" data-folder-id="${escapeAttr(folder.id || '')}" title="Open" aria-label="Open folder">${folderActionIconSvg('open')}</button>
              <button type="button" class="magnetar-organised-action magnetar-organised-action-danger" data-organised-action="delete" data-folder-id="${escapeAttr(folder.id || '')}" title="Delete" aria-label="Delete folder">${folderActionIconSvg('trash')}</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderOrganisedOpenFolder(state) {
    const folder = state.folders.find(entry => entry.id === organisedOpenFolderId);
    if (!folder) {
      organisedOpenFolderId = '';
      return renderOrganisedFolderCards(state, state.folders);
    }
    const rawItems = Array.isArray(folder.items) ? folder.items : [];
    const filteredItems = getFilteredSortedOrganisedItems(folder, state.labelIndex);
    const paged = pagedOrganisedOpenItems(filteredItems);
    const emptyText = rawItems.length ? 'No items match this filter.' : 'No items in this folder yet.';
    return `
      <div class="magnetar-organised-open-folder magnetar-organised-folder-color-${normaliseOrganisedFolderColor(folder.color)}">
        <div class="magnetar-organised-open-head">
          <button type="button" class="magnetar-organised-action" id="magnetar-organised-back" title="Back" aria-label="Back to folders">${folderActionIconSvg('back')}</button>
          <div class="magnetar-organised-folder-icon" aria-hidden="true">${folderIconSvg()}</div>
          <div class="magnetar-organised-folder-main">
            <div class="magnetar-organised-folder-name" title="${escapeAttr(folder.name || 'Folder')}">${escapeHtml(folder.name || 'Folder')}</div>
            <div class="magnetar-organised-folder-meta">${rawItems.length} ${rawItems.length === 1 ? 'item' : 'items'} · provider files are never changed</div>
          </div>
        </div>
        ${renderOrganisedOpenControls(filteredItems.length)}
        ${filteredItems.length ? `
          <div class="magnetar-organised-open-item-grid">
            ${paged.pageItems.map(entry => renderOrganisedOpenItemCard(entry, state.labelIndex)).join('')}
          </div>
          ${renderOrganisedOpenPagination(paged.totalPages, filteredItems.length, paged.pageSize)}
        ` : `<div class="magnetar-organised-empty">${escapeHtml(emptyText)}</div>`}
      </div>
    `;
  }
  function renderOrganisedClientBody(state) {
    if (!state.paired || !state.mobileAcknowledged) {
      return `
        <div class="magnetar-organised-teaser">
          <div class="magnetar-organised-teaser-title">Organised folders work through Magnetar Sync.</div>
          <div class="magnetar-organised-teaser-copy">Pair Magnetar Mobile to bring your organised folders into the extension.</div>
          <div class="magnetar-organised-teaser-copy">Provider API keys are never synced. Provider files and folders are never changed.</div>
          <div class="magnetar-organised-teaser-actions"><button type="button" class="magnetar-btn magnetar-btn-secondary magnetar-organised-sync-open" id="magnetar-organised-sync-open">${state.paired ? 'Show pairing QR' : 'Sync Magnetar Mobile'}</button><button type="button" class="magnetar-btn magnetar-btn-secondary magnetar-organised-mobile-link">Get Magnetar Mobile</button></div>
        </div>
      `;
    }
    if (!state.section) {
      return `
        <div class="magnetar-organised-teaser">
          <div class="magnetar-organised-teaser-title">Waiting for organised folders from Magnetar Mobile.</div>
          <div class="magnetar-organised-teaser-copy">Open Magnetar Mobile and press Sync.</div>
          <div class="magnetar-organised-teaser-copy">Provider API keys are never synced. Provider files and folders are never changed.</div>
          <div class="magnetar-organised-teaser-actions"><button type="button" class="magnetar-btn magnetar-btn-secondary magnetar-organised-sync-open" id="magnetar-organised-sync-open">Sync Magnetar Mobile</button><button type="button" class="magnetar-btn magnetar-btn-secondary magnetar-organised-mobile-link">Get Magnetar Mobile</button></div>
        </div>
      `;
    }
    if (!state.folders.length) {
      return `
        <div class="magnetar-organised-teaser">
          <div class="magnetar-organised-teaser-title">Organised folder sync available.</div>
          <div class="magnetar-organised-teaser-copy">Add a folder to get started.</div>
          <div class="magnetar-organised-teaser-copy">Provider files and folders are never changed.</div>
          <div class="magnetar-organised-teaser-actions"><button type="button" class="magnetar-btn magnetar-btn-secondary magnetar-organised-new-folder-empty" id="magnetar-organised-new-folder-empty">New Folder</button></div>
        </div>
      `;
    }
    if (organisedOpenFolderId) return `<div class="magnetar-organised-open-wrap">${renderOrganisedOpenFolder(state)}</div>`;
    const filteredFolders = filterOrganisedFolders(state);
    const paged = pagedOrganisedFolders(filteredFolders);
    if (!filteredFolders.length) {
      return `<div class="magnetar-organised-folders"><div class="magnetar-organised-empty">No folders match this filter.</div></div>`;
    }
    return `
      <div class="magnetar-organised-folders">${renderOrganisedFolderCards(state, paged.pageFolders)}</div>
      ${renderOrganisedPagination(paged.totalPages, filteredFolders.length)}
    `;
  }

  function closeOrganisedQuickviewPopover() {
    if (organisedQuickviewPopover) organisedQuickviewPopover.remove();
    organisedQuickviewPopover = null;
    organisedQuickviewFolderId = '';
    if (organisedQuickviewOutsideHandler) document.removeEventListener('mousedown', organisedQuickviewOutsideHandler, true);
    organisedQuickviewOutsideHandler = null;
  }

  function showOrganisedQuickviewPopover(folder, labelIndex, anchor) {
    if (!folder || !anchor) return;
    if (organisedQuickviewFolderId === folder.id && organisedQuickviewPopover) {
      closeOrganisedQuickviewPopover();
      return;
    }
    closeOrganisedQuickviewPopover();
    organisedQuickviewFolderId = folder.id;
    const popover = document.createElement('div');
    popover.className = 'magnetar-organised-quickview-popover';
    popover.innerHTML = `
      <div class="magnetar-organised-popover-head">
        <span>${escapeHtml(folder.name || 'Folder')}</span>
        <button type="button" class="magnetar-organised-popover-close" aria-label="Close quickview">${closeIconSvg()}</button>
      </div>
      ${renderOrganisedItemList(Array.isArray(folder.items) ? folder.items : [], labelIndex)}
    `;
    document.body.appendChild(popover);
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(300, Math.max(220, window.innerWidth - 24));
    const maxHeight = Math.min(240, Math.max(140, window.innerHeight - 24));
    const left = Math.min(Math.max(12, rect.right - width), window.innerWidth - width - 12);
    const top = Math.min(Math.max(12, rect.bottom + 8), window.innerHeight - maxHeight - 12);
    popover.style.width = `${width}px`;
    popover.style.maxHeight = `${maxHeight}px`;
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    popover.querySelector('.magnetar-organised-popover-close')?.addEventListener('click', closeOrganisedQuickviewPopover);
    organisedQuickviewPopover = popover;
    organisedQuickviewOutsideHandler = event => {
      if (popover.contains(event.target) || anchor.contains(event.target)) return;
      closeOrganisedQuickviewPopover();
    };
    setTimeout(() => document.addEventListener('mousedown', organisedQuickviewOutsideHandler, true), 0);
  }
  function showMagnetarTextDialog(options = {}) {
    const {
      title = 'Magnetar',
      label = 'Name',
      initialValue = '',
      actionLabel = 'Save',
      existingNames = [],
      currentName = '',
      requiredMessage = 'Enter a name.'
    } = options;
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'magnetar-owned-dialog-overlay';
      overlay.setAttribute('role', 'presentation');
      overlay.innerHTML = `
        <div class="magnetar-owned-dialog" role="dialog" aria-modal="true" aria-labelledby="magnetar-owned-dialog-title">
          <div class="magnetar-owned-dialog-head">
            <div>
              <div class="magnetar-owned-dialog-kicker">Magnetar</div>
              <div class="magnetar-owned-dialog-title" id="magnetar-owned-dialog-title">${escapeHtml(title)}</div>
            </div>
            <button type="button" class="magnetar-owned-dialog-close" aria-label="Close">${closeIconSvg()}</button>
          </div>
          <label class="magnetar-owned-dialog-label" for="magnetar-owned-dialog-input">${escapeHtml(label)}</label>
          <input id="magnetar-owned-dialog-input" class="magnetar-owned-dialog-input" type="text" value="${escapeAttr(initialValue)}" autocomplete="off" spellcheck="false">
          <div class="magnetar-owned-dialog-error" aria-live="polite"></div>
          <div class="magnetar-owned-dialog-actions">
            <button type="button" class="magnetar-btn magnetar-btn-secondary magnetar-owned-dialog-cancel">Cancel</button>
            <button type="button" class="magnetar-btn magnetar-btn-primary magnetar-owned-dialog-primary">${escapeHtml(actionLabel)}</button>
          </div>
        </div>
      `;

      let settled = false;
      const cleanup = value => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKeyDown, true);
        overlay.remove();
        resolve(value);
      };
      const input = overlay.querySelector('#magnetar-owned-dialog-input');
      const error = overlay.querySelector('.magnetar-owned-dialog-error');
      const normalizedCurrent = String(currentName || '').trim().toLowerCase();
      const normalizedExisting = existingNames.map(name => String(name || '').trim().toLowerCase()).filter(Boolean);
      const setError = message => {
        if (error) error.textContent = message || '';
      };
      const submit = () => {
        const clean = String(input?.value || '').trim();
        if (!clean) {
          setError(requiredMessage);
          input?.focus();
          return;
        }
        const normalized = clean.toLowerCase();
        if (normalizedExisting.includes(normalized) && normalized !== normalizedCurrent) {
          setError('A folder with that name already exists.');
          input?.focus();
          return;
        }
        cleanup(clean);
      };
      function onKeyDown(event) {
        if (event.key === 'Escape') cleanup(null);
        if (event.key === 'Enter') {
          event.preventDefault();
          submit();
        }
      }

      overlay.addEventListener('mousedown', event => {
        if (event.target === overlay) cleanup(null);
      });
      overlay.querySelector('.magnetar-owned-dialog-close')?.addEventListener('click', () => cleanup(null));
      overlay.querySelector('.magnetar-owned-dialog-cancel')?.addEventListener('click', () => cleanup(null));
      overlay.querySelector('.magnetar-owned-dialog-primary')?.addEventListener('click', submit);
      input?.addEventListener('input', () => setError(''));
      document.addEventListener('keydown', onKeyDown, true);
      document.body.appendChild(overlay);
      requestAnimationFrame(() => {
        input?.focus();
        input?.select();
      });
    });
  }

  function showOrganisedFolderEditorDialog(options = {}) {
    const {
      title = 'Folder',
      label = 'Folder name',
      initialName = '',
      initialColor = 'default',
      actionLabel = 'Save',
      existingNames = [],
      currentName = '',
      requiredMessage = 'Enter a folder name.'
    } = options;
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'magnetar-owned-dialog-overlay';
      overlay.setAttribute('role', 'presentation');
      const currentColor = normaliseOrganisedFolderColor(initialColor);
      overlay.innerHTML = `
        <div class="magnetar-owned-dialog magnetar-owned-folder-dialog" role="dialog" aria-modal="true" aria-labelledby="magnetar-owned-dialog-title">
          <div class="magnetar-owned-dialog-head">
            <div>
              <div class="magnetar-owned-dialog-kicker">Magnetar</div>
              <div class="magnetar-owned-dialog-title" id="magnetar-owned-dialog-title">${escapeHtml(title)}</div>
            </div>
            <button type="button" class="magnetar-owned-dialog-close" aria-label="Close">${closeIconSvg()}</button>
          </div>
          <label class="magnetar-owned-dialog-label" for="magnetar-owned-folder-name">${escapeHtml(label)}</label>
          <input id="magnetar-owned-folder-name" class="magnetar-owned-dialog-input" type="text" value="${escapeAttr(initialName)}" autocomplete="off" spellcheck="false">
          <div class="magnetar-owned-dialog-label">Folder colour</div>
          <div class="magnetar-owned-folder-colors" role="radiogroup" aria-label="Folder colour">
            ${ORGANISED_FOLDER_COLORS.map(entry => `
              <button type="button" class="magnetar-owned-folder-color magnetar-owned-folder-color-${entry.id}${entry.id === currentColor ? ' magnetar-owned-folder-color-active' : ''}" data-folder-color="${escapeAttr(entry.id)}" role="radio" aria-checked="${entry.id === currentColor}" title="${escapeAttr(entry.label)}">
                <span class="magnetar-owned-folder-color-dot" aria-hidden="true"></span>
                <span>${escapeHtml(entry.label)}</span>
              </button>
            `).join('')}
          </div>
          <div class="magnetar-owned-dialog-error" aria-live="polite"></div>
          <div class="magnetar-owned-dialog-actions">
            <button type="button" class="magnetar-btn magnetar-btn-secondary magnetar-owned-dialog-cancel">Cancel</button>
            <button type="button" class="magnetar-btn magnetar-btn-primary magnetar-owned-dialog-primary">${escapeHtml(actionLabel)}</button>
          </div>
        </div>
      `;

      let settled = false;
      let selectedColor = currentColor;
      const cleanup = value => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKeyDown, true);
        overlay.remove();
        resolve(value);
      };
      const input = overlay.querySelector('#magnetar-owned-folder-name');
      const error = overlay.querySelector('.magnetar-owned-dialog-error');
      const normalizedCurrent = String(currentName || '').trim().toLowerCase();
      const normalizedExisting = existingNames.map(name => String(name || '').trim().toLowerCase()).filter(Boolean);
      const setError = message => {
        if (error) error.textContent = message || '';
      };
      const setSelectedColor = color => {
        selectedColor = normaliseOrganisedFolderColor(color);
        overlay.querySelectorAll('.magnetar-owned-folder-color').forEach(button => {
          const active = button.dataset.folderColor === selectedColor;
          button.classList.toggle('magnetar-owned-folder-color-active', active);
          button.setAttribute('aria-checked', String(active));
        });
      };
      const submit = () => {
        const clean = String(input?.value || '').trim();
        if (!clean) {
          setError(requiredMessage);
          input?.focus();
          return;
        }
        const normalized = clean.toLowerCase();
        if (normalizedExisting.includes(normalized) && normalized !== normalizedCurrent) {
          setError('A folder with that name already exists.');
          input?.focus();
          return;
        }
        cleanup({ name: clean, color: selectedColor });
      };
      function onKeyDown(event) {
        if (event.key === 'Escape') cleanup(null);
        if (event.key === 'Enter' && event.target === input) {
          event.preventDefault();
          submit();
        }
      }

      overlay.addEventListener('mousedown', event => {
        if (event.target === overlay) cleanup(null);
      });
      overlay.querySelectorAll('.magnetar-owned-folder-color').forEach(button => {
        button.addEventListener('click', () => setSelectedColor(button.dataset.folderColor || 'default'));
      });
      overlay.querySelector('.magnetar-owned-dialog-close')?.addEventListener('click', () => cleanup(null));
      overlay.querySelector('.magnetar-owned-dialog-cancel')?.addEventListener('click', () => cleanup(null));
      overlay.querySelector('.magnetar-owned-dialog-primary')?.addEventListener('click', submit);
      input?.addEventListener('input', () => setError(''));
      document.addEventListener('keydown', onKeyDown, true);
      document.body.appendChild(overlay);
      requestAnimationFrame(() => {
        input?.focus();
        input?.select();
      });
    });
  }

  function showMagnetarConfirmDialog(options = {}) {
    const {
      title = 'Confirm action',
      message = '',
      detail = '',
      confirmLabel = 'Confirm',
      destructive = false
    } = options;
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'magnetar-owned-dialog-overlay';
      overlay.setAttribute('role', 'presentation');
      overlay.innerHTML = `
        <div class="magnetar-owned-dialog magnetar-owned-dialog-confirm" role="dialog" aria-modal="true" aria-labelledby="magnetar-owned-dialog-title">
          <div class="magnetar-owned-dialog-head">
            <div>
              <div class="magnetar-owned-dialog-kicker">Magnetar</div>
              <div class="magnetar-owned-dialog-title" id="magnetar-owned-dialog-title">${escapeHtml(title)}</div>
            </div>
            <button type="button" class="magnetar-owned-dialog-close" aria-label="Close">${closeIconSvg()}</button>
          </div>
          ${message ? `<div class="magnetar-owned-dialog-copy">${escapeHtml(message)}</div>` : ''}
          ${detail ? `<div class="magnetar-owned-dialog-note">${escapeHtml(detail)}</div>` : ''}
          <div class="magnetar-owned-dialog-actions">
            <button type="button" class="magnetar-btn magnetar-btn-secondary magnetar-owned-dialog-cancel">Cancel</button>
            <button type="button" class="magnetar-btn ${destructive ? 'magnetar-owned-dialog-danger' : 'magnetar-btn-primary'} magnetar-owned-dialog-primary">${escapeHtml(confirmLabel)}</button>
          </div>
        </div>
      `;

      let settled = false;
      const cleanup = value => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKeyDown, true);
        overlay.remove();
        resolve(value);
      };
      function onKeyDown(event) {
        if (event.key === 'Escape') cleanup(false);
        if (event.key === 'Enter') {
          event.preventDefault();
          cleanup(true);
        }
      }

      overlay.addEventListener('mousedown', event => {
        if (event.target === overlay) cleanup(false);
      });
      overlay.querySelector('.magnetar-owned-dialog-close')?.addEventListener('click', () => cleanup(false));
      overlay.querySelector('.magnetar-owned-dialog-cancel')?.addEventListener('click', () => cleanup(false));
      overlay.querySelector('.magnetar-owned-dialog-primary')?.addEventListener('click', () => cleanup(true));
      document.addEventListener('keydown', onKeyDown, true);
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.querySelector('.magnetar-owned-dialog-primary')?.focus());
    });
  }
  function showOrganisedDuplicateItemDialog(options = {}) {
    const { folderName = 'folder', hasCustomName = false, move = false } = options;
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'magnetar-owned-dialog-overlay';
      overlay.setAttribute('role', 'presentation');
      const detail = hasCustomName
        ? 'The existing copy has its own name. Adding another copy will not replace it.'
        : 'Provider files and folders are never changed.';
      overlay.innerHTML = `
        <div class="magnetar-owned-dialog magnetar-owned-dialog-confirm" role="dialog" aria-modal="true" aria-labelledby="magnetar-owned-dialog-title">
          <div class="magnetar-owned-dialog-head">
            <div>
              <div class="magnetar-owned-dialog-kicker">Magnetar</div>
              <div class="magnetar-owned-dialog-title" id="magnetar-owned-dialog-title">Item already in folder</div>
            </div>
            <button type="button" class="magnetar-owned-dialog-close" aria-label="Close">${closeIconSvg()}</button>
          </div>
          <div class="magnetar-owned-dialog-copy">This item is already in ${escapeHtml(folderName)}.</div>
          <div class="magnetar-owned-dialog-note">${escapeHtml(detail)}</div>
          ${move ? '<div class="magnetar-owned-dialog-note">Adding a duplicate will move this copy to the destination folder.</div>' : ''}
          <div class="magnetar-owned-dialog-actions">
            <button type="button" class="magnetar-btn magnetar-btn-secondary magnetar-owned-dialog-keep">Keep existing</button>
            <button type="button" class="magnetar-btn magnetar-btn-primary magnetar-owned-dialog-duplicate">Add duplicate</button>
          </div>
        </div>
      `;

      let settled = false;
      const cleanup = value => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKeyDown, true);
        overlay.remove();
        resolve(value);
      };
      function onKeyDown(event) {
        if (event.key === 'Escape') cleanup('keep');
      }
      overlay.addEventListener('mousedown', event => {
        if (event.target === overlay) cleanup('keep');
      });
      overlay.querySelector('.magnetar-owned-dialog-close')?.addEventListener('click', () => cleanup('keep'));
      overlay.querySelector('.magnetar-owned-dialog-keep')?.addEventListener('click', () => cleanup('keep'));
      overlay.querySelector('.magnetar-owned-dialog-duplicate')?.addEventListener('click', () => cleanup('duplicate'));
      document.addEventListener('keydown', onKeyDown, true);
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.querySelector('.magnetar-owned-dialog-keep')?.focus());
    });
  }
  function showMagnetarFolderPickerDialog(options = {}) {
    const { title = 'Move to folder', itemLabel = 'Folder item', folders = [], currentFolderId = '' } = options;
    const choices = (Array.isArray(folders) ? folders : []).filter(folder => folder?.id && folder.id !== currentFolderId);
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'magnetar-owned-dialog-overlay';
      overlay.setAttribute('role', 'presentation');
      overlay.innerHTML = `
        <div class="magnetar-owned-dialog magnetar-owned-dialog-picker" role="dialog" aria-modal="true" aria-labelledby="magnetar-owned-dialog-title">
          <div class="magnetar-owned-dialog-head">
            <div>
              <div class="magnetar-owned-dialog-kicker">Magnetar</div>
              <div class="magnetar-owned-dialog-title" id="magnetar-owned-dialog-title">${escapeHtml(title)}</div>
            </div>
            <button type="button" class="magnetar-owned-dialog-close" aria-label="Close">${closeIconSvg()}</button>
          </div>
          <div class="magnetar-owned-dialog-copy">${escapeHtml(itemLabel)}</div>
          <div class="magnetar-owned-dialog-note">Provider files and folders are never changed.</div>
          <div class="magnetar-owned-folder-picker">
            ${choices.length ? choices.map(folder => `
              <button type="button" class="magnetar-owned-folder-choice" data-folder-id="${escapeAttr(folder.id)}">
                <span class="magnetar-owned-folder-choice-icon">${folderIconSvg()}</span>
                <span class="magnetar-owned-folder-choice-name">${escapeHtml(folder.name || 'Folder')}</span>
                <span class="magnetar-owned-folder-choice-count">${Array.isArray(folder.items) ? folder.items.length : 0}</span>
              </button>
            `).join('') : '<div class="magnetar-owned-dialog-error">No other folders are available.</div>'}
          </div>
          <div class="magnetar-owned-dialog-actions">
            <button type="button" class="magnetar-btn magnetar-btn-secondary magnetar-owned-dialog-cancel">Cancel</button>
          </div>
        </div>
      `;

      let settled = false;
      const cleanup = value => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKeyDown, true);
        overlay.remove();
        resolve(value);
      };
      function onKeyDown(event) {
        if (event.key === 'Escape') cleanup(null);
      }
      overlay.addEventListener('mousedown', event => {
        if (event.target === overlay) cleanup(null);
      });
      overlay.querySelector('.magnetar-owned-dialog-close')?.addEventListener('click', () => cleanup(null));
      overlay.querySelector('.magnetar-owned-dialog-cancel')?.addEventListener('click', () => cleanup(null));
      overlay.querySelectorAll('.magnetar-owned-folder-choice').forEach(button => {
        button.addEventListener('click', () => cleanup(button.dataset.folderId || null));
      });
      document.addEventListener('keydown', onKeyDown, true);
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.querySelector('.magnetar-owned-folder-choice, .magnetar-owned-dialog-cancel')?.focus());
    });
  }
  function normalizeFolderHash(value) {
    try {
      return MagnetarDetector?.normaliseHash ? MagnetarDetector.normaliseHash(value || '') : String(value || '').trim().toLowerCase();
    } catch (e) {
      return String(value || '').trim().toLowerCase();
    }
  }

  function hashFromFolderMagnet(value) {
    try {
      return MagnetarDetector?.hashFromMagnet ? MagnetarDetector.hashFromMagnet(value || '') : '';
    } catch (e) {
      return '';
    }
  }

  function providerFolderItemKey(item, providerMode) {
    const hash = normalizeFolderHash(item?.hash || item?.infoHash) || hashFromFolderMagnet(item?.magnet || item?.magnetUri || item?.link);
    if (hash) return `hash:${hash.toLowerCase()}`;
    const magnet = String(item?.magnetUri || item?.magnet || '').trim();
    if (magnet) return `magnet:${magnet}`;
    const provider = String(providerMode || item?.providerId || item?.provider || '').trim();
    const id = String(item?.providerItemId || item?.torrentId || item?.id || item?.providerItemKey || '').trim();
    if (provider && id) return `provider:${provider}:${id}`;
    const sourceUrl = safeSourceUrl(item) || String(item?.link || item?.url || '').trim();
    const title = String(item?.name || item?.title || '').trim().toLowerCase();
    if (sourceUrl && title) return `source:${sourceUrl}:${title}`;
    return `fallback:${provider}:${id}:${title || Date.now()}`;
  }

  function buildProviderFolderItem(item, providerLabel, providerMode, index = 0) {
    const now = Date.now();
    const title = String(item?.mediaName || item?.title || item?.name || item?.filename || 'Client item').trim() || 'Client item';
    const magnet = String(item?.magnetUri || item?.magnet || '').trim();
    const hash = normalizeFolderHash(item?.hash || item?.infoHash) || hashFromFolderMagnet(magnet || item?.link);
    const sourceUrl = safeSourceUrl(item) || String(item?.sourceUrl || item?.url || '').trim();
    const provider = String(providerMode || item?.providerId || item?.provider || providerLabel || '').trim();
    return {
      id: `chrome-client-item-${now.toString(36)}-${index}`,
      itemKey: providerFolderItemKey(item, providerMode),
      title,
      name: title,
      displayName: '',
      kind: 'provider-item',
      clientType: providerMode || provider,
      order: 0,
      addedAt: now,
      updatedAt: now,
      provider,
      sourceProvider: providerMode || provider,
      providerItemId: String(item?.providerItemId || item?.torrentId || item?.id || '').trim(),
      providerItemKey: String(item?.providerItemKey || item?.providerItemId || item?.torrentId || item?.id || '').trim(),
      fileId: '',
      providerFileId: '',
      filePath: '',
      parentItemKey: '',
      parentTitle: '',
      torrentId: String(item?.torrentId || item?.id || '').trim(),
      hash,
      infoHash: hash,
      magnet,
      magnetUri: magnet,
      url: sourceUrl,
      sourceUrl,
      sourceDomain: sourceDomain({ ...item, sourceUrl }),
      status: item?.status || '',
      availability: item?.availability || '',
      mediaKind: item?.mediaKind || item?.type || ''
    };
  }

  function folderContainsItem(folder, itemKey) {
    return Array.isArray(folder?.items) && folder.items.some(item => String(item?.itemKey || '') === itemKey);
  }

  function folderPlusIconSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"/><path d="M12 10v6"/><path d="M9 13h6"/></svg>';
  }

  function checkIconSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  }

  function showMagnetarAddToFolderDialog(options = {}) {
    const { itemLabel = 'Client item', folders = [], itemKey = '', item = null } = options;
    const choices = Array.isArray(folders) ? folders.filter(folder => folder?.id) : [];
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'magnetar-owned-dialog-overlay';
      overlay.setAttribute('role', 'presentation');
      overlay.innerHTML = `
        <div class="magnetar-owned-dialog magnetar-owned-dialog-picker" role="dialog" aria-modal="true" aria-labelledby="magnetar-owned-dialog-title">
          <div class="magnetar-owned-dialog-head">
            <div>
              <div class="magnetar-owned-dialog-kicker">Magnetar</div>
              <div class="magnetar-owned-dialog-title" id="magnetar-owned-dialog-title">Add to folder</div>
            </div>
            <button type="button" class="magnetar-owned-dialog-close" aria-label="Close">${closeIconSvg()}</button>
          </div>
          <div class="magnetar-owned-dialog-copy">${escapeHtml(itemLabel)}</div>
          <div class="magnetar-owned-dialog-note">Provider files and folders are never changed.</div>
          <div class="magnetar-owned-folder-picker">
            ${choices.length ? choices.map(folder => {
              const checked = item ? folderContainsStableItem(folder, item) : folderContainsItem(folder, itemKey);
              return `
                <button type="button" class="magnetar-owned-folder-choice ${checked ? 'magnetar-owned-folder-choice-checked' : ''}" data-folder-id="${escapeAttr(folder.id)}" data-checked="${checked ? 'true' : 'false'}">
                  <span class="magnetar-owned-folder-choice-icon">${checked ? checkIconSvg() : folderIconSvg()}</span>
                  <span class="magnetar-owned-folder-choice-name">${escapeHtml(folder.name || 'Folder')}</span>
                  <span class="magnetar-owned-folder-choice-count">${Array.isArray(folder.items) ? folder.items.length : 0}</span>
                </button>
              `;
            }).join('') : '<div class="magnetar-owned-dialog-error">No folders are available yet.</div>'}
            <button type="button" class="magnetar-owned-folder-choice magnetar-owned-folder-choice-new" data-action="new-folder">
              <span class="magnetar-owned-folder-choice-icon">${folderActionIconSvg('plus')}</span>
              <span class="magnetar-owned-folder-choice-name">New Folder</span>
              <span class="magnetar-owned-folder-choice-count">+</span>
            </button>
          </div>
          <div class="magnetar-owned-dialog-actions">
            <button type="button" class="magnetar-btn magnetar-btn-secondary magnetar-owned-dialog-cancel">Cancel</button>
          </div>
        </div>
      `;

      let settled = false;
      const cleanup = value => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKeyDown, true);
        overlay.remove();
        resolve(value);
      };
      function onKeyDown(event) {
        if (event.key === 'Escape') cleanup(null);
      }
      overlay.addEventListener('mousedown', event => {
        if (event.target === overlay) cleanup(null);
      });
      overlay.querySelector('.magnetar-owned-dialog-close')?.addEventListener('click', () => cleanup(null));
      overlay.querySelector('.magnetar-owned-dialog-cancel')?.addEventListener('click', () => cleanup(null));
      overlay.querySelectorAll('.magnetar-owned-folder-choice').forEach(button => {
        button.addEventListener('click', () => {
          if (button.dataset.action === 'new-folder') return cleanup({ action: 'new' });
          cleanup({ action: button.dataset.checked === 'true' ? 'already' : 'add', folderId: button.dataset.folderId || '' });
        });
      });
      document.addEventListener('keydown', onKeyDown, true);
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.querySelector('.magnetar-owned-folder-choice, .magnetar-owned-dialog-cancel')?.focus());
    });
  }
  async function renderClientPanel(result, detection) {
    const wrap = document.getElementById('magnetar-expanded-section');
    if (!wrap) return;

    closeOrganisedQuickviewPopover();
    const providerMode = result?.mode || currentQuickSendTarget || mode || 'local';
    const providerLabel = result?.provider || getProviderName(providerMode);
    const panelTitle = getClientPanelTitle(providerMode, providerLabel);
    const page = Math.max(1, Number(result?.page) || 1);
    const items = Array.isArray(result?.items) ? result.items : [];
    currentClientPanelItems = result?.success ? items : [];
    const total = Number.isFinite(result?.total) ? result.total : null;
    const hasPrevious = page > 1;
    const hasNext = result?.hasMore === true || (total !== null && page * CLIENT_PANEL_PAGE_SIZE < total);
    const totalPages = total !== null ? Math.max(1, Math.ceil(total / CLIENT_PANEL_PAGE_SIZE)) : null;
    const pageText = totalPages ? `Page ${page} of ${totalPages}` : `Page ${page}`;
    const organisedState = await loadOrganisedFoldersState();
    const clientViewSwitch = renderClientViewSwitch(organisedState.folders.length);
    const canAddProviderItemsToFolder = organisedState.mobileAcknowledged && !!organisedState.section && organisedState.folders.length > 0;
    let body = '';
    if (clientPanelView === 'organised') {
      body = renderOrganisedClientBody(organisedState);
    } else if (result?.setupRequired) {
      body = '<div class="magnetar-activity-empty">Set up a client first.</div>';
    } else if (result?.unsupported) {
      body = '<div class="magnetar-activity-empty">This client does not support toolbar browsing yet.</div>';
    } else if (!result?.success) {
      body = `<div class="magnetar-activity-empty">${escapeHtml(result?.error || 'Could not load client items.')}</div>`;
    } else if (!items.length) {
      body = '<div class="magnetar-activity-empty">No client items found.</div>';
    } else {
      body = items.map((item, index) => renderProviderFileRow(item, providerLabel, providerMode, index, canAddProviderItemsToFolder)).join('');
    }

    const pagination = result?.success && clientPanelView === 'provider' ? `
      <div class="magnetar-provider-files-pagination">
        <button type="button" class="magnetar-activity-pill magnetar-provider-files-prev" ${hasPrevious ? '' : 'disabled'}>Previous</button>
        <span class="magnetar-provider-files-page">${escapeHtml(pageText)}</span>
        <button type="button" class="magnetar-activity-pill magnetar-provider-files-next" ${hasNext ? '' : 'disabled'}>Next</button>
      </div>
    ` : '';

    const headingAction = clientPanelView === 'provider'
      ? `<button class="magnetar-panel-send-target" id="magnetar-client-send-target" type="button" ${getQuickSendTargetOptions().length ? '' : 'disabled'}>
            <span class="magnetar-panel-send-target-label">${escapeHtml(providerLabel)}</span>
            ${getQuickSendTargetOptions().length ? `<span class="magnetar-panel-send-target-arrow">${chevronDownIconSvg()}</span>` : ''}
          </button>`
      : '<span class="magnetar-provider-files-page">From Magnetar Mobile</span>';

    wrap.innerHTML = `
      <div class="magnetar-expanded-inner magnetar-client-files-panel">
        <div class="magnetar-section-heading">
          <span>${clientPanelView === 'organised' ? 'ORGANISED' : `${escapeHtml(panelTitle)}${total !== null ? ` <span class="magnetar-saved-count">${total}</span>` : ''}`}</span>
          ${headingAction}
        </div>
        <div class="magnetar-section-help">${clientPanelView === 'organised' ? '<span class="magnetar-organised-intro-line">Your Magnetar folders sync between the app and extension.</span><span class="magnetar-organised-intro-line">They organise things in Magnetar only &mdash; provider files are never changed.</span><span class="magnetar-organised-intro-line">Set up the provider on this browser to browse and open the files inside.</span>' : 'Client items are loaded on demand from the selected toolbar target.'}</div>
        <div class="magnetar-client-view-bar">${clientViewSwitch}${renderOrganisedFolderControls(organisedState.mobileAcknowledged)}</div>
        <div class="magnetar-provider-files ${clientPanelView === 'organised' ? 'magnetar-organised-files' : ''}">${body}</div>
        ${pagination}
        <div class="magnetar-bfoot">
          <span>v${MAGNETAR_API.runtime.getManifest().version} - ${escapeHtml(clientPanelView === 'organised' ? 'ORGANISED' : String(providerMode).toUpperCase())}</span>
          <span class="magnetar-bfoot-tagline">Client stays in the toolbar</span>
        </div>
      </div>
    `;

    wrap.querySelectorAll('.magnetar-client-view-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const nextView = btn.dataset.clientView === 'organised' ? 'organised' : 'provider';
        if (nextView === 'organised') {
          clientPanelView = 'organised';
          organisedOpenFolderId = '';
          organisedOpenItemFilter = '';
          organisedOpenItemPage = 1;
          organisedFolderPage = 1;
          closeOrganisedQuickviewPopover();
          closeMagnetarOwnedDialogs();
        } else {
          if (clientPanelView === nextView) return;
          clientPanelView = nextView;
          organisedOpenFolderId = '';
          closeOrganisedQuickviewPopover();
          closeMagnetarOwnedDialogs();
        }
        await renderClientPanel(result, detection);
      });
    });

    wrap.querySelector('#magnetar-organised-sync-open')?.addEventListener('click', async () => {
      await openSyncPanelWithNotice('Pair Magnetar Mobile to bring your organised folders into the extension.');
    });

    wrap.querySelectorAll('.magnetar-organised-mobile-link').forEach(button => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        safeRuntimeMessage({ type: 'open-external-url', url: MOBILE_URL });
      });
    });

    const organisedFilterInput = wrap.querySelector('#magnetar-organised-filter');
    organisedFilterInput?.addEventListener('input', () => {
      organisedFolderFilter = organisedFilterInput.value || '';
      organisedFolderPage = 1;
      if (organisedFilterTimer) clearTimeout(organisedFilterTimer);
      organisedFilterTimer = setTimeout(() => renderClientPanel(result, detection), 180);
    });
    wrap.querySelectorAll('#magnetar-organised-new-folder, #magnetar-organised-new-folder-empty').forEach(button => button.addEventListener('click', async () => {
      const folderEdit = await showOrganisedFolderEditorDialog({
        title: 'New folder',
        label: 'Folder name',
        initialName: 'New Folder',
        initialColor: 'default',
        actionLabel: 'Create',
        existingNames: organisedState.folders.map(entry => entry.name),
        requiredMessage: 'Enter a folder name.'
      });
      const clean = String(folderEdit?.name || '').trim();
      if (!clean) return;
      const response = await safeRuntimeMessage({ type: 'create-organised-folder', name: clean, color: normaliseOrganisedFolderColor(folderEdit.color) }, null);
      if (!response?.ok) {
        showToast(response?.error || 'Could not create folder', true);
        return;
      }
      organisedOpenFolderId = '';
      showToast('Folder created');
      await populateClientPanel(result, providerMode, page);
    }));
    wrap.querySelectorAll('.magnetar-organised-folder-card').forEach(card => {
      card.addEventListener('click', async event => {
        if (event.target?.closest?.('button, a, input, select, textarea, [data-organised-action]')) return;
        const folderId = card.dataset.folderId || '';
        if (!folderId) return;
        closeOrganisedQuickviewPopover();
        organisedOpenFolderId = folderId;
        organisedOpenItemPage = 1;
        await renderClientPanel(result, detection);
      });
    });

    wrap.querySelectorAll('[data-organised-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.organisedAction;
        const folderId = btn.dataset.folderId || '';
        const folder = organisedState.folders.find(entry => entry.id === folderId);
        if (!folder) return;
        if (action === 'quickview') {
          showOrganisedQuickviewPopover(folder, organisedState.labelIndex, btn);
          return;
        }
        if (action === 'open') {
          closeOrganisedQuickviewPopover();
          organisedOpenFolderId = folderId;
          organisedOpenItemPage = 1;
          await renderClientPanel(result, detection);
          return;
        }
        if (action === 'rename') {
          const folderEdit = await showOrganisedFolderEditorDialog({
            title: 'Edit folder',
            label: 'Folder name',
            initialName: folder.name || 'Folder',
            initialColor: folder.color || 'default',
            actionLabel: 'Save',
            existingNames: organisedState.folders.map(entry => entry.name),
            currentName: folder.name || 'Folder',
            requiredMessage: 'Enter a folder name.'
          });
          const clean = String(folderEdit?.name || '').trim();
          const color = normaliseOrganisedFolderColor(folderEdit?.color || folder.color);
          if (!clean || (clean === folder.name && color === normaliseOrganisedFolderColor(folder.color))) return;
          const response = await safeRuntimeMessage({ type: 'rename-organised-folder', folderId, name: clean, color }, null);
          if (!response?.ok) {
            showToast(response?.error || 'Could not rename folder', true);
            return;
          }
          showToast('Folder renamed');
          await populateClientPanel(result, providerMode, page);
          return;
        }
        if (action === 'delete') {
          const confirmed = await showMagnetarConfirmDialog({
            title: 'Delete folder',
            message: `Delete "${folder.name || 'Folder'}" from Magnetar folders?`,
            detail: 'Provider files and folders are never changed.',
            confirmLabel: 'Delete',
            destructive: true
          });
          if (!confirmed) return;
          const response = await safeRuntimeMessage({ type: 'delete-organised-folder', folderId }, null);
          if (!response?.ok) {
            showToast(response?.error || 'Could not delete folder', true);
            return;
          }
          closeOrganisedQuickviewPopover();
          if (organisedOpenFolderId === folderId) organisedOpenFolderId = '';
          showToast('Folder deleted');
          await populateClientPanel(result, providerMode, page);
        }
      });
    });

    wrap.querySelector('#magnetar-organised-back')?.addEventListener('click', async () => {
      organisedOpenFolderId = '';
      await renderClientPanel(result, detection);
    });

    const openItemFilter = wrap.querySelector('#magnetar-organised-item-filter');
    openItemFilter?.addEventListener('input', () => {
      organisedOpenItemFilter = openItemFilter.value || '';
      organisedOpenItemPage = 1;
      if (organisedOpenItemFilterTimer) clearTimeout(organisedOpenItemFilterTimer);
      organisedOpenItemFilterTimer = setTimeout(() => renderClientPanel(result, detection), 160);
    });
    wrap.querySelector('#magnetar-organised-item-sort')?.addEventListener('change', async (event) => {
      organisedOpenItemSort = event.target.value || 'newest';
      organisedOpenItemPage = 1;
      await renderClientPanel(result, detection);
    });
    wrap.querySelector('#magnetar-organised-item-page-size')?.addEventListener('change', async (event) => {
      organisedOpenItemPageSize = Number(event.target.value) || 25;
      organisedOpenItemPage = 1;
      await renderClientPanel(result, detection);
    });
    wrap.querySelector('.magnetar-organised-item-page-prev')?.addEventListener('click', async () => {
      if (organisedOpenItemPage > 1) organisedOpenItemPage -= 1;
      await renderClientPanel(result, detection);
    });
    wrap.querySelector('.magnetar-organised-item-page-next')?.addEventListener('click', async () => {
      organisedOpenItemPage += 1;
      await renderClientPanel(result, detection);
    });

    wrap.querySelectorAll('[data-organised-item-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const folder = organisedState.folders.find(entry => entry.id === organisedOpenFolderId);
        const itemIndex = Number(btn.dataset.itemIndex);
        const item = folder && Number.isInteger(itemIndex) ? (folder.items || [])[itemIndex] : null;
        if (!folder || !item) return;
        const action = btn.dataset.organisedItemAction;
        const label = resolveFolderItemLabel(item, organisedState.labelIndex);
        if (action === 'url') {
          const url = getOrganisedItemUrl(item);
          if (!url) return showToast('No URL available for this item', true);
          safeRuntimeMessage({ type: 'open-external-url', url });
          return;
        }
        if (action === 'copy') {
          const value = getOrganisedItemCopyValue(item);
          if (!value) return showToast('Nothing to copy for this item', true);
          await handleCopy(value, 'Item copied');
          return;
        }
        if (action === 'rename') {
          const name = await showMagnetarTextDialog({
            title: 'Rename item',
            label: 'Display name',
            initialValue: item.displayName || label,
            actionLabel: 'Rename'
          });
          const clean = String(name || '').trim();
          if (!clean || clean === item.displayName || clean === label) return;
          const response = await safeRuntimeMessage({ type: 'rename-organised-folder-item', folderId: folder.id, itemIndex, displayName: clean }, null);
          if (!response?.ok) return showToast(response?.error || 'Could not rename item', true);
          showToast('Item renamed');
          await populateClientPanel(result, providerMode, page);
          return;
        }
        if (action === 'move') {
          const destinationId = await showMagnetarFolderPickerDialog({
            title: 'Move to folder',
            itemLabel: label,
            folders: organisedState.folders,
            currentFolderId: folder.id
          });
          if (!destinationId) return;
          const targetFolder = organisedState.folders.find(entry => entry.id === destinationId);
          let allowDuplicate = false;
          if (targetFolder && folderContainsStableItem(targetFolder, item)) {
            const duplicateChoice = await showOrganisedDuplicateItemDialog({
              folderName: targetFolder.name || 'folder',
              hasCustomName: (targetFolder.items || []).some(entry => organisedItemsShareStableKey(entry, item) && !!folderLabelCandidate(entry.displayName)),
              move: true
            });
            if (duplicateChoice !== 'duplicate') {
              showToast('Kept existing item.');
              return;
            }
            allowDuplicate = true;
          }
          const response = await safeRuntimeMessage({ type: 'move-organised-folder-item', fromFolderId: folder.id, toFolderId: destinationId, itemIndex, allowDuplicate }, null);
          if (!response?.ok) return showToast(response?.error || 'Could not move item', true);
          showToast('Item moved');
          await populateClientPanel(result, providerMode, page);
          return;
        }
        if (action === 'airlock') {
          btn.disabled = true;
          btn.classList.add('magnetar-provider-file-download-loading');
          const response = await safeRuntimeMessage({
            type: 'airlock-client-item',
            mode: 'torbox',
            airlocked: item.airlocked !== true,
            folderId: folder.id,
            itemIndex,
            item: {
              id: item.id || '',
              torrent_id: item.torrent_id || item.torrentId || item.providerItemId || item.id || '',
              torrentId: item.torrentId || item.torrent_id || item.providerItemId || item.id || '',
              providerItemId: item.providerItemId || item.torrent_id || item.torrentId || item.id || '',
              providerItemKey: item.providerItemKey || item.providerItemId || item.torrent_id || item.torrentId || item.id || '',
              transfer_id: item.transfer_id || item.transferId || '',
              transferId: item.transferId || item.transfer_id || '',
              clientItemId: item.clientItemId || '',
              name: label,
              provider: item.provider || '',
              sourceProvider: item.sourceProvider || ''
            }
          }, { success: false, error: 'Could not airlock this TorBox item.' });
          btn.classList.remove('magnetar-provider-file-download-loading');
          if (!response?.success) {
            btn.disabled = false;
            showToast(response?.error || 'Could not airlock this TorBox item.', true);
            return;
          }
          showToast(item.airlocked === true ? 'Airlock removed in TorBox.' : 'Airlocked in TorBox.');
          await populateClientPanel(result, providerMode, page);
          return;
        }
        if (action === 'open') {
          await browseOrganisedFolderItem(item, label, providerMode);
          return;
        }
        if (action === 'delete') {
          const confirmed = await showMagnetarConfirmDialog({
            title: 'Remove from folder',
            message: `Remove ${label} from this Magnetar folder?`,
            detail: 'Provider files and folders are never changed.',
            confirmLabel: 'Remove',
            destructive: true
          });
          if (!confirmed) return;
          const response = await safeRuntimeMessage({ type: 'remove-organised-folder-item', folderId: folder.id, itemIndex }, null);
          if (!response?.ok) return showToast(response?.error || 'Could not remove item', true);
          showToast('Removed from folder');
          await populateClientPanel(result, providerMode, page);
        }
      });
    });
    wrap.querySelector('.magnetar-organised-page-prev')?.addEventListener('click', async () => {
      if (organisedFolderPage > 1) organisedFolderPage -= 1;
      await renderClientPanel(result, detection);
    });
    wrap.querySelector('.magnetar-organised-page-next')?.addEventListener('click', async () => {
      organisedFolderPage += 1;
      await renderClientPanel(result, detection);
    });
    wrap.querySelector('#magnetar-client-send-target')?.addEventListener('click', (e) => {
      const options = getQuickSendTargetOptions();
      if (!options.length) return;
      showProviderTargetMenu(e.currentTarget, options, async selectedMode => {
        currentQuickSendTarget = selectedMode;
        updateQuickSendTargetButtons();
        clientPanelView = 'provider';
        await populateClientPanel(detection, selectedMode, 1);
      });
    });

    wrap.querySelector('.magnetar-provider-files-prev')?.addEventListener('click', () => {
      if (hasPrevious) populateClientPanel(detection, providerMode, page - 1);
    });
    wrap.querySelector('.magnetar-provider-files-next')?.addEventListener('click', () => {
      if (hasNext) populateClientPanel(detection, providerMode, page + 1);
    });

    wrap.querySelectorAll('.magnetar-provider-file-add-folder').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!organisedState.mobileAcknowledged || !organisedState.section || !organisedState.folders.length) return;
        const index = Number(btn.dataset.index);
        const item = Number.isInteger(index) ? currentClientPanelItems[index] : null;
        if (!item) {
          showToast('Folder add unavailable', true);
          return;
        }
        const folderItem = buildProviderFolderItem(item, providerLabel, providerMode, index);
        const choice = await showMagnetarAddToFolderDialog({
          itemLabel: folderItem.displayName || folderItem.title || folderItem.name || 'Client item',
          folders: organisedState.folders,
          itemKey: folderItem.itemKey,
          item: folderItem
        });
        if (!choice) return;
        let folderId = choice.folderId || '';
        let allowDuplicate = false;
        if (choice.action === 'already') {
          const folder = organisedState.folders.find(entry => entry.id === folderId);
          const duplicateChoice = await showOrganisedDuplicateItemDialog({
            folderName: folder?.name || 'folder',
            hasCustomName: (folder?.items || []).some(entry => organisedItemsShareStableKey(entry, folderItem) && !!folderLabelCandidate(entry.displayName))
          });
          if (duplicateChoice !== 'duplicate') {
            showToast('Kept existing item.');
            return;
          }
          allowDuplicate = true;
        }
        if (choice.action === 'new') {
          const folderEdit = await showOrganisedFolderEditorDialog({
            title: 'New folder',
            label: 'Folder name',
            initialName: 'New Folder',
            initialColor: 'default',
            actionLabel: 'Create',
            existingNames: organisedState.folders.map(entry => entry.name),
            requiredMessage: 'Enter a folder name.'
          });
          const clean = String(folderEdit?.name || '').trim();
          if (!clean) return;
          const created = await safeRuntimeMessage({ type: 'create-organised-folder', name: clean, color: normaliseOrganisedFolderColor(folderEdit.color) }, null);
          if (!created?.ok || !created.folder?.id) {
            showToast(created?.error || 'Could not create folder', true);
            return;
          }
          folderId = created.folder.id;
        }
        if (!folderId) return;
        const targetFolder = organisedState.folders.find(entry => entry.id === folderId);
        if (!allowDuplicate && targetFolder && folderContainsStableItem(targetFolder, folderItem)) {
          const duplicateChoice = await showOrganisedDuplicateItemDialog({
            folderName: targetFolder.name || 'folder',
            hasCustomName: (targetFolder.items || []).some(entry => organisedItemsShareStableKey(entry, folderItem) && !!folderLabelCandidate(entry.displayName))
          });
          if (duplicateChoice !== 'duplicate') {
            showToast('Kept existing item.');
            return;
          }
          allowDuplicate = true;
        }
        const response = await safeRuntimeMessage({ type: 'add-organised-folder-item', folderId, item: folderItem, allowDuplicate }, null);
        if (!response?.ok) {
          showToast(response?.error || 'Could not add to folder', true);
          return;
        }
        const folderName = response.folderName || organisedState.folders.find(entry => entry.id === folderId)?.name || 'folder';
        showToast(response.already ? `Already in ${folderName}` : `Added to ${folderName}`);
        await populateClientPanel(detection, providerMode, page);
      });
    });
    wrap.querySelectorAll('.magnetar-provider-file-airlock').forEach(btn => {
      if (btn.dataset.organisedItemAction) return;
      btn.addEventListener('click', event => handleClientItemAirlock(event, btn, providerMode, detection, page));
    });
    wrap.querySelectorAll('.magnetar-provider-file-download').forEach(btn => {
      btn.addEventListener('click', () => handleClientItemDownload(btn, providerMode));
    });
    wrap.querySelectorAll('.magnetar-provider-file-open').forEach(btn => {
      btn.addEventListener('click', () => handleClientItemOpen(btn, providerMode));
    });
  }
  function renderProviderFileRow(item, providerLabel, providerMode, index, canAddToFolder = false) {
    const name = item?.name || 'Unnamed item';
    const type = item?.type || 'item';
    const size = item?.size ? formatFileSize(item.size) : '';
    const status = item?.status || '';
    const added = item?.added ? formatClientItemDate(item.added) : '';
    const meta = [type, size, status, added, item?.provider || providerLabel].filter(Boolean).join(' - ');
    const canDownload = providerMode !== 'alldebrid' && canDownloadClientItem(item, providerMode);
    const openLabel = getClientOpenLabel(providerMode, providerLabel);
    const openTitleLabel = getClientOpenTitleLabel(providerMode, providerLabel);
    const canOpen = canOpenClientItem(item, providerMode);
    const openTitle = canOpen ? `${openTitleLabel}` : 'Open unavailable';
    const openAction = `<button type="button" class="magnetar-provider-file-open magnetar-provider-file-open-pill" data-index="${index}" title="${escapeAttr(openTitle)}" aria-label="${escapeAttr(openTitle)}" ${canOpen ? '' : 'disabled'}>${escapeHtml(openLabel)}</button>`;
    const downloadTitle = canDownload ? 'Download' : 'Download unavailable';
    const downloadAction = canDownload ? `<button type="button" class="magnetar-provider-file-download" data-index="${index}" title="${downloadTitle}" aria-label="${downloadTitle}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
        </button>` : '';
    const folderAction = canAddToFolder ? `<button type="button" class="magnetar-provider-file-add-folder" data-index="${index}" title="Add to folder" aria-label="Add to folder">${folderPlusIconSvg()}</button>` : '';
    const isTorBoxRow = isTorBoxProviderItem(item, providerMode, providerLabel);
    const airlockedBadge = isTorBoxRow && item?.airlocked === true ? renderAirlockedBadge() : '';
    const hasAirlockId = Boolean(torBoxTorrentId(item, true));
    const airlockAction = isTorBoxRow ? renderAirlockToggleButton(index, item?.airlocked === true, { disabled: !hasAirlockId }) : '';
    const action = `<div class="magnetar-provider-file-actions">${airlockAction}${openAction}${folderAction}${downloadAction}</div>`;
    return `
      <div class="magnetar-provider-file-row" title="${escapeAttr(name)}">
        <div class="magnetar-provider-file-main">
          <span class="magnetar-provider-file-name">${escapeHtml(name)}</span>
          <span class="magnetar-provider-file-meta">${escapeHtml(meta)}${airlockedBadge ? ` ${airlockedBadge}` : ''}</span>
        </div>
        ${action}
      </div>
    `;
  }

  function getClientOpenLabel(providerMode, providerLabel) {
    const labels = {
      local: 'Local',
      qbittorrent: 'qBittorrent',
      realdebrid: 'Real-Debrid',
      rdtclient: 'RDT',
      torbox: 'TorBox',
      premiumize: 'Premiumize',
      alldebrid: 'AllDebrid'
    };
    return labels[providerMode] || (providerLabel || 'Client');
  }

  function getClientOpenTitleLabel(providerMode, providerLabel) {
    const labels = {
      local: 'Open in qBittorrent',
      qbittorrent: 'Open in qBittorrent',
      realdebrid: 'Open in Real-Debrid',
      rdtclient: 'Open in RDT',
      torbox: 'Open in TorBox',
      premiumize: 'Open in Premiumize',
      alldebrid: 'Open in AllDebrid'
    };
    return labels[providerMode] || `Open in ${providerLabel || 'Client'}`;
  }

  function canOpenClientItem(item, providerMode) {
    if (!item) return false;
    if (providerMode === 'alldebrid') return canDownloadClientItem(item, providerMode);
    return ['local', 'realdebrid', 'rdtclient', 'torbox', 'premiumize'].includes(providerMode);
  }

  function canDownloadClientItem(item, providerMode) {
    if (!item) return false;
    if (Object.prototype.hasOwnProperty.call(item, 'downloadable') && item.downloadable === false) return false;
    if (providerMode === 'torbox') {
      if (Object.prototype.hasOwnProperty.call(item, 'downloadable')) return Boolean(item.downloadable);
      return Boolean(item.id) && String(item.type || '').toLowerCase() === 'torrent';
    }
    if (Object.prototype.hasOwnProperty.call(item, 'downloadable') && item.downloadable === true) return true;
    if (String(item.link || '').trim()) return true;
    return providerMode === 'realdebrid' && Boolean(item.id);
  }

  function updateClientPanelCacheAirlock(providerMode, page, index, airlocked) {
    const cacheKey = getClientPanelCacheKey(providerMode, page);
    const cached = clientPanelCache.get(cacheKey);
    if (!cached || !Array.isArray(cached.items) || !cached.items[index]) return;
    const items = cached.items.slice();
    items[index] = { ...items[index], airlocked };
    clientPanelCache.set(cacheKey, { ...cached, items });
  }

  function updateProviderAirlockRow(btn, airlocked) {
    if (!btn) return;
    const title = airlocked ? 'Remove Airlock in TorBox' : 'Airlock in TorBox';
    btn.dataset.airlocked = airlocked ? 'true' : 'false';
    btn.setAttribute('aria-pressed', airlocked ? 'true' : 'false');
    btn.setAttribute('title', title);
    btn.setAttribute('aria-label', title);
    btn.classList.toggle('magnetar-provider-file-airlock-active', airlocked);

    const row = btn.closest('.magnetar-provider-file-row');
    const meta = row?.querySelector('.magnetar-provider-file-meta');
    const existingBadge = meta?.querySelector('.magnetar-airlocked-badge');
    if (airlocked && meta && !existingBadge) {
      meta.insertAdjacentHTML('beforeend', ` ${renderAirlockedBadge()}`);
    } else if (!airlocked && existingBadge) {
      existingBadge.remove();
    }
  }

  async function handleClientItemAirlock(event, btn, providerMode, detection, page) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!btn || btn.disabled) return;
    const index = Number(btn.dataset.index);
    const item = Number.isInteger(index) ? currentClientPanelItems[index] : null;
    if (!isTorBoxProviderItem(item || {}, providerMode, 'TorBox')) return;
    const torrentId = torBoxTorrentId(item, true);
    if (!item || !torrentId) {
      showToast('Airlock needs a TorBox item id.', true);
      return;
    }

    const nextAirlocked = item.airlocked !== true;
    btn.disabled = true;
    btn.classList.add('magnetar-provider-file-download-loading');
    try {
      const res = await safeRuntimeMessage({
        type: 'airlock-client-item',
        mode: 'torbox',
        airlocked: nextAirlocked,
        item: {
          id: torrentId,
          torrent_id: torrentId,
          torrentId,
          torboxTorrentId: torrentId,
          providerItemId: torrentId,
          providerItemKey: torrentId,
          transfer_id: item.transfer_id || item.transferId || '',
          transferId: item.transferId || item.transfer_id || '',
          clientItemId: item.clientItemId || '',
          type: item.type || '',
          name: item.name || '',
          provider: item.provider || 'TorBox'
        }
      }, { success: false, error: 'Could not update Airlock in TorBox.' });
      if (!res?.success) {
        showToast(res?.error || 'Could not update Airlock in TorBox.', true);
        return;
      }
      const confirmedAirlocked = res.airlocked === false ? false : nextAirlocked;
      if (currentClientPanelItems[index]) currentClientPanelItems[index] = { ...currentClientPanelItems[index], airlocked: confirmedAirlocked };
      updateClientPanelCacheAirlock(providerMode, page, index, confirmedAirlocked);
      updateProviderAirlockRow(btn, confirmedAirlocked);
      showToast(confirmedAirlocked ? 'Airlocked in TorBox.' : 'Airlock removed in TorBox.');
    } finally {
      btn.classList.remove('magnetar-provider-file-download-loading');
      btn.disabled = false;
    }
  }

  async function handleClientItemOpen(btn, providerMode) {
    if (!btn || btn.disabled) return;
    const index = Number(btn.dataset.index);
    const item = Number.isInteger(index) ? currentClientPanelItems[index] : null;
    if (!item) {
      showToast('Open unavailable', true);
      return;
    }

    btn.disabled = true;
    btn.classList.add('magnetar-provider-file-download-loading');
    try {
      const res = await safeRuntimeMessage({
        type: 'open-client-item',
        mode: providerMode,
        item: {
          id: item.id || '',
          fileId: item.fileId || '',
          type: item.type || '',
          name: item.name || '',
          provider: item.provider || '',
          downloadable: item.downloadable === true,
          link: item.link || ''
        }
      }, { success: false, error: 'Could not open client item.' });
      if (!res?.success) {
        showToast(res?.error || 'Could not open client item', true);
      }
    } finally {
      btn.classList.remove('magnetar-provider-file-download-loading');
      btn.disabled = !canOpenClientItem(item, providerMode);
    }
  }

  async function handleClientItemDownload(btn, providerMode) {
    if (!btn || btn.disabled) return;
    const index = Number(btn.dataset.index);
    const item = Number.isInteger(index) ? currentClientPanelItems[index] : null;
    if (!item) {
      showToast(providerMode === 'alldebrid' ? 'Open unavailable' : 'Download unavailable', true);
      return;
    }

    btn.disabled = true;
    btn.classList.add('magnetar-provider-file-download-loading');
    try {
      const res = await safeRuntimeMessage({
        type: 'download-client-item',
        mode: providerMode,
        item: {
          id: item.id || '',
          fileId: item.fileId || '',
          type: item.type || '',
          name: item.name || '',
          provider: item.provider || '',
          downloadable: item.downloadable === true,
          link: item.link || ''
        }
      }, { success: false, error: providerMode === 'alldebrid' ? 'Could not open AllDebrid item.' : 'Could not get download link.' });
      if (!res?.success) {
        showToast(res?.error || (providerMode === 'alldebrid' ? 'Could not open AllDebrid item' : 'Could not get download link'), true);
      }
    } finally {
      btn.classList.remove('magnetar-provider-file-download-loading');
      btn.disabled = !canDownloadClientItem(item, providerMode);
    }
  }

  function formatRelative(ts) {
    if (!ts) return '';
    const d = Date.now() - ts;
    if (d < 60_000)     return Math.max(1, Math.floor(d / 1000)) + 's ago';
    if (d < 3600_000)   return Math.floor(d / 60_000) + 'm ago';
    if (d < 86400_000)  return Math.floor(d / 3600_000) + 'h ago';
    return Math.floor(d / 86400_000) + 'd ago';
  }

  function formatFileSize(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n >= 1073741824) return (n / 1073741824).toFixed(1) + ' GB';
    if (n >= 1048576) return (n / 1048576).toFixed(0) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
    return n + ' B';
  }

  function formatClientItemDate(value) {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return '';
    return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function safeSourceUrl(item) {
    const raw = item?.sourceUrl || item?.url || '';
    try {
      const url = new URL(raw);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch (e) {
      return '';
    }
  }

  function sourceDomain(item) {
    if (item?.sourceDomain) return item.sourceDomain;
    const raw = safeSourceUrl(item);
    try {
      return raw ? new URL(raw).hostname.replace(/^www\./i, '') : '';
    } catch (e) {
      return '';
    }
  }

  function bindActivityActions(root) {
    if (!root) return;
    if (root.dataset.activityActionsBound === 'true') return;
    root.dataset.activityActionsBound = 'true';
    root.addEventListener('click', async (event) => {
      const resendBtn = event.target.closest('.magnetar-activity-resend');
      if (resendBtn && root.contains(resendBtn)) {
        event.preventDefault();
        resendBtn.disabled = true;
        const original = resendBtn.textContent;
        resendBtn.textContent = 'Sending�';
        const res = await safeRuntimeMessage({ type: 'resend-history-item', hash: resendBtn.dataset.hash }, null);
        if (res?.action === 'open-magnet' && res.magnetUri) window.open(res.magnetUri, '_self');
        resendBtn.textContent = res?.success ? 'Sent' : 'Unavailable';
        setTimeout(() => {
          resendBtn.textContent = original;
          resendBtn.disabled = false;
        }, 900);
        return;
      }

      const openBtn = event.target.closest('.magnetar-activity-open');
      if (openBtn && root.contains(openBtn) && openBtn.dataset.url) {
        event.preventDefault();
        window.open(openBtn.dataset.url, '_blank', 'noopener');
      }
    });
  }

  function formatCacheStatus(status) {
    if (status === 'cached') return 'Cached';
    if (status === 'not_cached') return 'Not cached';
    return 'Unknown';
  }

  function getDetectionTypeLabel(detection) {
    if (detection?.source === 'magnet-link' || detection?.source === 'ext-to-xhr') return 'Magnet link';
    if (detection?.hash) return 'Hash';
    return 'Unknown';
  }

  function getDetectionSourceLabel(source) {
    if (source === 'magnet-link') return 'magnet';
    if (source === 'ext-to-xhr') return 'ext.to';
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


  function syncPullIconSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.5 6.2"/><path d="M3 12A9 9 0 0 1 18.5 5.8"/><path d="M18 2v4h4"/><path d="M6 22v-4H2"/></svg>';
  }

  function closeIconSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  }

  function helpIconSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 1 1 4.83 2.39c-.95.7-1.42 1.11-1.42 2.61"/><path d="M12 17h.01"/></svg>';
  }

  function chevronDownIconSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
  }

  function removeIconSvg() {
    return closeIconSvg();
  }

  function folderIconSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"/></svg>';
  }

  function folderActionIconSvg(name) {
    const icons = {
      pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
      chevronDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>',
      chevronUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg>',
      open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>',
      trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
      plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
      back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="m11 18-6-6 6-6"/></svg>',
      link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
      copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
      download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>',
      move: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 9l-3 3 3 3"/><path d="M9 5l3-3 3 3"/><path d="M15 19l-3 3-3-3"/><path d="M19 9l3 3-3 3"/><path d="M2 12h20"/><path d="M12 2v20"/></svg>',
      lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><path d="M12 15v2"/></svg>'
    };
    return icons[name] || '';
  }
  function buildSupportActions(extraClass = '') {
    const className = `magnetar-support-actions${extraClass ? ' ' + extraClass : ''}`;
    return `
      <div class="${className}">
        <button class="magnetar-support-action magnetar-pin-banner ${pinBanner ? 'magnetar-pin-banner-active' : ''}" id="magnetar-pin-banner" title="Pin to keep toolbar open after send" aria-label="Pin to keep toolbar open after send" aria-pressed="${pinBanner ? 'true' : 'false'}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M5 17h14"/><path d="M7 3h10l-2 8 3 4H6l3-4Z"/></svg>
        </button>
        <a class="magnetar-support-action" href="${HELP_URL}" target="_blank" rel="noopener" title="Help" aria-label="Help">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 1 1 4.83 2.39c-.95.7-1.42 1.11-1.42 2.61"/><path d="M12 17h.01"/></svg>
        </a>
        <button type="button" class="magnetar-support-action magnetar-whats-new-open" title="What's new" aria-label="What's new">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/><path d="M8 7h8"/><path d="M8 11h6"/></svg>
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


  function whatsNewIconSvg(name) {
    const icons = {
      sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 1-9 9 8.7 8.7 0 0 1-6-2.3"/><path d="M3 12a9 9 0 0 1 15-6.7"/><path d="M3 17v5h5"/><path d="M21 7V2h-5"/></svg>',
      folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
      phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="2.5"/><path d="M10 18h4"/><path d="M13 7l3 3-3 3"/><path d="M8 10h8"/></svg>',
      lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><path d="M12 15v2"/></svg>',
      green: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h4"/><path d="M16 12h4"/><path d="M9 7h6v10H9z"/><path d="M12 3v4"/><path d="M12 17v4"/></svg>',
      qr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><path d="M15 15h2v2h-2z"/><path d="M19 15h2"/><path d="M15 19h6"/><path d="M11 5h1"/><path d="M11 17h1"/><path d="M17 11h1"/></svg>'
    };
    return icons[name] || icons.sync;
  }

  const WHATS_NEW_FEATURES = [
    {
      id: 'sync',
      icon: 'sync',
      title: 'Sync with mobile',
      pill: 'Private sync',
      summary: 'Keep your saved items, history and folders in step.',
      detail: 'Magnetar Sync keeps your saved items, sent history and organised folders in step between the extension and Magnetar Mobile. Your Magnetar activity stays together across devices so you can pick up where you left off. Provider files are never changed, and provider API keys and client passwords always stay local.'
    },
    {
      id: 'folder',
      icon: 'folder',
      title: 'Sync folders',
      pill: 'Sync folders',
      summary: 'Pair Magnetar Mobile to organise folders across devices.',
      detail: 'Pair Magnetar Mobile to create and sync organised Magnetar folders between desktop and mobile. You can group provider items your way without moving, renaming or changing anything in the provider itself. Folder names, colours, order and contents stay in step through Magnetar Sync.'
    },
    {
      id: 'phone',
      icon: 'phone',
      title: 'Send to mobile',
      pill: 'Review queue',
      summary: 'Send items or batches straight to the app Review queue.',
      detail: "Send a single item or a whole batch from the extension to Magnetar Mobile. Items arrive in the app's Review queue so you can check them before saving, sending or browsing. This makes it easy to move Magnetar findings from desktop to phone without losing context."
    },
    {
      id: 'lock',
      icon: 'lock',
      title: 'TorBox Airlock',
      pill: 'Airlocked',
      summary: 'Protect supported TorBox items directly from Magnetar.',
      detail: 'TorBox items can be Airlocked directly from Magnetar on both the provider list and organised folder items. This lets you protect supported TorBox items without leaving the Magnetar workflow. Airlock is a TorBox feature, so it only appears when TorBox is the active provider and the item supports it.'
    },
    {
      id: 'green',
      icon: 'green',
      title: 'Green means sync',
      pill: 'Soft green',
      summary: 'Green highlights features connected to Magnetar Sync.',
      detail: 'Green now marks Magnetar Sync features across the extension so they are easier to spot at a glance. Sync actions, organised features and mobile-connected controls share the same visual language. It is a small change, but it makes the sync workflow feel clearer and more connected.'
    },
    {
      id: 'qr',
      icon: 'qr',
      title: 'Pair with QR',
      pill: 'Private pairing',
      summary: 'Scan a private QR to connect your extension and phone.',
      detail: 'Create a private pairing QR in the extension, then scan it in Magnetar Mobile to connect your devices. Once paired, Magnetar Sync can keep supported Magnetar data in step automatically after changes. Pairing is private and encrypted, and it never syncs provider API keys or client passwords.'
    }
  ];

  function getWhatsNewFeature(id) {
    return WHATS_NEW_FEATURES.find(feature => feature.id === id) || WHATS_NEW_FEATURES[0];
  }

  function buildWhatsNewCard(feature) {
    return `
      <article class="magnetar-whats-new-card magnetar-whats-new-card-${escapeAttr(feature.icon)}">
        <div class="magnetar-whats-new-card-head">
          <span class="magnetar-whats-new-icon">${whatsNewIconSvg(feature.icon)}</span>
          <span class="magnetar-whats-new-pill">${escapeHtml(feature.pill)}</span>
          <span class="magnetar-whats-new-card-title">${escapeHtml(feature.title)}</span>
        </div>
        <span class="magnetar-whats-new-copy">${escapeHtml(feature.summary)}</span>
        <button type="button" class="magnetar-whats-new-learn" data-whats-new-feature="${escapeAttr(feature.id)}">Learn more</button>
      </article>
    `;
  }

  function buildWhatsNewDetail(feature) {
    return `
      <div class="magnetar-whats-new-detail-card magnetar-whats-new-card-${escapeAttr(feature.icon)}">
        <div class="magnetar-whats-new-detail-head">
          <span class="magnetar-whats-new-icon">${whatsNewIconSvg(feature.icon)}</span>
          <span class="magnetar-whats-new-pill">${escapeHtml(feature.pill)}</span>
          <strong>${escapeHtml(feature.title)}</strong>
          <button type="button" class="magnetar-whats-new-detail-close" data-whats-new-detail-close aria-label="Close feature detail">${closeIconSvg()}</button>
        </div>
        <p>${escapeHtml(feature.detail)}</p>
      </div>
    `;
  }

  async function maybeShowWhatsNewTour(reason = 'auto') {
    if (reason !== 'manual') {
      if (whatsNewAutoCheckDone) return;
      whatsNewAutoCheckDone = true;
      const manifestVersion = MAGNETAR_API.runtime?.getManifest?.().version || '';
      if (manifestVersion !== MAGNETAR_WHATS_NEW_VERSION) return;
      const state = await safeRuntimeMessage({ type: 'get-whatsnew', version: MAGNETAR_WHATS_NEW_VERSION }, null);
      if (!state || state.to !== MAGNETAR_WHATS_NEW_VERSION || state.seen) return;
    }
    await openWhatsNewPanel({ auto: reason !== 'manual' });
  }

  async function showWhatsNewTour() {
    await openWhatsNewPanel({ auto: false });
  }

  function buildWhatsNewPanelHtml() {
    return `
      <div class="magnetar-expanded-inner magnetar-whats-new-panel" id="magnetar-whats-new-panel">
        <div class="magnetar-whats-new-panel-head">
          <div class="magnetar-whats-new-header">
            <span class="magnetar-whats-new-kicker">Magnetar 2.2</span>
            <h2 id="magnetar-whats-new-title">What's new in Magnetar 2.2</h2>
            <p>A cleaner way to sync, organise and protect your Magnetar items.</p>
          </div>
          <button type="button" class="magnetar-whats-new-close" data-whats-new-close aria-label="Close What's new">${closeIconSvg()}</button>
        </div>
        <div class="magnetar-whats-new-grid">
          ${WHATS_NEW_FEATURES.map(buildWhatsNewCard).join('')}
        </div>
        <div class="magnetar-whats-new-detail" data-whats-new-detail hidden></div>
        <div class="magnetar-whats-new-privacy">Provider keys and client passwords stay local.</div>
        <div class="magnetar-whats-new-actions">
          <button type="button" class="magnetar-btn magnetar-whats-new-primary" data-whats-new-start>Start using Magnetar</button>
          <button type="button" class="magnetar-btn magnetar-whats-new-secondary" data-whats-new-sync>Open Sync</button>
          <button type="button" class="magnetar-whats-new-later" data-whats-new-later>Maybe later</button>
        </div>
      </div>
    `;
  }

  async function openWhatsNewPanel({ auto = false } = {}) {
    document.getElementById('magnetar-batch')?.remove();
    if (!document.getElementById('magnetar-banner')) {
      injectBanner(hasValidSingleDetection() ? result : createManualShellDetection(), mode, category);
    }
    const banner = document.getElementById('magnetar-banner');
    const wrap = document.getElementById('magnetar-expanded-section');
    if (!banner || !wrap) return;
    if (activeExpandedPanel !== 'whatsNew') whatsNewPreviousPanel = activeExpandedPanel;
    whatsNewTourVisible = true;
    wrap.innerHTML = buildWhatsNewPanelHtml();
    setExpandedPanel('whatsNew');
    banner.classList.add('magnetar-expanded');
    updateExpandedToggleState();
    bindWhatsNewPanelActions(wrap);
  }

  function bindWhatsNewPanelActions(root) {
    const closeTour = () => closeWhatsNewTour({ dismiss: true });
    root.querySelector('[data-whats-new-close]')?.addEventListener('click', closeTour);
    root.querySelector('[data-whats-new-start]')?.addEventListener('click', closeTour);
    root.querySelector('[data-whats-new-later]')?.addEventListener('click', closeTour);
    const detailHost = root.querySelector('[data-whats-new-detail]');
    root.querySelectorAll('[data-whats-new-feature]').forEach((button) => {
      button.addEventListener('click', () => {
        if (!detailHost) return;
        const feature = getWhatsNewFeature(button.dataset.whatsNewFeature || 'sync');
        detailHost.innerHTML = buildWhatsNewDetail(feature);
        detailHost.hidden = false;
        detailHost.classList.remove('magnetar-whats-new-detail-open');
        void detailHost.offsetWidth;
        detailHost.classList.add('magnetar-whats-new-detail-open');
        detailHost.querySelector('[data-whats-new-detail-close]')?.addEventListener('click', () => {
          detailHost.hidden = true;
          detailHost.classList.remove('magnetar-whats-new-detail-open');
          detailHost.innerHTML = '';
        });
        requestAnimationFrame(() => {
          const scroller = detailHost.closest('.magnetar-expanded-section');
          if (!scroller) {
            detailHost.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
            return;
          }
          const detailRect = detailHost.getBoundingClientRect();
          const scrollRect = scroller.getBoundingClientRect();
          const bottomOverflow = detailRect.bottom - scrollRect.bottom + 12;
          const topOverflow = detailRect.top - scrollRect.top - 8;
          if (bottomOverflow > 0) {
            scroller.scrollBy({ top: bottomOverflow, behavior: 'smooth' });
          } else if (topOverflow < 0) {
            scroller.scrollBy({ top: topOverflow, behavior: 'smooth' });
          }
        });
      });
    });
    root.querySelector('[data-whats-new-sync]')?.addEventListener('click', async (e) => {
      e.preventDefault();
      closeWhatsNewTour({ dismiss: true, restore: false });
      await openSyncPanelWithNotice('');
    });
  }

  async function closeWhatsNewTour({ dismiss = true, restore = true } = {}) {
    whatsNewTourVisible = false;
    if (dismiss) {
      safeRuntimeMessage({ type: 'dismiss-whatsnew', version: MAGNETAR_WHATS_NEW_VERSION }, null);
    }
    if (restore) await restoreAfterWhatsNew();
  }

  function bindWhatsNewOpeners(root = document) {
    root.querySelectorAll('.magnetar-whats-new-open').forEach(button => {
      if (button.dataset.magnetarWhatsNewBound === 'true') return;
      button.dataset.magnetarWhatsNewBound = 'true';
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showWhatsNewTour();
      });
    });
  }
  function buildBannerHTML(detection, mode) {
    const isManualShell = detection?.manualOnly === true;
    const name = escapeHtml(detection.name || t('unknownTorrent'));

    const sendLabel = getSendLabel(mode);
    const showCache = !isManualShell && mode !== 'local';
    const isFull = isManualShell || bannerStyle === 'full';
    const mobileButton = `
      <button type="button" class="magnetar-btn magnetar-btn-icon magnetar-btn-mobile" id="magnetar-mobile-link" title="Get Magnetar Mobile" aria-label="Get Magnetar Mobile">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="2.5" ry="2.5"/><path d="M10 18h4"/><path d="M9 6h6"/></svg>
      </button>
    `;
    const syncPullButton = `
      <button type="button" class="magnetar-btn magnetar-btn-icon magnetar-btn-sync-pull" id="magnetar-sync-pull-latest" title="Pull latest sync" aria-label="Pull latest sync">${syncPullIconSvg()}</button>
    `;
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
      <button type="button" class="magnetar-btn magnetar-btn-secondary magnetar-ignore-site" id="magnetar-ignore-site" title="Ignore site" aria-label="Ignore site">Ignore site</button>
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
    const clientToggle = `
      <label class="magnetar-client-mode-toggle" title="Show client">
        <input type="checkbox" class="magnetar-client-mode-input" id="magnetar-banner-client-mode" aria-label="Show client" aria-expanded="false">
        <span class="magnetar-client-mode-track" aria-hidden="true"></span>
        <span class="magnetar-client-mode-label">Client</span>
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
                <button class="magnetar-btn magnetar-btn-secondary magnetar-btn-save" id="magnetar-save" title="Save for later">
                  <svg class="magnetar-save-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                  <span class="magnetar-save-label">Save</span>
                </button>
                <button class="magnetar-btn magnetar-btn-secondary magnetar-btn-sync" id="magnetar-banner-sync-mode" title="Sync Magnetar Mobile">Sync mobile</button>
                <button class="magnetar-btn magnetar-btn-secondary magnetar-btn-app-review" id="magnetar-app-review" title="Send to Magnetar Mobile Review">Send to mobile</button>
      `;
      const utilityTools = isManualShell
        ? `${downloadsButton}${manualButton}`
        : `${downloadsButton}${manualButton}${ignoreButton}${batchToggle}${clientToggle}`;
      const expandControl = isManualShell ? '' : `
                <button class="magnetar-btn magnetar-btn-icon magnetar-btn-expand" id="magnetar-expand" title="Expand" aria-label="Expand">
                  <svg class="magnetar-expand-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
      `;
      return `
        <div class="magnetar-inner">
          <div class="magnetar-title-row">
            <span class="magnetar-brand">
              <span class="magnetar-logo"><img src="${MAGNETAR_LOGO_URL}" alt="" aria-hidden="true"></span>
              <span class="magnetar-wordmark">MAGNETAR</span>
            </span>
            <span class="magnetar-name" title="${name}" tabindex="0"><span class="magnetar-name-text">${name}</span></span>
            ${mobileButton}
            ${syncPullButton}
            <button class="magnetar-btn magnetar-btn-icon magnetar-btn-theme" id="magnetar-theme" title="Toggle theme" aria-label="Toggle theme">
              <svg class="magnetar-theme-icon-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              <svg class="magnetar-theme-icon-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
            </button>
            <a class="magnetar-btn magnetar-btn-icon magnetar-btn-help" href="${HELP_URL}" target="_blank" rel="noopener" title="Help" aria-label="Help">${helpIconSvg()}</a>
            <button class="magnetar-btn magnetar-btn-icon magnetar-btn-settings" id="magnetar-banner-settings" title="Settings" aria-label="Settings">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
            <button class="magnetar-btn magnetar-btn-cancel" id="magnetar-dismiss" title="Dismiss" aria-label="Close Magnetar toolbar">${closeIconSvg()}</button>
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
      // Compact mode � Send + settings cog + ?
      return `
        <div class="magnetar-inner magnetar-inner-compact">
          <span class="magnetar-brand">
            <span class="magnetar-logo"><img src="${MAGNETAR_LOGO_URL}" alt="" aria-hidden="true"></span>
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
          ${ignoreButton}
          ${downloadsButton}
          ${mobileButton}
          ${syncPullButton}
          <a class="magnetar-btn magnetar-btn-icon magnetar-btn-help" href="${HELP_URL}" target="_blank" rel="noopener" title="Help" aria-label="Help">${helpIconSvg()}</a>
            <button class="magnetar-btn magnetar-btn-icon magnetar-btn-settings" id="magnetar-banner-settings" title="Settings" aria-label="Settings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
          <button class="magnetar-btn magnetar-btn-cancel" id="magnetar-dismiss" title="Dismiss" aria-label="Close Magnetar toolbar">${closeIconSvg()}</button>
        </div>
      `;
    }
  }


  // ------------------------------------------------------------------------
  // BATCH PANEL
  // ------------------------------------------------------------------------

  async function injectBatchPanel(magnets, totalCount, mode) {
    document.getElementById('magnetar-batch')?.remove();

    let historyMap = {};
    let batchSession = null;
    try {
      [historyMap, batchSession] = await Promise.all([
        safeRuntimeMessage({
          type: 'check-history',
          hashes: magnets.map(m => m.hash)
        }, {}),
        safeRuntimeMessage({ type: 'get-batch-session' }, null)
      ]);
    } catch (e) {}
    const currentHashes = magnets.map(m => m.hash).filter(Boolean);
    const currentHashSet = new Set(currentHashes);
    const sessionMatches = !!(
      batchSession
      && Array.isArray(batchSession.hashes)
      && batchSession.hashes.length === currentHashes.length
      && batchSession.hashes.every(hash => currentHashSet.has(hash))
    );
    const selectedHashes = new Set(sessionMatches && Array.isArray(batchSession.selectedHashes) ? batchSession.selectedHashes : []);
    const sentHashes = new Set(sessionMatches && Array.isArray(batchSession.sentHashes) ? batchSession.sentHashes : []);
    sentHashes.forEach(hash => { historyMap[hash] = true; });

    async function persistBatchSession() {
      await safeRuntimeMessage({
        type: 'save-batch-session',
        data: {
          hashes: currentHashes,
          selectedHashes: [...panel.querySelectorAll('.magnetar-batch-cb:checked:not(:disabled)')]
            .map(cb => magnets[parseInt(cb.dataset.index, 10)]?.hash)
            .filter(Boolean),
          sentHashes: [...sentHashes],
          updatedAt: Date.now()
        }
      }, null);
    }

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
    const batchMobileButton = `
      <button type="button" class="magnetar-btn magnetar-btn-icon magnetar-btn-mobile" id="magnetar-batch-mobile-link" title="Get Magnetar Mobile" aria-label="Get Magnetar Mobile">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="2.5" ry="2.5"/><path d="M10 18h4"/><path d="M9 6h6"/></svg>
      </button>
    `;

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
        const truncName = name.length > 60 ? name.substring(0, 57) + '�' : name;
        const sizeStr = m.size ? formatSize(m.size) : '';
        const seedStr = m.seeders != null ? `?${m.seeders}` : '';
        const metaStr = [seedStr, sizeStr].filter(Boolean).join(' � ');
        return `
          <label class="magnetar-batch-row ${inHistory ? 'magnetar-batch-done' : ''}" data-index="${origIdx}" data-sort-index="${i}">
            <input type="checkbox" class="magnetar-batch-cb" data-index="${origIdx}" ${inHistory ? 'disabled' : ''} ${!inHistory && selectedHashes.has(m.hash) ? 'checked' : ''}>
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
                <div class="magnetar-stat-value" id="magnetar-batch-stat-sent">�</div>
                <div class="magnetar-stat-delta">total</div>
              </div>
              <div class="magnetar-stat">
                <div class="magnetar-stat-label">cache hit rate</div>
                <div class="magnetar-stat-value" id="magnetar-batch-stat-cache">�</div>
                <div class="magnetar-stat-delta">last 30 sends</div>
              </div>
              <div class="magnetar-stat">
                <div class="magnetar-stat-label">sites blocked</div>
                <div class="magnetar-stat-value" id="magnetar-batch-stat-shield">�</div>
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
              <span>History</span>
              <a id="magnetar-batch-view-history">view history</a>
            </div>
            <div class="magnetar-activity" id="magnetar-batch-drawer-activity">
              <div class="magnetar-activity-empty">No history yet</div>
            </div>
          </div>
        </div>

        <div class="magnetar-batch-inner">
          <div class="magnetar-batch-header">
            <div class="magnetar-batch-title-row">
              <span class="magnetar-brand">
                <span class="magnetar-logo"><img src="${MAGNETAR_LOGO_URL}" alt="" aria-hidden="true"></span>
                <span class="magnetar-wordmark">MAGNETAR</span>
              </span>
              <span class="magnetar-batch-title">${t('batchTorrentsDetected', String(magnets.length))}</span>
              ${truncatedNote}
            </div>
            <div class="magnetar-batch-header-actions">
              <button class="magnetar-btn magnetar-btn-icon magnetar-batch-drawer-toggle" id="magnetar-batch-drawer-toggle" title="Show saved &amp; history" aria-label="Show saved and history">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              ${batchMobileButton}
              <button type="button" class="magnetar-btn magnetar-btn-icon magnetar-btn-sync-pull" id="magnetar-sync-pull-latest" title="Pull latest sync" aria-label="Pull latest sync">${syncPullIconSvg()}</button>
              <a class="magnetar-btn magnetar-btn-icon magnetar-btn-help" href="${HELP_URL}" target="_blank" rel="noopener" title="Help" aria-label="Help">${helpIconSvg()}</a>
              <button class="magnetar-btn magnetar-btn-icon magnetar-btn-theme" id="magnetar-batch-theme" title="Toggle theme" aria-label="Toggle theme">
                <svg class="magnetar-theme-icon-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                <svg class="magnetar-theme-icon-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
              </button>
              <button class="magnetar-btn magnetar-btn-icon magnetar-btn-settings" id="magnetar-batch-settings" title="Settings" aria-label="Settings">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              </button>
              <button class="magnetar-batch-close" id="magnetar-batch-close" title="Dismiss" aria-label="Close Magnetar batch panel">${closeIconSvg()}</button>
            </div>
          </div>
          <div class="magnetar-batch-toolbar">
            <select class="magnetar-batch-sort" id="magnetar-batch-sort">
              <option value="default">Order: Default</option>
              <option value="name">Name A�Z</option>
              <option value="name-desc">Name Z�A</option>
              <option value="seeders">Seeders ?</option>
              <option value="size">Size ?</option>
              <option value="size-asc">Size ?</option>
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
            <button class="magnetar-btn magnetar-btn-secondary magnetar-batch-send-mobile" id="magnetar-batch-send-mobile" disabled>Send to mobile</button>
            <span class="magnetar-batch-send-status" id="magnetar-batch-send-status"></span>
            <button class="magnetar-btn magnetar-btn-cancel" id="magnetar-batch-dismiss">${t('batchDismiss')}</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(panel);
    prepareTitleReveal(panel);
    bindWhatsNewOpeners(panel);

    const batchDetectionKey = "batch-detection:" + window.location.href + ":" + magnets.map(m => m.hash || m.magnetUri || "").filter(Boolean).slice(0, 10).join("|");
    queueDetectionAutoPull('batch-open', batchDetectionKey);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        panel.classList.add('magnetar-batch-visible');
      });
    });

    // -- Cache checks --
    const checkboxes = () => panel.querySelectorAll('.magnetar-batch-cb');
    const selectAll = panel.querySelector('#magnetar-batch-all');
    const countEl = panel.querySelector('#magnetar-batch-count');
    const sendBtn = panel.querySelector('#magnetar-batch-send');
    const sendMobileBtn = panel.querySelector('#magnetar-batch-send-mobile');
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

    // -- Sort handler --
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

    // -- Event handlers --
    function updateCount() {
      const checked = panel.querySelectorAll('.magnetar-batch-cb:checked:not(:disabled)');
      countEl.textContent = t('batchSelected', String(checked.length));
      sendBtn.disabled = checked.length === 0;
      if (sendMobileBtn) sendMobileBtn.disabled = checked.length === 0;
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
        persistBatchSession();
      }));
    }

    bindCheckboxes();
    updateCount();
    persistBatchSession();

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
      persistBatchSession();
    });

    sendMobileBtn?.addEventListener('click', async () => {
      const selected = [...panel.querySelectorAll('.magnetar-batch-cb:checked:not(:disabled)')]
        .map(cb => magnets[parseInt(cb.dataset.index, 10)])
        .filter(Boolean);
      if (selected.length === 0) {
        showToast('Select items first.', true);
        return;
      }
      const syncSettings = await safeRuntimeMessage({ type: 'get-sync-settings' }, null);
      if (!isUsableSyncSettings(syncSettings)) {
        await openSyncPanelWithNotice('Pair Magnetar Mobile to use Send to mobile. Send selected batch items straight to your phone\'s Review queue.');
        return;
      }
      const original = sendMobileBtn.textContent || 'Send to mobile';
      sendMobileBtn.disabled = true;
      sendMobileBtn.textContent = 'Sending...';
      try {
        const response = await safeRuntimeMessage({
          type: 'sync-send-app-review-batch',
          items: selected.map(buildBatchAppReviewItem)
        }, null);
        if (response?.ok) {
          showToast(`Sent ${response.count || selected.length} items to mobile`);
        } else {
          showToast(response?.error || 'Could not send items to mobile', true);
        }
      } catch (e) {
        showToast('Could not send items to mobile', true);
      } finally {
        sendMobileBtn.textContent = original;
        updateCount();
      }
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
          if (statusEl) statusEl.innerHTML = '<span class="magnetar-batch-badge magnetar-batch-badge-ok">?</span>';
          sentHashes.add(item.hash);
          const row = panel.querySelector(`.magnetar-batch-row[data-index="${magnets.indexOf(item)}"]`);
          if (row) row.classList.add('magnetar-batch-done');
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
                sentHashes.add(res.hash);
                if (statusEl) statusEl.innerHTML = '<span class="magnetar-batch-badge magnetar-batch-badge-ok">?</span>';
                const row = panel.querySelector(`.magnetar-batch-row[data-index="${idx}"]`);
                if (row) row.classList.add('magnetar-batch-done');
              } else {
                if (statusEl) statusEl.innerHTML = '<span class="magnetar-batch-badge magnetar-batch-badge-fail">?</span>';
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
      await persistBatchSession();

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

    // -- Theme toggle --
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

    // -- Settings cog --
    panel.querySelector('#magnetar-batch-settings')?.addEventListener('click', () => {
      safeRuntimeMessage({ type: 'open-options' });
    });

    panel.querySelector('#magnetar-batch-mobile-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      safeRuntimeMessage({ type: 'open-external-url', url: MOBILE_URL });
    });
    panel.querySelector('#magnetar-sync-pull-latest')?.addEventListener('click', (e) => {
      e.preventDefault();
      handlePullSyncSavedHistory(e);
    });

    // -- Drawer: slide-out saved + history --
    const drawer = panel.querySelector('#magnetar-batch-drawer');
    const drawerToggle = panel.querySelector('#magnetar-batch-drawer-toggle');
    let drawerBuilt = false;

    drawerToggle?.addEventListener('click', async () => {
      const willOpen = !panel.classList.contains('magnetar-batch-drawer-open');
      panel.classList.toggle('magnetar-batch-drawer-open', willOpen);
      drawer?.setAttribute('aria-hidden', String(!willOpen));
      if (willOpen) {
        await maybePullLatest('panel-open');
        await refreshDrawer();
      }
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
          : '�';
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
                  <span class="magnetar-saved-name" title="${escapeHtml(s.name || '�')}">${escapeHtml(s.name || '�')}</span>
                  <span class="magnetar-saved-meta">${ago}</span>
                  <button class="magnetar-saved-action magnetar-saved-share" data-hash="${hash}" title="Share">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                  </button>
                  <button class="magnetar-saved-action magnetar-saved-copy" data-hash="${hash}" title="Copy magnet">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  </button>
                  <button class="magnetar-saved-send" data-hash="${hash}" title="Send now">Send</button>
                  <button class="magnetar-saved-delete" data-hash="${hash}" title="Remove" aria-label="Remove">${removeIconSvg()}</button>
                </div>
              `;
            }).join('')
          : '<div class="magnetar-activity-empty">Nothing saved yet</div>';

        // Share � does NOT remove from saved queue
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

        // Copy magnet � does NOT remove from saved queue
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
            btn.textContent = '�';
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
              const ago = formatRelative(h.lastSentAt || h.timestamp);
              const status = h.cacheAtSend === 'cached' ? 'cached' : 'sent';
              const sourceUrl = safeSourceUrl(h);
                      return `
                <div class="magnetar-activity-row" data-hash="${escapeAttr(h.hash || '')}">
                  <div class="magnetar-activity-main">
                    <span class="magnetar-activity-name" title="${escapeHtml(h.name || '\u2014')}">${escapeHtml(h.name || '\u2014')}</span>
        
                  </div>
                  <div class="magnetar-activity-actions">
                    <span class="magnetar-activity-meta">${ago}${h.provider ? ` \u00b7 ${escapeHtml(h.provider)}` : ''}</span>
                    <button class="magnetar-activity-pill magnetar-activity-resend" data-hash="${escapeAttr(h.hash || '')}">Resend</button>
                    ${sourceUrl ? `<button class="magnetar-activity-pill magnetar-activity-open" data-url="${escapeAttr(sourceUrl)}" title="Open source URL" aria-label="Open source URL">URL</button>` : ''}
                    <span class="magnetar-activity-status magnetar-activity-${status}">${status}</span>
                  </div>
                </div>
              `;
            }).join('')
          : '<div class="magnetar-activity-empty">No history yet</div>';
        bindActivityActions(histHost);
      }
    }

    // -- 25/50/75 count toggle --
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
        // Redraw panel � simplest path: remove it and re-detect.
        // `allMagnets` is captured in the outer closure; we re-slice here.
        panel.remove();
        const batchItems = getBatchMagnets();
        const fresh = batchItems.slice(0, n);
        injectBatchPanel(fresh, batchItems.length, mode);
      });
    });

    // -- Per-row save --
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
    safeRuntimeMessage({ type: 'clear-batch-session' }, null);
    setTimeout(() => panel.remove(), 300);
  }


  // ------------------------------------------------------------------------
  // SHARED ACTIONS
  // ------------------------------------------------------------------------

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
        <span class="magnetar-share-icon">?</span><span>${t('shareEmail')}</span>
      </button>
      <button class="magnetar-share-item" data-action="x" title="${t('shareX')}">
        <span class="magnetar-share-icon">??</span><span>${t('shareX')}</span>
      </button>
      <button class="magnetar-share-item" data-action="reddit" title="${t('shareReddit')}">
        <span class="magnetar-share-icon">?</span><span>${t('shareReddit')}</span>
      </button>
      <button class="magnetar-share-item" data-action="telegram" title="${t('shareTelegram')}">
        <span class="magnetar-share-icon">?</span><span>${t('shareTelegram')}</span>
      </button>
      <button class="magnetar-share-item" data-action="copy" title="${t('shareCopyLink')}">
        <span class="magnetar-share-icon">?</span><span>${t('shareCopyLink')}</span>
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
    setExpandedPanel('');
    updateExpandedToggleState();
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

  // -- Review prompt --
  function showReviewPrompt() {
    if (document.getElementById('magnetar-review-prompt')) return;
    const prompt = document.createElement('div');
    prompt.id = 'magnetar-review-prompt';
    if (theme === 'light') prompt.classList.add('magnetar-theme-light');
    prompt.innerHTML = `
      <div class="magnetar-review-inner">
        <span class="magnetar-review-text">200 sends in. If Magnetar's earned a spot in your toolbox, a quick review or coffee would mean a lot.</span>
        <div class="magnetar-review-btns">
          <a class="magnetar-btn magnetar-btn-primary magnetar-review-btn" href="${STORE_URL}" target="_blank" id="magnetar-review-yes">? Rate</a>
          <a class="magnetar-btn magnetar-btn-secondary magnetar-review-btn" href="${COFFEE_URL}" target="_blank" id="magnetar-review-coffee">? Coffee</a>
          <button class="magnetar-btn magnetar-btn-cancel" id="magnetar-review-dismiss">Not now</button>
        </div>
      </div>
    `;
    document.body.appendChild(prompt);
    requestAnimationFrame(() => prompt.classList.add('magnetar-visible'));

    // Any of the three actions permanently dismisses � the user shouldn't
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


