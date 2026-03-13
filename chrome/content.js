/**
 * Magnetar — Content Script
 * 
 * Runs on every page. Detects hashes via MagnetarDetector,
 * injects the banner if found, handles user actions.
 */

(async () => {
  // ── Quick bail for non-HTML ──
  if (!document.body) return;
  if (document.contentType && !document.contentType.includes('html')) return;

  // Avoid running in iframes
  if (window !== window.top) return;

  // ── Get settings and custom sites ──
  let settings;
  try {
    settings = await chrome.runtime.sendMessage({ type: 'get-settings' });
  } catch (e) {
    return; // Extension context invalid
  }

  const customSites = settings?.customSites || [];

  // ── Run detection ──
  const result = MagnetarDetector.detect(customSites);

  // Report to background (for icon state + popup)
  chrome.runtime.sendMessage({ type: 'detection-result', data: result }).catch(() => {});

  // No hash or low confidence — don't show banner
  if (!result || !result.hash || result.lowConfidence) return;

  // ── Check if this hash was dismissed on THIS page load ──
  // Use a page-level variable, not sessionStorage — so navigating away and back resets it
  if (window._magnetarDismissed && window._magnetarDismissed.includes(result.hash)) return;

  // ── Detect category ──
  const category = MagnetarCategories.detect();

  // ── Cache check ──
  let cacheStatus = 'unknown';
  const mode = settings?.mode || 'local';

  if (mode !== 'local') {
    // Fire cache check in background
    chrome.runtime.sendMessage({ type: 'check-cache', hash: result.hash })
      .then(res => {
        if (res?.status) {
          cacheStatus = res.status;
          updateCacheBadge(cacheStatus);
        }
      })
      .catch(() => {});
  }

  // ── Build Banner ──
  injectBanner(result, mode, category);


  // ── Banner Construction ────────────────────────────────────────────────

  function injectBanner(detection, mode, category) {
    // Remove any existing banner
    document.getElementById('magnetar-banner')?.remove();

    const banner = document.createElement('div');
    banner.id = 'magnetar-banner';
    banner.innerHTML = buildBannerHTML(detection, mode);

    document.body.appendChild(banner);

    // Trigger animation
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        banner.classList.add('magnetar-visible');
      });
    });

    // ── Event Listeners ──
    banner.querySelector('#magnetar-send')?.addEventListener('click', () => handleSend(detection, category));
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
      torbox: 'Send to TorBox'
    };

    const sendLabel = modeLabels[mode] || 'Send';
    const showCache = mode !== 'local';

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
          <button class="magnetar-btn magnetar-btn-secondary" id="magnetar-copy-magnet">Copy Magnet</button>
          <button class="magnetar-btn magnetar-btn-secondary" id="magnetar-copy-hash">Copy Hash</button>
          <button class="magnetar-btn magnetar-btn-cancel" id="magnetar-dismiss">Cancel</button>
        </div>
      </div>
    `;
  }


  // ── Actions ────────────────────────────────────────────────────────────

  async function handleSend(detection, category) {
    const btn = document.getElementById('magnetar-send');
    if (!btn) return;

    // Show spinner
    const label = btn.querySelector('.magnetar-btn-label');
    const spinner = btn.querySelector('.magnetar-btn-spinner');
    if (label) label.style.display = 'none';
    if (spinner) spinner.style.display = 'inline-block';
    btn.disabled = true;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'send-magnet',
        magnetUri: detection.magnetUri,
        category: settings?.preferences?.categoryMap?.[category] || category
      });

      if (response?.action === 'open-magnet') {
        // Local mode — open magnet URI directly
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

  async function handleCopy(text, successMsg) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(successMsg);
    } catch (e) {
      // Fallback for older browsers
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

    const inner = banner.querySelector('.magnetar-inner');
    if (inner) {
      const btnRow = banner.querySelector('.magnetar-button-row');
      if (btnRow) btnRow.innerHTML = '<span class="magnetar-success-text">✓ Sent successfully</span>';
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

  function showToast(message) {
    const existing = document.getElementById('magnetar-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'magnetar-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('magnetar-toast-visible'));
    setTimeout(() => {
      toast.classList.remove('magnetar-toast-visible');
      setTimeout(() => toast.remove(), 300);
    }, 1500);
  }

  function dismissBanner() {
    const banner = document.getElementById('magnetar-banner');
    if (!banner) return;
    banner.classList.remove('magnetar-visible');
    banner.classList.add('magnetar-hiding');
    setTimeout(() => banner.remove(), 300);

    // Track dismissed hash for this page load only
    if (result?.hash) {
      if (!window._magnetarDismissed) window._magnetarDismissed = [];
      if (!window._magnetarDismissed.includes(result.hash)) {
        window._magnetarDismissed.push(result.hash);
      }
    }
  }


  // ── Cache Badge Update ─────────────────────────────────────────────────

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


  // ── Util ───────────────────────────────────────────────────────────────

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

})();
