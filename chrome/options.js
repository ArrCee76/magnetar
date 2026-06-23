/**
 * Magnetar — Settings Page Script
 */

document.addEventListener('DOMContentLoaded', async () => {

  // ── Theme: apply saved preference before anything renders ──
  try {
    const themeRes = await MAGNETAR_API.runtime.sendMessage({ type: 'get-theme' });
    if (themeRes?.theme === 'dark') {
      document.documentElement.classList.add('mg-dark');
    }
  } catch (e) {}


  // ── i18n helper ──
  const t = (key, ...subs) => MAGNETAR_API.i18n.getMessage(key, subs) || key;

  // Hydrate data-i18n and data-i18n-placeholder attributes
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  document.querySelectorAll('option[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });

  // ── Load all settings ──
  const settings = await MAGNETAR_API.runtime.sendMessage({ type: 'get-settings' });
  const shield = await MAGNETAR_API.runtime.sendMessage({ type: 'shield-get' });

  const currentMode = settings?.mode || 'local';


  // ═══════════════════════════════════════════════════════════════════════
  // Section 1: Download Mode
  // ═══════════════════════════════════════════════════════════════════════

  const modeCards = document.querySelectorAll('.mode-card');

  function selectMode(mode) {
    modeCards.forEach(c => c.classList.toggle('active', c.dataset.mode === mode));
    document.querySelectorAll('.creds-panel').forEach(p => p.style.display = 'none');
    const panel = document.getElementById(`creds-${mode}`);
    if (panel) panel.style.display = 'block';
  }

  selectMode(currentMode);
  loadCredentials(settings?.credentials || {});

  modeCards.forEach(card => {
    card.addEventListener('click', async () => {
      const mode = card.dataset.mode;
      selectMode(mode);
      const s = (await MAGNETAR_API.runtime.sendMessage({ type: 'get-settings' })) || {};
      s.mode = mode;
      await MAGNETAR_API.runtime.sendMessage({ type: 'save-settings', data: s });
    });
  });

  function loadCredentials(creds) {
    if (creds.local?.dashboardUrl) {
      document.getElementById('local-dashboard-url').value = creds.local.dashboardUrl;
    }
    if (creds.realdebrid?.apiKey) {
      document.getElementById('rd-apikey').value = creds.realdebrid.apiKey;
    }
    if (creds.rdtclient) {
      document.getElementById('rdt-url').value = creds.rdtclient.url || '';
      document.getElementById('rdt-username').value = creds.rdtclient.username || '';
      document.getElementById('rdt-password').value = creds.rdtclient.password || '';
      document.getElementById('rdt-rdkey').value = creds.rdtclient.rdApiKey || '';
      document.getElementById('rdt-dashboard-url').value = creds.rdtclient.dashboardUrl || '';
    }
    if (creds.torbox?.apiKey) {
      document.getElementById('tb-apikey').value = creds.torbox.apiKey;
    }
    if (creds.premiumize?.apiKey) {
      document.getElementById('pm-apikey').value = creds.premiumize.apiKey;
    }
    if (creds.alldebrid?.apiKey) {
      document.getElementById('ad-apikey').value = creds.alldebrid.apiKey;
    }
  }

  // ── Save & Test handlers ──

  function timeout(ms, message) {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    });
  }

  async function sendRuntimeMessage(message, ms = 20000) {
    return await Promise.race([
      MAGNETAR_API.runtime.sendMessage(message),
      timeout(ms, 'No response from extension background. Reload the extension and try again.')
    ]);
  }

  async function getSettingsForUpdate() {
    const s = await sendRuntimeMessage({ type: 'get-settings' }, 8000);
    return (s && typeof s === 'object') ? s : {};
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

  async function saveCredentialsAndValidate(mode, credentials) {
    const s = await getSettingsForUpdate();
    s.credentials = s.credentials || {};
    s.credentials[mode] = credentials;
    s.providerStatus = s.providerStatus || {};
    s.providerStatus[mode] = { valid: false, testedAt: Date.now() };
    await sendRuntimeMessage({ type: 'save-settings', data: s }, 8000);

    const res = await sendRuntimeMessage({
      type: 'validate-credentials',
      mode,
      credentials
    }, 20000);

    s.providerStatus[mode] = {
      valid: res?.valid === true,
      testedAt: Date.now()
    };
    await sendRuntimeMessage({ type: 'save-settings', data: s }, 8000);

    return res || { valid: false, error: 'No response from extension background.' };
  }

  async function saveDashboardUrl(mode, inputId) {
    const dashboardUrl = document.getElementById(inputId).value.trim();
    const s = await getSettingsForUpdate();
    s.credentials = s.credentials || {};
    s.credentials[mode] = s.credentials[mode] || {};
    if (dashboardUrl) {
      s.credentials[mode].dashboardUrl = dashboardUrl;
    } else {
      delete s.credentials[mode].dashboardUrl;
    }
    await sendRuntimeMessage({ type: 'save-settings', data: s }, 8000);
  }

  async function runCredentialTest(btnId, resultId, mode, credentials) {
    const btn = document.getElementById(btnId);
    const result = document.getElementById(resultId);

    btn.disabled = true;
    btn.textContent = t('btnTesting');

    try {
      const res = await saveCredentialsAndValidate(mode, credentials);
      showResult(result, res.valid ? res.userInfo : (res.error || t('validationFailed')), res.valid);
    } catch (e) {
      showResult(result, 'Test failed: ' + (e?.message || 'unknown error'), false);
    } finally {
      btn.disabled = false;
      btn.textContent = t('btnSaveTest');
    }
  }

  document.getElementById('rd-test').addEventListener('click', async () => {
    const result = document.getElementById('rd-result');
    const apiKey = document.getElementById('rd-apikey').value.trim();
    if (!apiKey) { showResult(result, t('validationEnterApiKey'), false); return; }
    await runCredentialTest('rd-test', 'rd-result', 'realdebrid', { apiKey });
  });

  document.getElementById('local-dashboard-url').addEventListener('change', async () => {
    await saveDashboardUrl('local', 'local-dashboard-url');
  });

  document.getElementById('rdt-test').addEventListener('click', async () => {
    const result = document.getElementById('rdt-result');
    const creds = {
      url: document.getElementById('rdt-url').value.trim(),
      username: document.getElementById('rdt-username').value.trim(),
      password: document.getElementById('rdt-password').value,
      rdApiKey: document.getElementById('rdt-rdkey').value.trim(),
      dashboardUrl: document.getElementById('rdt-dashboard-url').value.trim()
    };

    if (!creds.url || !creds.username) { showResult(result, t('validationEnterFields'), false); return; }
    await runCredentialTest('rdt-test', 'rdt-result', 'rdtclient', creds);
  });

  document.getElementById('rdt-dashboard-url').addEventListener('change', async () => {
    await saveDashboardUrl('rdtclient', 'rdt-dashboard-url');
  });

  document.getElementById('tb-test').addEventListener('click', async () => {
    const result = document.getElementById('tb-result');
    const apiKey = document.getElementById('tb-apikey').value.trim();
    if (!apiKey) { showResult(result, t('validationEnterApiKey'), false); return; }
    await runCredentialTest('tb-test', 'tb-result', 'torbox', { apiKey });
  });

  document.getElementById('pm-test').addEventListener('click', async () => {
    const result = document.getElementById('pm-result');
    const apiKey = document.getElementById('pm-apikey').value.trim();
    if (!apiKey) { showResult(result, t('validationEnterApiKey'), false); return; }
    await runCredentialTest('pm-test', 'pm-result', 'premiumize', { apiKey });
  });

  document.getElementById('ad-test').addEventListener('click', async () => {
    const result = document.getElementById('ad-result');
    const apiKey = document.getElementById('ad-apikey').value.trim();
    if (!apiKey) { showResult(result, t('validationEnterApiKey'), false); return; }
    await runCredentialTest('ad-test', 'ad-result', 'alldebrid', { apiKey });
  });

  function showResult(el, message, success) {
    el.textContent = success ? `✓ ${message}` : `✗ ${message}`;
    el.className = 'test-result ' + (success ? 'success' : 'error');
  }


  // ═══════════════════════════════════════════════════════════════════════
  // Section 2: Detection & Banner
  // ═══════════════════════════════════════════════════════════════════════

  const bannerEnabled = document.getElementById('banner-enabled');
  const bannerStyleEl = document.getElementById('banner-style');
  const bannerStyleRow = document.getElementById('banner-style-row');
  const batchMode = document.getElementById('batch-mode');
  const batchNote = document.getElementById('batch-note');
  const batchMaxRow = document.getElementById('batch-max-row');
  const batchMaxEl = document.getElementById('batch-max');
  const bannerPos = document.getElementById('banner-position');
  const interfaceMode = document.getElementById('interface-mode');

  bannerEnabled.checked = settings?.preferences?.bannerEnabled !== false;
  bannerStyleEl.value = settings?.preferences?.bannerStyle || 'full';
  batchMode.checked = settings?.preferences?.batchMode === true;
  batchMaxEl.value = String(settings?.preferences?.batchMax || 25);
  bannerPos.value = settings?.preferences?.bannerPosition || 'top';
  interfaceMode.value = settings?.preferences?.interfaceMode === 'advanced' ? 'advanced' : 'standard';

  function updateBannerInterlock() {
    if (batchMode.checked) {
      bannerEnabled.checked = true;
      bannerEnabled.disabled = true;
      bannerEnabled.closest('.toggle-row').classList.add('toggle-row-disabled');
      batchNote.style.display = 'flex';
      batchMaxRow.style.display = 'block';
    } else {
      bannerEnabled.disabled = false;
      bannerEnabled.closest('.toggle-row').classList.remove('toggle-row-disabled');
      batchNote.style.display = 'none';
      batchMaxRow.style.display = 'none';
    }
    // Show/hide banner style row based on banner enabled
    bannerStyleRow.style.display = bannerEnabled.checked ? 'flex' : 'none';
  }
  updateBannerInterlock();
  renderIgnoredWebsites(settings?.ignoredWebsites || []);

  bannerEnabled.addEventListener('change', async () => {
    const s = (await MAGNETAR_API.runtime.sendMessage({ type: 'get-settings' })) || {};
    s.preferences = s.preferences || {};
    s.preferences.bannerEnabled = bannerEnabled.checked;
    await MAGNETAR_API.runtime.sendMessage({ type: 'save-settings', data: s });
    updateBannerInterlock();
  });

  bannerStyleEl.addEventListener('change', async () => {
    const s = (await MAGNETAR_API.runtime.sendMessage({ type: 'get-settings' })) || {};
    s.preferences = s.preferences || {};
    s.preferences.bannerStyle = bannerStyleEl.value;
    await MAGNETAR_API.runtime.sendMessage({ type: 'save-settings', data: s });
  });

  batchMode.addEventListener('change', async () => {
    const s = (await MAGNETAR_API.runtime.sendMessage({ type: 'get-settings' })) || {};
    s.preferences = s.preferences || {};
    s.preferences.batchMode = batchMode.checked;
    if (batchMode.checked) {
      s.preferences.bannerEnabled = true;
    }
    await MAGNETAR_API.runtime.sendMessage({ type: 'save-settings', data: s });
    updateBannerInterlock();
  });

  batchMaxEl.addEventListener('change', async () => {
    const s = (await MAGNETAR_API.runtime.sendMessage({ type: 'get-settings' })) || {};
    s.preferences = s.preferences || {};
    s.preferences.batchMax = parseInt(batchMaxEl.value);
    await MAGNETAR_API.runtime.sendMessage({ type: 'save-settings', data: s });
  });

  bannerPos.addEventListener('change', async () => {
    const s = (await MAGNETAR_API.runtime.sendMessage({ type: 'get-settings' })) || {};
    s.preferences = s.preferences || {};
    s.preferences.bannerPosition = bannerPos.value;
    await MAGNETAR_API.runtime.sendMessage({ type: 'save-settings', data: s });
  });

  interfaceMode.addEventListener('change', async () => {
    const s = (await MAGNETAR_API.runtime.sendMessage({ type: 'get-settings' })) || {};
    s.preferences = s.preferences || {};
    s.preferences.interfaceMode = interfaceMode.value === 'advanced' ? 'advanced' : 'standard';
    await MAGNETAR_API.runtime.sendMessage({ type: 'save-settings', data: s });
  });


  // ═══════════════════════════════════════════════════════════════════════
  // Section 3: Ignored Websites
  // ═══════════════════════════════════════════════════════════════════════

  function renderIgnoredWebsites(domains) {
    const list = document.getElementById('ignored-websites-list');
    if (!list) return;
    const normalized = [...new Set((domains || []).map(normaliseDomain).filter(Boolean))].sort();
    if (!normalized.length) {
      list.innerHTML = '<div class="history-empty">No ignored websites.</div>';
      return;
    }

    list.innerHTML = normalized.map(domain => `
      <div class="shield-item">
        <span>${escapeHtml(domain)}</span>
        <button class="shield-item-remove" data-domain="${escapeAttr(domain)}" title="Remove">✕</button>
      </div>
    `).join('');

    list.querySelectorAll('.shield-item-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        const s = (await MAGNETAR_API.runtime.sendMessage({ type: 'get-settings' })) || {};
        const domain = normaliseDomain(btn.dataset.domain);
        s.ignoredWebsites = (s.ignoredWebsites || []).map(normaliseDomain).filter(d => d && d !== domain);
        await MAGNETAR_API.runtime.sendMessage({ type: 'save-settings', data: s });
        renderIgnoredWebsites(s.ignoredWebsites);
      });
    });
  }

  // Section 4: Magnetar Shield
  const shieldEnabled = document.getElementById('shield-enabled');
  let currentShield = shield || { enabled: true, blockedDomains: [], recommendedList: { installed: false, domains: [] } };
  let shieldListExpanded = false;
  shieldEnabled.checked = currentShield.enabled !== false;

  shieldEnabled.addEventListener('change', async () => {
    currentShield = await MAGNETAR_API.runtime.sendMessage({ type: 'shield-toggle', enabled: shieldEnabled.checked });
    renderRecommendedList(currentShield);
  });

  renderShieldList(currentShield.blockedDomains || []);
  renderRecommendedList(currentShield);

  document.getElementById('shield-add-btn').addEventListener('click', async () => {
    const input = document.getElementById('shield-domain-input');
    const domain = input.value.trim().toLowerCase();
    if (!domain) return;

    currentShield = await MAGNETAR_API.runtime.sendMessage({ type: 'shield-block', domain });
    renderShieldList(currentShield.blockedDomains);
    renderRecommendedList(currentShield);
    input.value = '';
  });

  document.getElementById('shield-domain-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('shield-add-btn').click();
  });

  document.getElementById('shield-list-toggle').addEventListener('click', () => {
    shieldListExpanded = !shieldListExpanded;
    renderShieldList(currentShield.blockedDomains || []);
  });

  function renderShieldList(domains) {
    const list = document.getElementById('shield-list');
    const count = document.getElementById('shield-list-count');
    const toggle = document.getElementById('shield-list-toggle');
    const total = Array.isArray(domains) ? domains.length : 0;
    count.textContent = total === 1 ? '1 blocked domain' : `${total} blocked domains`;
    toggle.textContent = shieldListExpanded ? 'Hide list' : 'Show list';
    toggle.setAttribute('aria-expanded', shieldListExpanded ? 'true' : 'false');
    toggle.disabled = total === 0;
    list.style.display = shieldListExpanded && total > 0 ? '' : 'none';

    list.innerHTML = domains.map(d => {
      const domain = String(d || '');
      return `
      <div class="shield-item">
        <span>${escapeHtml(domain)}</span>
        <button class="shield-item-remove" data-domain="${escapeAttr(domain)}" title="Remove">✕</button>
      </div>
    `;
    }).join('');

    list.querySelectorAll('.shield-item-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        currentShield = await MAGNETAR_API.runtime.sendMessage({ type: 'shield-unblock', domain: btn.dataset.domain });
        renderShieldList(currentShield.blockedDomains);
        renderRecommendedList(currentShield);
      });
    });
  }

  function formatRecommendedDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function setRecommendedStatus(message = '', type = '') {
    const status = document.getElementById('shield-recommended-status');
    status.textContent = message;
    status.className = `recommended-list-status ${type}`.trim();
  }

  function renderRecommendedList(shieldData = {}) {
    const list = shieldData.recommendedList || {};
    const installed = list.installed === true;
    const domains = Array.isArray(list.domains) ? list.domains : [];
    const installBtn = document.getElementById('shield-recommended-install');
    const removeBtn = document.getElementById('shield-recommended-remove');
    const viewBtn = document.getElementById('shield-recommended-view');
    const meta = document.getElementById('shield-recommended-meta');
    const domainList = document.getElementById('shield-recommended-domains');

    installBtn.textContent = installed ? 'Update list' : 'Install recommended list';
    removeBtn.style.display = installed ? '' : 'none';
    viewBtn.style.display = installed ? '' : 'none';
    meta.innerHTML = installed
      ? [
          '<div><strong>Installed</strong></div>',
          `<div>List name: ${escapeHtml(list.name || 'Magnetar recommended popup list')}</div>`,
          `<div>Version: ${escapeHtml(list.version || 'unknown')}</div>`,
          `<div>Domain count: ${domains.length}</div>`,
          `<div>Last updated: ${escapeHtml(formatRecommendedDate(list.updatedAt || list.version))}</div>`
        ].join('')
      : 'Not installed.';

    domainList.innerHTML = domains.map(domain => `
      <div class="shield-item">
        <span>${escapeHtml(domain)}</span>
        <button class="shield-item-remove" data-domain="${escapeAttr(domain)}" title="Remove from recommended list">&times;</button>
      </div>
    `).join('');
    domainList.querySelectorAll('.shield-item-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        const res = await MAGNETAR_API.runtime.sendMessage({
          type: 'shield-recommended-remove-domain',
          domain: btn.dataset.domain
        });
        if (res?.ok) {
          currentShield = res.shield;
          renderRecommendedList(currentShield);
          setRecommendedStatus(res.message || 'Domain removed from recommended list.', 'success');
        } else {
          setRecommendedStatus(res?.error || 'Recommended list is not valid.', 'error');
        }
      });
    });
    if (!installed) {
      domainList.style.display = 'none';
      viewBtn.textContent = 'View imported domains';
    }
  }

  document.getElementById('shield-recommended-install').addEventListener('click', async () => {
    const btn = document.getElementById('shield-recommended-install');
    const installed = currentShield?.recommendedList?.installed === true;
    btn.disabled = true;
    setRecommendedStatus(installed ? 'Updating recommended list...' : 'Installing recommended list...');
    try {
      const res = await MAGNETAR_API.runtime.sendMessage({ type: installed ? 'shield-recommended-update' : 'shield-recommended-install' });
      if (!res?.ok) throw new Error(res?.error || 'Could not fetch recommended list.');
      currentShield = res.shield;
      renderRecommendedList(currentShield);
      setRecommendedStatus(res.message || 'Recommended list updated.', 'success');
    } catch (e) {
      setRecommendedStatus(e?.message || 'Could not fetch recommended list.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('shield-recommended-remove').addEventListener('click', async () => {
    const res = await MAGNETAR_API.runtime.sendMessage({ type: 'shield-recommended-remove' });
    if (res?.ok) {
      currentShield = res.shield;
      renderRecommendedList(currentShield);
      setRecommendedStatus(res.message || 'Recommended list removed.', 'success');
    } else {
      setRecommendedStatus(res?.error || 'Recommended list is not valid.', 'error');
    }
  });

  document.getElementById('shield-recommended-view').addEventListener('click', () => {
    const domainList = document.getElementById('shield-recommended-domains');
    const viewBtn = document.getElementById('shield-recommended-view');
    const show = domainList.style.display === 'none';
    domainList.style.display = show ? '' : 'none';
    viewBtn.textContent = show ? 'Hide imported domains' : 'View imported domains';
  });

  document.getElementById('shield-export').addEventListener('click', async () => {
    const s = await MAGNETAR_API.runtime.sendMessage({ type: 'shield-get' });
    downloadJSON('magnetar-shield.json', { blockedDomains: s.blockedDomains });
  });

  document.getElementById('shield-import').addEventListener('click', () => {
    document.getElementById('shield-import-file').click();
  });

  document.getElementById('shield-import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.blockedDomains && Array.isArray(data.blockedDomains)) {
        for (const domain of data.blockedDomains) {
          await MAGNETAR_API.runtime.sendMessage({ type: 'shield-block', domain });
        }
        currentShield = await MAGNETAR_API.runtime.sendMessage({ type: 'shield-get' });
        renderShieldList(currentShield.blockedDomains);
        renderRecommendedList(currentShield);
      }
    } catch (err) {
      alert(t('invalidJsonFile'));
    }
    e.target.value = '';
  });


  // ═══════════════════════════════════════════════════════════════════════
  // Section 4: Download History
  // ═══════════════════════════════════════════════════════════════════════

  let allHistory = [];
  const historyList = document.getElementById('history-list');
  const historyEmpty = document.getElementById('history-empty');
  const historyCount = document.getElementById('history-count');
  const historySearch = document.getElementById('history-search');

  async function loadHistory() {
    allHistory = await MAGNETAR_API.runtime.sendMessage({ type: 'get-history' });
    renderHistory(allHistory);
  }

  function renderHistory(items) {
    historyCount.textContent = allHistory.length === 1 ? t('historyCountSingular') : t('historyCount', String(allHistory.length));

    if (items.length === 0) {
      historyEmpty.style.display = 'block';
      historyEmpty.textContent = allHistory.length === 0 ? t('historyEmpty') : t('historyNoMatches');
      // Clear any rendered items
      const existingItems = historyList.querySelectorAll('.history-item');
      existingItems.forEach(el => el.remove());
      return;
    }

    historyEmpty.style.display = 'none';

    // Build HTML
    const html = items.map(item => {
      const date = new Date(item.lastSentAt || item.timestamp);
      const timeStr = formatDate(date);
      const rawName = item.name || t('cacheUnknown');
      const truncName = rawName.length > 55 ? rawName.substring(0, 52) + '…' : rawName;
      const rawHash = item.hash || '';
      const hashShort = rawHash ? rawHash.substring(0, 10) + '…' : '';

      const providerLabels = {
        local: t('modeLocalName'),
        realdebrid: t('modeRealDebridName'),
        rdtclient: t('modeRdtClientName'),
        torbox: t('modeTorBoxName'),
        premiumize: t('modePremiumizeName'),
        alldebrid: t('modeAllDebridName')
      };

      const providerLabel = providerLabels[item.provider] || item.provider || '';
      const categoryLabel = item.category || '';
      const sourceUrl = (() => {
        try {
          const raw = item.sourceUrl || item.url || '';
          const url = new URL(raw);
          return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
        } catch (e) {
          return '';
        }
      })();
      const sourceDomain = item.sourceDomain || (() => {
        try {
          return sourceUrl ? new URL(sourceUrl).hostname.replace(/^www\./i, '') : '';
        } catch (e) {
          return '';
        }
      })();

      return `
        <div class="history-item" data-hash="${escapeAttr(rawHash)}">
          <div class="history-item-main">
            <span class="history-item-name" title="${escapeAttr(rawName)}">${escapeHtml(truncName)}</span>
            <div class="history-item-meta">
              <span class="history-item-source">${escapeHtml(sourceDomain || 'source unknown')}</span>
              <span class="history-item-time">${timeStr}</span>
              ${providerLabel ? `<span class="history-item-provider">${escapeHtml(providerLabel)}</span>` : ''}
              ${categoryLabel ? `<span class="history-item-category">${escapeHtml(categoryLabel)}</span>` : ''}
              <span class="history-item-hash" title="${escapeAttr(rawHash)}">${escapeHtml(hashShort)}</span>
            </div>
          </div>
          <div class="history-item-actions">
            <button class="history-item-action history-item-resend" data-hash="${escapeAttr(rawHash)}">Resend</button>
            <button class="history-item-action history-item-open" data-url="${escapeAttr(sourceUrl)}" ${sourceUrl ? '' : 'disabled'} title="Open source URL" aria-label="Open source URL">URL</button>
            <button class="history-item-delete" data-hash="${escapeAttr(rawHash)}" title="Delete history entry" aria-label="Delete history entry">&times;</button>
          </div>
        </div>
      `;
    }).join('');

    // Replace content (keep historyEmpty element)
    const existingItems = historyList.querySelectorAll('.history-item');
    existingItems.forEach(el => el.remove());
    historyList.insertAdjacentHTML('beforeend', html);

    // Delete handlers
    historyList.querySelectorAll('.history-item-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        await MAGNETAR_API.runtime.sendMessage({ type: 'delete-history-item', hash: btn.dataset.hash });
        await loadHistory();
      });
    });

    historyList.querySelectorAll('.history-item-resend').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const original = btn.textContent;
        btn.textContent = 'Sending?';
        const res = await MAGNETAR_API.runtime.sendMessage({ type: 'resend-history-item', hash: btn.dataset.hash });
        if (res?.action === 'open-magnet' && res.magnetUri) {
          await MAGNETAR_API.tabs.create({ url: res.magnetUri });
        }
        btn.textContent = res?.success ? 'Sent' : 'Unavailable';
        setTimeout(async () => {
          btn.textContent = original;
          btn.disabled = false;
          await loadHistory();
        }, 900);
      });
    });

    historyList.querySelectorAll('.history-item-open').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!btn.dataset.url) return;
        await MAGNETAR_API.tabs.create({ url: btn.dataset.url });
      });
    });
  }

  // Search/filter
  historySearch.addEventListener('input', () => {
    const query = historySearch.value.toLowerCase().trim();
    if (!query) {
      renderHistory(allHistory);
      return;
    }
    const filtered = allHistory.filter(item =>
      (item.name || '').toLowerCase().includes(query) ||
      (item.hash || '').toLowerCase().includes(query) ||
      (item.provider || '').toLowerCase().includes(query) ||
      (item.category || '').toLowerCase().includes(query) ||
      (item.sourceDomain || '').toLowerCase().includes(query) ||
      (item.sourceUrl || item.url || '').toLowerCase().includes(query)
    );
    renderHistory(filtered);
  });

  // Export history
  document.getElementById('history-export').addEventListener('click', () => {
    downloadJSON('magnetar-history.json', { history: allHistory });
  });

  // Clear history
  document.getElementById('history-clear').addEventListener('click', async () => {
    if (!confirm(t('historyClearConfirm'))) return;
    await MAGNETAR_API.runtime.sendMessage({ type: 'clear-history' });
    await loadHistory();
  });

  // Initial load
  await loadHistory();


  // ═══════════════════════════════════════════════════════════════════════
  // Section 5: Custom Sites
  // ═══════════════════════════════════════════════════════════════════════

  renderCustomSites(settings?.customSites || []);

  document.getElementById('add-custom-site').addEventListener('click', () => {
    document.getElementById('custom-site-form').style.display = 'block';
    document.getElementById('cs-domain').focus();
  });

  document.getElementById('cs-cancel').addEventListener('click', () => {
    document.getElementById('custom-site-form').style.display = 'none';
    clearCustomSiteForm();
  });

  document.getElementById('cs-method').addEventListener('change', () => {
    const method = document.getElementById('cs-method').value;
    document.getElementById('cs-value-label').textContent = method === 'selector' ? t('customSiteValueLabelSelector') : t('customSiteValueLabelRegex');
    document.getElementById('cs-value').placeholder = method === 'selector' ? '#info-hash, .infohash, code' : '([a-fA-F0-9]{40})';
    document.getElementById('cs-test-selector').style.display = method === 'selector' ? 'inline-flex' : 'none';
    document.getElementById('cs-method-help').textContent = method === 'selector'
      ? 'CSS selector means Magnetar will look for a page element containing a magnet link or torrent hash.'
      : 'Regex means Magnetar will search the page text and use the first captured torrent hash.';
    document.getElementById('cs-test-result').textContent = '';
  });

  document.getElementById('cs-test-selector').addEventListener('click', async () => {
    const domain = document.getElementById('cs-domain').value.trim();
    const selector = document.getElementById('cs-value').value.trim();
    const resultEl = document.getElementById('cs-test-result');
    resultEl.className = 'custom-site-test-result';
    if (!domain || !selector) {
      resultEl.classList.add('error');
      resultEl.textContent = 'Enter a domain pattern and CSS selector first.';
      return;
    }
    resultEl.textContent = 'Testing current tab...';
    try {
      const result = await MAGNETAR_API.runtime.sendMessage({
        type: 'test-custom-selector',
        domain,
        selector
      });
      if (!result?.ok) {
        resultEl.classList.add('error');
        resultEl.textContent = result?.error || 'Could not test selector on the current tab.';
        return;
      }
      resultEl.classList.add(result.valid ? 'success' : 'error');
      const preview = result.preview ? ` Preview: "${result.preview}"` : '';
      const valid = result.valid ? 'Valid magnet/hash detected.' : 'No valid magnet/hash detected.';
      resultEl.textContent = `${result.count} matching element${result.count === 1 ? '' : 's'} found. ${valid}${preview}`;
    } catch (e) {
      resultEl.classList.add('error');
      resultEl.textContent = 'Could not test selector on the current tab.';
    }
  });

  document.getElementById('cs-save').addEventListener('click', async () => {
    const domain = document.getElementById('cs-domain').value.trim();
    const method = document.getElementById('cs-method').value;
    const value = document.getElementById('cs-value').value.trim();

    if (!domain || !value) return;

    const site = {
      domain,
      method,
      selector: method === 'selector' ? value : null,
      regex: method === 'regex' ? value : null
    };

    const s = (await MAGNETAR_API.runtime.sendMessage({ type: 'get-settings' })) || {};
    s.customSites = s.customSites || [];
    s.customSites.push(site);
    await MAGNETAR_API.runtime.sendMessage({ type: 'save-settings', data: s });

    renderCustomSites(s.customSites);
    document.getElementById('custom-site-form').style.display = 'none';
    clearCustomSiteForm();
  });

  function clearCustomSiteForm() {
    document.getElementById('cs-domain').value = '';
    document.getElementById('cs-value').value = '';
    document.getElementById('cs-method').value = 'selector';
    document.getElementById('cs-value').placeholder = '#info-hash, .infohash, code';
    document.getElementById('cs-test-selector').style.display = 'inline-flex';
    document.getElementById('cs-test-result').textContent = '';
  }

  function renderCustomSites(sites) {
    const list = document.getElementById('custom-sites-list');
    if (!sites.length) {
      list.innerHTML = '<p style="color:#3a3f4a; font-size:12px; padding:4px 0;">No custom sites configured.</p>';
      return;
    }

    list.innerHTML = sites.map((site, i) => `
      <div class="custom-site-item">
        <div class="custom-site-info">
          <span class="custom-site-domain">${escapeHtml(site.domain || '')}</span>
          <span class="custom-site-method">${escapeHtml(site.method || '')}: ${escapeHtml(site.selector || site.regex || '')}</span>
        </div>
        <button class="shield-item-remove" data-index="${i}" title="Remove">✕</button>
      </div>
    `).join('');

    list.querySelectorAll('.shield-item-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        const s = (await MAGNETAR_API.runtime.sendMessage({ type: 'get-settings' })) || {};
        s.customSites.splice(parseInt(btn.dataset.index), 1);
        await MAGNETAR_API.runtime.sendMessage({ type: 'save-settings', data: s });
        renderCustomSites(s.customSites);
      });
    });
  }

  document.getElementById('cs-export').addEventListener('click', async () => {
    const s = (await MAGNETAR_API.runtime.sendMessage({ type: 'get-settings' })) || {};
    downloadJSON('magnetar-custom-sites.json', { customSites: s.customSites || [] });
  });

  document.getElementById('cs-import').addEventListener('click', () => {
    document.getElementById('cs-import-file').click();
  });

  document.getElementById('cs-import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.customSites && Array.isArray(data.customSites)) {
        const s = (await MAGNETAR_API.runtime.sendMessage({ type: 'get-settings' })) || {};
        s.customSites = [...(s.customSites || []), ...data.customSites];
        await MAGNETAR_API.runtime.sendMessage({ type: 'save-settings', data: s });
        renderCustomSites(s.customSites);
      }
    } catch (err) {
      alert(t('invalidJsonFile'));
    }
    e.target.value = '';
  });


  // ═══════════════════════════════════════════════════════════════════════
  // Section 6: Advanced
  // ═══════════════════════════════════════════════════════════════════════

  // Export all
  document.getElementById('export-all').addEventListener('click', async () => {
    const s = (await MAGNETAR_API.runtime.sendMessage({ type: 'get-settings' })) || {};
    const sh = await MAGNETAR_API.runtime.sendMessage({ type: 'shield-get' });
    const hist = await MAGNETAR_API.runtime.sendMessage({ type: 'get-history' });
    downloadJSON('magnetar-backup.json', { settings: s, shield: sh, history: hist });
  });

  // Import all
  document.getElementById('import-all').addEventListener('click', () => {
    document.getElementById('all-import-file').click();
  });

  document.getElementById('all-import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (data.settings) {
        await MAGNETAR_API.runtime.sendMessage({ type: 'save-settings', data: data.settings });
      }
      if (data.shield) {
        await MAGNETAR_API.storage.local.set({ shield: data.shield });
        if (data.shield.enabled) {
          await MAGNETAR_API.runtime.sendMessage({ type: 'shield-toggle', enabled: true });
        }
      }
      if (data.history && Array.isArray(data.history)) {
        await MAGNETAR_API.storage.local.set({ 'magnetar-history': data.history });
      }

      window.location.reload();
    } catch (err) {
      alert(t('invalidJsonFile'));
    }
    e.target.value = '';
  });

  // Reset
  document.getElementById('reset-all').addEventListener('click', async () => {
    if (!confirm(t('advancedResetConfirm'))) return;

    await MAGNETAR_API.storage.sync.remove(['magnetar']);
    await MAGNETAR_API.storage.local.remove(['shield']);
    await MAGNETAR_API.storage.local.set({ 'magnetar-history': [] });

    await MAGNETAR_API.runtime.sendMessage({ type: 'shield-toggle', enabled: true });
    window.location.reload();
  });


  // ═══════════════════════════════════════════════════════════════════════
  // Section 6: Appearance / Theme
  // ═══════════════════════════════════════════════════════════════════════

  const themeSelect = document.getElementById('theme-select');
  const themeRes = await MAGNETAR_API.runtime.sendMessage({ type: 'get-theme' });
  const currentTheme = themeRes?.theme || 'dark';
  themeSelect.value = currentTheme;
  applyTheme(currentTheme);

  themeSelect.addEventListener('change', async () => {
    const theme = themeSelect.value;
    await MAGNETAR_API.runtime.sendMessage({ type: 'set-theme', theme });
    applyTheme(theme);
  });

  function applyTheme(theme) {
    document.documentElement.classList.toggle('mg-dark', theme === 'dark');
    document.body.classList.toggle('magnetar-light', theme === 'light');
  }

  // Live-sync: if preferences change from another surface (popup, banner), reflect here without a refresh.
  MAGNETAR_API.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.magnetar) return;
    const prefs = changes.magnetar.newValue?.preferences || {};
    const newTheme = prefs.theme;
    if (newTheme) {
      themeSelect.value = newTheme;
      applyTheme(newTheme);
    }
    if (Object.prototype.hasOwnProperty.call(prefs, 'batchMode')) {
      batchMode.checked = prefs.batchMode === true;
      updateBannerInterlock();
    }
    renderIgnoredWebsites(changes.magnetar.newValue?.ignoredWebsites || []);
  });


  // ═══════════════════════════════════════════════════════════════════════
  // CSV Export
  // ═══════════════════════════════════════════════════════════════════════

  document.getElementById('history-export-csv')?.addEventListener('click', async () => {
    const res = await MAGNETAR_API.runtime.sendMessage({ type: 'export-history-csv' });
    if (res?.csv) {
      const blob = new Blob([res.csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'magnetar-history.csv';
      a.click();
      URL.revokeObjectURL(url);
    }
  });


  // ═══════════════════════════════════════════════════════════════════════
  // Footer
  // ═══════════════════════════════════════════════════════════════════════

  const manifest = MAGNETAR_API.runtime.getManifest();
  document.getElementById('settings-version').textContent = `v${manifest.version}`;


  // ═══════════════════════════════════════════════════════════════════════
  // Utilities
  // ═══════════════════════════════════════════════════════════════════════

  function downloadJSON(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatDate(date) {
    const now = new Date();
    const diff = now - date;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return t('timeJustNow');
    if (mins < 60) return t('timeMinutesAgo', String(mins));
    if (hours < 24) return t('timeHoursAgo', String(hours));
    if (days < 7) return t('timeDaysAgo', String(days));

    return date.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  }

});
