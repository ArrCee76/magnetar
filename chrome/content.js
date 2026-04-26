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
    const msg = chrome.i18n.getMessage(key, subs);
    return msg || key;
  };

  // Browser detection. Firefox exposes the `browser` namespace and a
  // gecko-only `getBrowserInfo` method — Chromium has neither.
  const IS_FIREFOX = typeof browser !== 'undefined'
    && typeof browser.runtime?.getBrowserInfo === 'function';
  const STORE_URL = IS_FIREFOX
    ? 'https://addons.mozilla.org/firefox/addon/magnetar/'
    : 'https://chromewebstore.google.com/detail/magnetar/cllbehlfiahgijdojkopgnnmcoenhlla';

  // ── Get settings ──
  let settings;
  try {
    settings = await chrome.runtime.sendMessage({ type: 'get-settings' });
  } catch (e) {
    return;
  }

  const customSites = settings?.customSites || [];
  const bannerEnabled = settings?.preferences?.bannerEnabled !== false;
  const bannerStyle = settings?.preferences?.bannerStyle || 'full'; // 'full' or 'compact'
  const batchMode = settings?.preferences?.batchMode === true;
  let batchMax = settings?.preferences?.batchMax || 25;
  const bannerPosition = settings?.preferences?.bannerPosition || 'top';
  const mode = settings?.mode || 'local';
  let theme = settings?.preferences?.theme || 'light';

  // ── Run detection ──
  const result = MagnetarDetector.detect(customSites);

  const allMagnets = batchMode ? MagnetarDetector.detectAll() : [];

  const category = MagnetarCategories.detect();
  if (result) result.category = category;

  // Report to background
  chrome.runtime.sendMessage({ type: 'detection-result', data: result }).catch(() => {});

  // ── Batch mode: show panel if multiple magnets found ──
  if (batchMode && allMagnets.length > 2) {
    const limited = allMagnets.slice(0, batchMax);
    injectBatchPanel(limited, allMagnets.length, mode);
    return;
  }

  // ── Single hash logic ──
  if (!result || !result.hash || result.lowConfidence) return;
  if (!bannerEnabled) return;
  if (window._magnetarDismissed && window._magnetarDismissed.includes(result.hash)) return;

  // ── Duplicate detection ──
  let alreadySent = false;
  try {
    const histCheck = await chrome.runtime.sendMessage({ type: 'check-single-history', hash: result.hash });
    alreadySent = histCheck?.inHistory === true;
  } catch (e) {}
  if (result) result.alreadySent = alreadySent;

  // ── Cache check ──
  let cacheStatus = 'unknown';
  if (mode !== 'local') {
    chrome.runtime.sendMessage({ type: 'check-cache', hash: result.hash })
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
    if (bannerPosition === 'bottom') banner.classList.add('magnetar-bottom');
    if (theme === 'dark') banner.classList.add('magnetar-theme-dark');
    banner.innerHTML = buildBannerHTML(detection, mode);
    document.body.appendChild(banner);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        banner.classList.add('magnetar-visible');
      });
    });

    banner.querySelector('#magnetar-send')?.addEventListener('click', () => handleSend(detection, category));
    banner.querySelector('#magnetar-share')?.addEventListener('click', () => handleShare(detection));
    banner.querySelector('#magnetar-copy-magnet')?.addEventListener('click', () => handleCopy(detection.magnetUri, t('magnetCopied')));
    banner.querySelector('#magnetar-copy-hash')?.addEventListener('click', () => handleCopy(detection.hash, t('hashCopied')));
    banner.querySelector('#magnetar-expand')?.addEventListener('click', () => toggleBannerExpand(detection, mode));
    banner.querySelector('#magnetar-dismiss')?.addEventListener('click', () => dismissBanner());
    banner.querySelector('#magnetar-banner-settings')?.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.sendMessage({ type: 'open-options' }).catch(() => {});
    });

    // Save-for-later button
    const saveBtn = banner.querySelector('#magnetar-save');
    if (saveBtn) {
      // Initial state: is this torrent already in the saved queue?
      chrome.runtime.sendMessage({ type: 'check-saved', hash: detection.hash })
        .then(res => {
          if (res?.isSaved) markSaveButtonSaved(saveBtn);
        })
        .catch(() => {});

      saveBtn.addEventListener('click', async () => {
        if (saveBtn.classList.contains('magnetar-btn-saved')) return;
        try {
          await chrome.runtime.sendMessage({
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
      chrome.runtime.sendMessage({ type: 'set-theme', theme }).catch(() => {});
    });
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

  // Live-sync: follow theme changes made on any other surface (popup, options).
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'sync' || !changes.magnetar) return;
    const newTheme = changes.magnetar.newValue?.preferences?.theme;
    if (!newTheme || newTheme === theme) return;
    theme = newTheme;
    applyTheme(theme);
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

    if (!expandedBuilt) {
      await populateExpanded(detection, mode);
      expandedBuilt = true;
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
        chrome.runtime.sendMessage({ type: 'get-send-count' }).catch(() => ({})),
        chrome.runtime.sendMessage({ type: 'get-history' }).catch(() => []),
        chrome.runtime.sendMessage({ type: 'shield-get' }).catch(() => ({})),
        chrome.runtime.sendMessage({ type: 'get-saved' }).catch(() => [])
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
      return `
        <div class="magnetar-saved-row" data-hash="${s.hash}">
          <span class="magnetar-saved-name" title="${escapeHtml(s.name || '—')}">${escapeHtml(s.name || '—')}</span>
          <span class="magnetar-saved-meta">${ago}</span>
          <button class="magnetar-saved-action magnetar-saved-share" data-hash="${s.hash}" title="Share">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          </button>
          <button class="magnetar-saved-action magnetar-saved-copy" data-hash="${s.hash}" title="Copy magnet">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
          <button class="magnetar-saved-send" data-hash="${s.hash}" title="Send now">Send</button>
          <button class="magnetar-saved-delete" data-hash="${s.hash}" title="Remove">✕</button>
        </div>
      `;
    }).join('');

    const modeUpper = String(mode || 'local').toUpperCase();

    wrap.innerHTML = `
      <div class="magnetar-expanded-inner">
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
        </div>
        <div class="magnetar-saved">${saved.length > 0 ? savedRows : '<div class="magnetar-activity-empty">Nothing saved yet</div>'}</div>
        <div class="magnetar-section-heading">
          <span>Recent activity</span>
          <a id="magnetar-view-history">view history</a>
        </div>
        <div class="magnetar-activity">${activityHTML}</div>
        <div class="magnetar-bfoot">
          <span>v${chrome.runtime.getManifest().version} · ${modeUpper}</span>
          <div class="magnetar-bfoot-links">
            <a href="${STORE_URL}" target="_blank">review</a>
            <a href="https://buymeacoffee.com/arrcee76" target="_blank" class="magnetar-coffee">coffee</a>
          </div>
        </div>
      </div>
    `;

    wrap.querySelector('#magnetar-view-history')?.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.sendMessage({ type: 'open-options' }).catch(() => {});
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
          const result = await chrome.runtime.sendMessage({
            type: 'send-magnet',
            hash: item.hash,
            name: item.name,
            magnetUri: item.magnetUri,
            category: item.category || '',
            pageUrl: item.sourceUrl || ''
          });
          if (result?.success || result?.action === 'open-magnet') {
            if (result?.action === 'open-magnet' && result.magnetUri) {
              window.open(result.magnetUri, '_self');
              // Remove from saved queue for local mode (no auto-removal since recordHistory doesn't fire)
              await chrome.runtime.sendMessage({ type: 'delete-saved-item', hash: item.hash }).catch(() => {});
            }
            showToast('Sent');
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
        await chrome.runtime.sendMessage({ type: 'delete-saved-item', hash }).catch(() => {});
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

  function buildBannerHTML(detection, mode) {
    const name = escapeHtml(detection.name || t('unknownTorrent'));

    const modeLabels = {
      local: t('sendLabelLocal'),
      realdebrid: t('sendLabelRealDebrid'),
      rdtclient: t('sendLabelRdtClient'),
      torbox: t('sendLabelTorBox'),
      premiumize: t('sendLabelPremiumize'),
      alldebrid: t('sendLabelAllDebrid')
    };

    const sendLabel = modeLabels[mode] || t('sendFallback');
    const showCache = mode !== 'local';
    const isFull = bannerStyle === 'full';

    if (isFull) {
      const alreadySentBadge = detection.alreadySent
        ? `<span class="magnetar-already-sent">${t('batchSentBadge')}</span>`
        : '';
      return `
        <div class="magnetar-inner">
          <div class="magnetar-title-row">
            <span class="magnetar-brand">
              <span class="magnetar-logo">✦</span>
              <span class="magnetar-wordmark">MAGNETAR</span>
            </span>
            <span class="magnetar-name" title="${name}">${name}</span>
            ${alreadySentBadge}
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
            <button class="magnetar-btn magnetar-btn-primary" id="magnetar-send">
              <span class="magnetar-btn-label">${sendLabel}</span>
              <span class="magnetar-btn-spinner" style="display:none"></span>
            </button>
            <button class="magnetar-btn magnetar-btn-secondary" id="magnetar-share" title="${t('shareButton')}">${t('shareButton')}</button>
            <button class="magnetar-btn magnetar-btn-secondary" id="magnetar-copy-magnet">${t('copyMagnetButton')}</button>
            <button class="magnetar-btn magnetar-btn-secondary" id="magnetar-copy-hash">${t('copyHashButton')}</button>
            <button class="magnetar-btn magnetar-btn-secondary magnetar-btn-save" id="magnetar-save" title="Save for later">
              <svg class="magnetar-save-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
              <span class="magnetar-save-label">Save</span>
            </button>
            ${showCache ? `
              <span class="magnetar-cache" id="magnetar-cache">
                <span class="magnetar-cache-dot magnetar-cache-loading"></span>
                <span class="magnetar-cache-text">${t('cacheChecking')}</span>
              </span>
            ` : ''}
            <button class="magnetar-btn magnetar-btn-icon magnetar-btn-expand" id="magnetar-expand" title="Expand" aria-label="Expand">
              <svg class="magnetar-expand-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
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
          <button class="magnetar-btn magnetar-btn-primary" id="magnetar-send">
            <span class="magnetar-btn-label">${sendLabel}</span>
            <span class="magnetar-btn-spinner" style="display:none"></span>
          </button>
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
      historyMap = await chrome.runtime.sendMessage({
        type: 'check-history',
        hashes: magnets.map(m => m.hash)
      });
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
              <span class="magnetar-btn-label">${t('batchSendTo', modeLabels[mode] || t('clientFallback'))}</span>
              <span class="magnetar-btn-spinner" style="display:none"></span>
            </button>
            <button class="magnetar-btn magnetar-btn-cancel" id="magnetar-batch-dismiss">${t('batchDismiss')}</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(panel);

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
          const res = await chrome.runtime.sendMessage({
            type: 'check-cache', hash: m.hash
          });
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

      if (mode === 'local') {
        for (let i = 0; i < selected.length; i++) {
          const item = selected[i];
          const statusEl = panel.querySelector(`#magnetar-bs-${magnets.indexOf(item)}`);
          window.open(item.magnetUri, '_blank');
          if (statusEl) statusEl.innerHTML = '<span class="magnetar-batch-badge magnetar-batch-badge-ok">✓</span>';
          totalProcessed++;
          updateProgress(totalProcessed, selected.length);
          if (i < selected.length - 1) await new Promise(r => setTimeout(r, 500));
        }
        showToast(t('batchOpenedMagnets', String(selected.length)));
      } else {
        try {
          const items = selected.map(m => ({
            hash: m.hash, name: m.name, magnetUri: m.magnetUri, category: mappedCategory
          }));
          const response = await chrome.runtime.sendMessage({
            type: 'batch-send', items, pageUrl: window.location.href
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
            showToast(t('batchSentCount', String(successCount), String(selected.length)));
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
        const review = await chrome.runtime.sendMessage({ type: 'get-review-status' });
        if (review.count >= 200 && !review.dismissed) {
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
      chrome.runtime.sendMessage({ type: 'set-theme', theme }).catch(() => {});
    });

    // ── Settings cog ──
    panel.querySelector('#magnetar-batch-settings')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'open-options' }).catch(() => {});
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
      chrome.runtime.sendMessage({ type: 'open-options' }).catch(() => {});
    });

    async function refreshDrawer() {
      const [saved, history, sendCountRes, shieldRes] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'get-saved' }).catch(() => []),
        chrome.runtime.sendMessage({ type: 'get-history' }).catch(() => []),
        chrome.runtime.sendMessage({ type: 'get-send-count' }).catch(() => ({})),
        chrome.runtime.sendMessage({ type: 'shield-get' }).catch(() => ({}))
      ]);
      const savedList = Array.isArray(saved) ? saved : [];
      const histList = Array.isArray(history) ? history : (history?.history || []);
      const sendCount = sendCountRes?.count || 0;
      const shieldData = shieldRes || {};

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
              return `
                <div class="magnetar-saved-row" data-hash="${s.hash}">
                  <span class="magnetar-saved-name" title="${escapeHtml(s.name || '—')}">${escapeHtml(s.name || '—')}</span>
                  <span class="magnetar-saved-meta">${ago}</span>
                  <button class="magnetar-saved-action magnetar-saved-share" data-hash="${s.hash}" title="Share">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                  </button>
                  <button class="magnetar-saved-action magnetar-saved-copy" data-hash="${s.hash}" title="Copy magnet">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  </button>
                  <button class="magnetar-saved-send" data-hash="${s.hash}" title="Send now">Send</button>
                  <button class="magnetar-saved-delete" data-hash="${s.hash}" title="Remove">✕</button>
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
              const result = await chrome.runtime.sendMessage({
                type: 'send-magnet',
                hash: item.hash, name: item.name, magnetUri: item.magnetUri,
                category: item.category || '', pageUrl: item.sourceUrl || ''
              });
              if (result?.success || result?.action === 'open-magnet') {
                if (result?.action === 'open-magnet' && result.magnetUri) {
                  window.open(result.magnetUri, '_self');
                  await chrome.runtime.sendMessage({ type: 'delete-saved-item', hash: item.hash }).catch(() => {});
                }
                showToast('Sent');
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
            await chrome.runtime.sendMessage({ type: 'delete-saved-item', hash: btn.dataset.hash }).catch(() => {});
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
          const current = (await chrome.runtime.sendMessage({ type: 'get-settings' })) || {};
          current.preferences = current.preferences || {};
          current.preferences.batchMax = n;
          await chrome.runtime.sendMessage({ type: 'save-settings', data: current });
        } catch (e) {}
        // Redraw panel — simplest path: remove it and re-detect.
        // `allMagnets` is captured in the outer closure; we re-slice here.
        panel.remove();
        const fresh = allMagnets.slice(0, n);
        injectBatchPanel(fresh, allMagnets.length, mode);
      });
    });

    // ── Per-row save ──
    panel.querySelectorAll('.magnetar-batch-row-save').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation(); // don't toggle the row checkbox
        const idx = parseInt(btn.dataset.index, 10);
        const m = magnets[idx];
        if (!m) return;
        if (btn.classList.contains('magnetar-batch-row-save-done')) return;
        try {
          await chrome.runtime.sendMessage({
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
    chrome.runtime.sendMessage({ type: 'get-saved' }).then(saved => {
      const hashes = new Set((Array.isArray(saved) ? saved : []).map(s => s.hash));
      panel.querySelectorAll('.magnetar-batch-row-save').forEach(btn => {
        const idx = parseInt(btn.dataset.index, 10);
        const m = magnets[idx];
        if (m && hashes.has(m.hash)) btn.classList.add('magnetar-batch-row-save-done');
      });
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

  async function handleSend(detection, category) {
    const btn = document.getElementById('magnetar-send');
    if (!btn) return;

    const label = btn.querySelector('.magnetar-btn-label');
    const spinner = btn.querySelector('.magnetar-btn-spinner');
    if (label) label.style.display = 'none';
    if (spinner) spinner.style.display = 'inline-block';
    btn.disabled = true;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'send-magnet',
        magnetUri: detection.magnetUri,
        hash: detection.hash,
        name: detection.name,
        category: settings?.preferences?.categoryMap?.[category] || category,
        pageUrl: window.location.href
      });

      if (response?.action === 'open-magnet') {
        window.location.assign(response.magnetUri);
        showSuccess();
      } else if (response?.success) {
        showSuccess();
        // Review prompt check
        try {
          const review = await chrome.runtime.sendMessage({ type: 'get-review-status' });
          if (review.count >= 200 && !review.dismissed) {
            setTimeout(() => showReviewPrompt(), 3000);
          }
        } catch (e) {}
      } else {
        showError(response?.error || t('sendFailed'));
      }
    } catch (e) {
      showError(e.message);
    }
  }

  async function handleShare(detection, anchorBtn) {
    // Remove any existing share menu
    document.getElementById('magnetar-share-menu')?.remove();

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

  function showSuccess() {
    const banner = document.getElementById('magnetar-banner');
    if (!banner) return;
    banner.classList.add('magnetar-success');
    const btnRow = banner.querySelector('.magnetar-button-row') || banner.querySelector('.magnetar-inner-compact');
    if (btnRow) {
      const inner = banner.querySelector('.magnetar-inner');
      if (inner) inner.innerHTML = `<span class="magnetar-success-text">${t('sentSuccessfully')}</span>`;
    }
    setTimeout(() => dismissBanner(), 2500);
  }

  function showError(message) {
    const btn = document.getElementById('magnetar-send');
    if (!btn) return;
    const label = btn.querySelector('.magnetar-btn-label');
    const spinner = btn.querySelector('.magnetar-btn-spinner');
    if (label) { label.textContent = message; label.style.display = 'inline'; }
    if (spinner) spinner.style.display = 'none';
    btn.disabled = false;
    btn.classList.add('magnetar-btn-error');
    setTimeout(() => {
      if (label) label.textContent = t('retryButton');
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
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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
          <a class="magnetar-btn magnetar-btn-secondary magnetar-review-btn" href="https://buymeacoffee.com/arrcee76" target="_blank" id="magnetar-review-coffee">☕ Coffee</a>
          <button class="magnetar-btn magnetar-btn-cancel" id="magnetar-review-dismiss">Not now</button>
        </div>
      </div>
    `;
    document.body.appendChild(prompt);
    requestAnimationFrame(() => prompt.classList.add('magnetar-visible'));

    // Any of the three actions permanently dismisses — the user shouldn't
    // see this prompt again whether they rated, donated, or declined.
    const dismiss = () => {
      chrome.runtime.sendMessage({ type: 'dismiss-review-prompt' }).catch(() => {});
      prompt.classList.remove('magnetar-visible');
      setTimeout(() => prompt.remove(), 300);
    };
    prompt.querySelector('#magnetar-review-yes')?.addEventListener('click', dismiss);
    prompt.querySelector('#magnetar-review-coffee')?.addEventListener('click', dismiss);
    prompt.querySelector('#magnetar-review-dismiss')?.addEventListener('click', dismiss);
  }

})();
