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
    banner.innerHTML = buildBannerHTML(detection, mode);
    document.body.appendChild(banner);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        banner.classList.add('magnetar-visible');
      });
    });

    banner.querySelector('#magnetar-send')?.addEventListener('click', () => handleSend(detection, category));
    banner.querySelector('#magnetar-share')?.addEventListener('click', () => handleShare(detection));
    banner.querySelector('#magnetar-copy-magnet')?.addEventListener('click', () => handleCopy(detection.magnetUri, 'Magnet copied'));
    banner.querySelector('#magnetar-copy-hash')?.addEventListener('click', () => handleCopy(detection.hash, 'Hash copied'));
    banner.querySelector('#magnetar-dismiss')?.addEventListener('click', () => dismissBanner());
  }

  function buildBannerHTML(detection, mode) {
    const name = escapeHtml(detection.name || 'Unknown torrent');
    const truncatedName = name.length > 80 ? name.substring(0, 77) + '...' : name;

    const modeLabels = {
      local: 'Open in Client',
      realdebrid: 'Send to Real-Debrid',
      rdtclient: 'Send to RDT Client',
      torbox: 'Send to TorBox',
      premiumize: 'Send to Premiumize',
      alldebrid: 'Send to AllDebrid'
    };

    const sendLabel = modeLabels[mode] || 'Send';
    const showCache = mode !== 'local';
    const isFull = bannerStyle === 'full';

    if (isFull) {
      return `
        <div class="magnetar-inner">
          <div class="magnetar-info-row">
            <span class="magnetar-logo">✦</span>
            <span class="magnetar-name" title="${name}">${truncatedName}</span>
            ${showCache ? `
              <span class="magnetar-cache" id="magnetar-cache">
                <span class="magnetar-cache-dot magnetar-cache-loading"></span>
                <span class="magnetar-cache-text">Checking…</span>
              </span>
            ` : ''}
          </div>
          <div class="magnetar-button-row">
            <button class="magnetar-btn magnetar-btn-primary" id="magnetar-send">
              <span class="magnetar-btn-label">${sendLabel}</span>
              <span class="magnetar-btn-spinner" style="display:none"></span>
            </button>
            <button class="magnetar-btn magnetar-btn-secondary" id="magnetar-share" title="Share">⤴ Share</button>
            <button class="magnetar-btn magnetar-btn-secondary" id="magnetar-copy-magnet">Copy Magnet</button>
            <button class="magnetar-btn magnetar-btn-secondary" id="magnetar-copy-hash">Copy Hash</button>
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
      local: 'Open in Client',
      realdebrid: 'Real-Debrid',
      rdtclient: 'RDT Client',
      torbox: 'TorBox',
      premiumize: 'Premiumize',
      alldebrid: 'AllDebrid'
    };

    const panel = document.createElement('div');
    panel.id = 'magnetar-batch';
    if (bannerPosition === 'bottom') panel.classList.add('magnetar-batch-bottom');

    const showCache = mode !== 'local';
    const truncatedNote = totalCount > magnets.length
      ? `<span class="magnetar-batch-truncated">Showing ${magnets.length} of ${totalCount}</span>`
      : '';

    const rows = magnets.map((m, i) => {
      const inHistory = historyMap[m.hash] === true;
      const name = escapeHtml(m.name || 'Unknown');
      const truncName = name.length > 60 ? name.substring(0, 57) + '…' : name;
      return `
        <label class="magnetar-batch-row ${inHistory ? 'magnetar-batch-done' : ''}" data-index="${i}">
          <input type="checkbox" class="magnetar-batch-cb" data-index="${i}" ${inHistory ? 'disabled' : ''}>
          ${showCache ? `<span class="magnetar-batch-cache-dot magnetar-cache-loading" id="magnetar-bcd-${i}"></span>` : ''}
          <span class="magnetar-batch-name" title="${name}">${truncName}</span>
          ${inHistory ? '<span class="magnetar-batch-badge magnetar-batch-badge-done">Sent</span>' : ''}
          <span class="magnetar-batch-status" id="magnetar-bs-${i}"></span>
        </label>
      `;
    }).join('');

    panel.innerHTML = `
      <div class="magnetar-batch-inner">
        <div class="magnetar-batch-header">
          <div class="magnetar-batch-title-row">
            <span class="magnetar-logo">✦</span>
            <span class="magnetar-batch-title">${magnets.length} torrents detected</span>
            ${truncatedNote}
          </div>
          <button class="magnetar-batch-close" id="magnetar-batch-close">✕</button>
        </div>
        <div class="magnetar-batch-controls">
          <label class="magnetar-batch-select-all">
            <input type="checkbox" id="magnetar-batch-all">
            <span>Select all</span>
          </label>
          <span class="magnetar-batch-count" id="magnetar-batch-count">0 selected</span>
        </div>
        <div class="magnetar-batch-list">${rows}</div>
        <div class="magnetar-batch-footer">
          <button class="magnetar-btn magnetar-btn-primary magnetar-batch-send" id="magnetar-batch-send" disabled>
            <span class="magnetar-btn-label">Send to ${modeLabels[mode] || 'Client'}</span>
            <span class="magnetar-btn-spinner" style="display:none"></span>
          </button>
          <button class="magnetar-btn magnetar-btn-cancel" id="magnetar-batch-dismiss">Dismiss</button>
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
    const checkboxes = panel.querySelectorAll('.magnetar-batch-cb');
    const selectAll = panel.querySelector('#magnetar-batch-all');
    const countEl = panel.querySelector('#magnetar-batch-count');
    const sendBtn = panel.querySelector('#magnetar-batch-send');

    if (showCache) {
      magnets.forEach((m, i) => {
        chrome.runtime.sendMessage({ type: 'check-cache', hash: m.hash })
          .then(res => {
            const dot = panel.querySelector(`#magnetar-bcd-${i}`);
            if (!dot) return;
            dot.classList.remove('magnetar-cache-loading');
            if (res?.status === 'cached') {
              dot.classList.add('magnetar-cache-cached');
              dot.title = 'Cached';
            } else if (res?.status === 'not_cached') {
              dot.classList.add('magnetar-cache-not-cached');
              dot.title = 'Not cached';
            } else {
              dot.classList.add('magnetar-cache-unknown');
              dot.title = 'Unknown';
            }
          })
          .catch(() => {});
      });
    }

    // ── Event handlers ──
    function updateCount() {
      const checked = panel.querySelectorAll('.magnetar-batch-cb:checked:not(:disabled)');
      countEl.textContent = `${checked.length} selected`;
      sendBtn.disabled = checked.length === 0;
    }

    checkboxes.forEach(cb => cb.addEventListener('change', () => {
      updateCount();
      const enabledCbs = [...checkboxes].filter(c => !c.disabled);
      const checkedCbs = enabledCbs.filter(c => c.checked);
      selectAll.checked = enabledCbs.length > 0 && checkedCbs.length === enabledCbs.length;
      selectAll.indeterminate = checkedCbs.length > 0 && checkedCbs.length < enabledCbs.length;
    }));

    selectAll.addEventListener('change', () => {
      checkboxes.forEach(cb => {
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
      checkboxes.forEach(cb => cb.disabled = true);

      const mappedCategory = settings?.preferences?.categoryMap?.[category] || category;

      if (mode === 'local') {
        for (let i = 0; i < selected.length; i++) {
          const item = selected[i];
          const statusEl = panel.querySelector(`#magnetar-bs-${magnets.indexOf(item)}`);
          window.open(item.magnetUri, '_blank');
          if (statusEl) statusEl.innerHTML = '<span class="magnetar-batch-badge magnetar-batch-badge-ok">✓</span>';
          if (i < selected.length - 1) await new Promise(r => setTimeout(r, 500));
        }
        showToast(`✓ Opened ${selected.length} magnet${selected.length > 1 ? 's' : ''}`);
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
              if (res.success) {
                successCount++;
                if (statusEl) statusEl.innerHTML = '<span class="magnetar-batch-badge magnetar-batch-badge-ok">✓</span>';
                const row = panel.querySelector(`.magnetar-batch-row[data-index="${idx}"]`);
                if (row) row.classList.add('magnetar-batch-done');
              } else {
                if (statusEl) statusEl.innerHTML = '<span class="magnetar-batch-badge magnetar-batch-badge-fail">✗</span>';
              }
            }
            showToast(`✓ Sent ${successCount}/${selected.length} torrents`);
          }
        } catch (e) {
          showToast(`✗ Batch send failed: ${e.message}`, true);
        }
      }

      if (label) label.style.display = 'inline';
      if (spinner) spinner.style.display = 'none';
      sendBtn.disabled = false;

      checkboxes.forEach(cb => {
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
      } else {
        showError(response?.error || 'Send failed');
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
    const name = detection.name || 'Torrent';
    const pageUrl = window.location.href;

    // Encode for share URLs
    const encodedName = encodeURIComponent(name);
    const encodedMagnet = encodeURIComponent(magnetUri);
    const encodedPage = encodeURIComponent(pageUrl);

    const menu = document.createElement('div');
    menu.id = 'magnetar-share-menu';
    menu.innerHTML = `
      <button class="magnetar-share-item" data-action="email" title="Email">
        <span class="magnetar-share-icon">✉</span><span>Email</span>
      </button>
      <button class="magnetar-share-item" data-action="x" title="X / Twitter">
        <span class="magnetar-share-icon">𝕏</span><span>X</span>
      </button>
      <button class="magnetar-share-item" data-action="reddit" title="Reddit">
        <span class="magnetar-share-icon">↗</span><span>Reddit</span>
      </button>
      <button class="magnetar-share-item" data-action="telegram" title="Telegram">
        <span class="magnetar-share-icon">➤</span><span>Telegram</span>
      </button>
      <button class="magnetar-share-item" data-action="copy" title="Copy link">
        <span class="magnetar-share-icon">⎘</span><span>Copy link</span>
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
          window.open(`mailto:?subject=${encodedName}&body=Check%20out%20this%20torrent%3A%0A%0A${encodedMagnet}%0A%0AFrom%3A%20${encodedPage}`);
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
          await handleCopy(magnetUri, 'Magnet link copied');
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
      if (inner) inner.innerHTML = '<span class="magnetar-success-text">✓ Sent successfully</span>';
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
      if (label) label.textContent = 'Retry';
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
      text.textContent = 'Cached';
    } else if (status === 'not_cached') {
      dot.classList.add('magnetar-cache-not-cached');
      text.textContent = 'Not cached';
    } else {
      dot.classList.add('magnetar-cache-unknown');
      text.textContent = 'Unknown';
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

})();
