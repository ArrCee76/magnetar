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
  const batchMax = settings?.preferences?.batchMax || 25;
  const bannerPosition = settings?.preferences?.bannerPosition || 'top';
  const mode = settings?.mode || 'local';
  const theme = settings?.preferences?.theme || 'dark';

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
    if (theme === 'light') banner.classList.add('magnetar-theme-light');
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
    banner.querySelector('#magnetar-dismiss')?.addEventListener('click', () => dismissBanner());
  }

  function buildBannerHTML(detection, mode) {
    const name = escapeHtml(detection.name || t('unknownTorrent'));
    const truncatedName = name.length > 80 ? name.substring(0, 77) + '...' : name;

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
          <div class="magnetar-info-row">
            <span class="magnetar-logo">✦</span>
            <span class="magnetar-name" title="${name}">${truncatedName}</span>
            ${alreadySentBadge}
            ${showCache ? `
              <span class="magnetar-cache" id="magnetar-cache">
                <span class="magnetar-cache-dot magnetar-cache-loading"></span>
                <span class="magnetar-cache-text">${t('cacheChecking')}</span>
              </span>
            ` : ''}
          </div>
          <div class="magnetar-button-row">
            <button class="magnetar-btn magnetar-btn-primary" id="magnetar-send">
              <span class="magnetar-btn-label">${sendLabel}</span>
              <span class="magnetar-btn-spinner" style="display:none"></span>
            </button>
            <button class="magnetar-btn magnetar-btn-secondary" id="magnetar-share" title="${t('shareButton')}">${t('shareButton')}</button>
            <button class="magnetar-btn magnetar-btn-secondary" id="magnetar-copy-magnet">${t('copyMagnetButton')}</button>
            <button class="magnetar-btn magnetar-btn-secondary" id="magnetar-copy-hash">${t('copyHashButton')}</button>
            <button class="magnetar-btn magnetar-btn-cancel" id="magnetar-dismiss">✕</button>
          </div>
        </div>
      `;
    } else {
      // Compact mode — just Send + ✕
      return `
        <div class="magnetar-inner magnetar-inner-compact">
          <span class="magnetar-logo">✦</span>
          <button class="magnetar-btn magnetar-btn-primary" id="magnetar-send">
            <span class="magnetar-btn-label">${sendLabel}</span>
            <span class="magnetar-btn-spinner" style="display:none"></span>
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
    if (theme === 'light') panel.classList.add('magnetar-theme-light');

    const showCache = mode !== 'local';
    const truncatedNote = totalCount > magnets.length
      ? `<span class="magnetar-batch-truncated">${t('batchShowingOf', String(magnets.length), String(totalCount))}</span>`
      : '';

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
            <span class="magnetar-batch-status" id="magnetar-bs-${origIdx}"></span>
          </label>
        `;
      }).join('');
    }

    panel.innerHTML = `
      <div class="magnetar-batch-inner">
        <div class="magnetar-batch-header">
          <div class="magnetar-batch-title-row">
            <span class="magnetar-logo">✦</span>
            <span class="magnetar-batch-title">${t('batchTorrentsDetected', String(magnets.length))}</span>
            ${truncatedNote}
          </div>
          <button class="magnetar-batch-close" id="magnetar-batch-close">✕</button>
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
      magnets.forEach((m, i) => {
        chrome.runtime.sendMessage({ type: 'check-cache', hash: m.hash })
          .then(res => {
            const dot = panel.querySelector(`#magnetar-bcd-${i}`);
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
          })
          .catch(() => {});
      });
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
        if (review.count >= 10 && !review.dismissed) {
          showReviewPrompt();
        }
      } catch (e) {}
    });

    panel.querySelector('#magnetar-batch-close')?.addEventListener('click', dismissBatch);
    panel.querySelector('#magnetar-batch-dismiss')?.addEventListener('click', dismissBatch);
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
          if (review.count >= 10 && !review.dismissed) {
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

  async function handleShare(detection) {
    // Remove any existing share menu
    document.getElementById('magnetar-share-menu')?.remove();

    const btn = document.getElementById('magnetar-share');
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

    // Position relative to the share button
    const rect = btn.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = (rect.bottom + 6) + 'px';
    menu.style.left = rect.left + 'px';
    menu.style.zIndex = '2147483647';

    document.body.appendChild(menu);
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
        <span class="magnetar-review-text">Enjoying Magnetar? A quick review helps others find it.</span>
        <div class="magnetar-review-btns">
          <a class="magnetar-btn magnetar-btn-primary magnetar-review-btn" href="https://chromewebstore.google.com/detail/magnetar" target="_blank" id="magnetar-review-yes">⭐ Rate</a>
          <button class="magnetar-btn magnetar-btn-cancel" id="magnetar-review-dismiss">Not now</button>
        </div>
      </div>
    `;
    document.body.appendChild(prompt);
    requestAnimationFrame(() => prompt.classList.add('magnetar-visible'));

    prompt.querySelector('#magnetar-review-yes')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'dismiss-review-prompt' }).catch(() => {});
      prompt.remove();
    });
    prompt.querySelector('#magnetar-review-dismiss')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'dismiss-review-prompt' }).catch(() => {});
      prompt.classList.remove('magnetar-visible');
      setTimeout(() => prompt.remove(), 300);
    });
  }

})();
