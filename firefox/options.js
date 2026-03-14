/**
 * Magnetar — Settings Page Script
 */

document.addEventListener('DOMContentLoaded', async () => {

  // ── Load all settings ──
  const settings = await chrome.runtime.sendMessage({ type: 'get-settings' });
  const shield = await chrome.runtime.sendMessage({ type: 'shield-get' });

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
      const s = await chrome.runtime.sendMessage({ type: 'get-settings' });
      s.mode = mode;
      await chrome.runtime.sendMessage({ type: 'save-settings', data: s });
    });
  });

  function loadCredentials(creds) {
    if (creds.realdebrid?.apiKey) {
      document.getElementById('rd-apikey').value = creds.realdebrid.apiKey;
    }
    if (creds.rdtclient) {
      document.getElementById('rdt-url').value = creds.rdtclient.url || '';
      document.getElementById('rdt-username').value = creds.rdtclient.username || '';
      document.getElementById('rdt-password').value = creds.rdtclient.password || '';
      document.getElementById('rdt-rdkey').value = creds.rdtclient.rdApiKey || '';
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

  document.getElementById('rd-test').addEventListener('click', async () => {
    const btn = document.getElementById('rd-test');
    const result = document.getElementById('rd-result');
    const apiKey = document.getElementById('rd-apikey').value.trim();

    if (!apiKey) { showResult(result, 'Please enter an API key', false); return; }

    btn.disabled = true;
    btn.textContent = 'Testing…';

    const s = await chrome.runtime.sendMessage({ type: 'get-settings' });
    s.credentials = s.credentials || {};
    s.credentials.realdebrid = { apiKey };
    await chrome.runtime.sendMessage({ type: 'save-settings', data: s });

    const res = await chrome.runtime.sendMessage({ type: 'validate-credentials', mode: 'realdebrid', credentials: { apiKey } });
    showResult(result, res.valid ? res.userInfo : (res.error || 'Validation failed'), res.valid);

    btn.disabled = false;
    btn.textContent = 'Save & Test';
  });

  document.getElementById('rdt-test').addEventListener('click', async () => {
    const btn = document.getElementById('rdt-test');
    const result = document.getElementById('rdt-result');

    const creds = {
      url: document.getElementById('rdt-url').value.trim(),
      username: document.getElementById('rdt-username').value.trim(),
      password: document.getElementById('rdt-password').value,
      rdApiKey: document.getElementById('rdt-rdkey').value.trim()
    };

    if (!creds.url || !creds.username) { showResult(result, 'URL and username are required', false); return; }

    btn.disabled = true;
    btn.textContent = 'Testing…';

    const s = await chrome.runtime.sendMessage({ type: 'get-settings' });
    s.credentials = s.credentials || {};
    s.credentials.rdtclient = creds;
    await chrome.runtime.sendMessage({ type: 'save-settings', data: s });

    const res = await chrome.runtime.sendMessage({ type: 'validate-credentials', mode: 'rdtclient', credentials: creds });
    showResult(result, res.valid ? res.userInfo : (res.error || 'Validation failed'), res.valid);

    btn.disabled = false;
    btn.textContent = 'Save & Test';
  });

  document.getElementById('tb-test').addEventListener('click', async () => {
    const btn = document.getElementById('tb-test');
    const result = document.getElementById('tb-result');
    const apiKey = document.getElementById('tb-apikey').value.trim();

    if (!apiKey) { showResult(result, 'Please enter an API key', false); return; }

    btn.disabled = true;
    btn.textContent = 'Testing…';

    const s = await chrome.runtime.sendMessage({ type: 'get-settings' });
    s.credentials = s.credentials || {};
    s.credentials.torbox = { apiKey };
    await chrome.runtime.sendMessage({ type: 'save-settings', data: s });

    const res = await chrome.runtime.sendMessage({ type: 'validate-credentials', mode: 'torbox', credentials: { apiKey } });
    showResult(result, res.valid ? res.userInfo : (res.error || 'Validation failed'), res.valid);

    btn.disabled = false;
    btn.textContent = 'Save & Test';
  });

  // Premiumize
  document.getElementById('pm-test').addEventListener('click', async () => {
    const btn = document.getElementById('pm-test');
    const result = document.getElementById('pm-result');
    const apiKey = document.getElementById('pm-apikey').value.trim();

    if (!apiKey) { showResult(result, 'Please enter an API key', false); return; }

    btn.disabled = true;
    btn.textContent = 'Testing…';

    const s = await chrome.runtime.sendMessage({ type: 'get-settings' });
    s.credentials = s.credentials || {};
    s.credentials.premiumize = { apiKey };
    await chrome.runtime.sendMessage({ type: 'save-settings', data: s });

    const res = await chrome.runtime.sendMessage({ type: 'validate-credentials', mode: 'premiumize', credentials: { apiKey } });
    showResult(result, res.valid ? res.userInfo : (res.error || 'Validation failed'), res.valid);

    btn.disabled = false;
    btn.textContent = 'Save & Test';
  });

  // AllDebrid
  document.getElementById('ad-test').addEventListener('click', async () => {
    const btn = document.getElementById('ad-test');
    const result = document.getElementById('ad-result');
    const apiKey = document.getElementById('ad-apikey').value.trim();

    if (!apiKey) { showResult(result, 'Please enter an API key', false); return; }

    btn.disabled = true;
    btn.textContent = 'Testing…';

    const s = await chrome.runtime.sendMessage({ type: 'get-settings' });
    s.credentials = s.credentials || {};
    s.credentials.alldebrid = { apiKey };
    await chrome.runtime.sendMessage({ type: 'save-settings', data: s });

    const res = await chrome.runtime.sendMessage({ type: 'validate-credentials', mode: 'alldebrid', credentials: { apiKey } });
    showResult(result, res.valid ? res.userInfo : (res.error || 'Validation failed'), res.valid);

    btn.disabled = false;
    btn.textContent = 'Save & Test';
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

  bannerEnabled.checked = settings?.preferences?.bannerEnabled !== false;
  bannerStyleEl.value = settings?.preferences?.bannerStyle || 'full';
  batchMode.checked = settings?.preferences?.batchMode === true;
  batchMaxEl.value = String(settings?.preferences?.batchMax || 25);
  bannerPos.value = settings?.preferences?.bannerPosition || 'top';

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

  bannerEnabled.addEventListener('change', async () => {
    const s = await chrome.runtime.sendMessage({ type: 'get-settings' });
    s.preferences = s.preferences || {};
    s.preferences.bannerEnabled = bannerEnabled.checked;
    await chrome.runtime.sendMessage({ type: 'save-settings', data: s });
    updateBannerInterlock();
  });

  bannerStyleEl.addEventListener('change', async () => {
    const s = await chrome.runtime.sendMessage({ type: 'get-settings' });
    s.preferences = s.preferences || {};
    s.preferences.bannerStyle = bannerStyleEl.value;
    await chrome.runtime.sendMessage({ type: 'save-settings', data: s });
  });

  batchMode.addEventListener('change', async () => {
    const s = await chrome.runtime.sendMessage({ type: 'get-settings' });
    s.preferences = s.preferences || {};
    s.preferences.batchMode = batchMode.checked;
    if (batchMode.checked) {
      s.preferences.bannerEnabled = true;
    }
    await chrome.runtime.sendMessage({ type: 'save-settings', data: s });
    updateBannerInterlock();
  });

  batchMaxEl.addEventListener('change', async () => {
    const s = await chrome.runtime.sendMessage({ type: 'get-settings' });
    s.preferences = s.preferences || {};
    s.preferences.batchMax = parseInt(batchMaxEl.value);
    await chrome.runtime.sendMessage({ type: 'save-settings', data: s });
  });

  bannerPos.addEventListener('change', async () => {
    const s = await chrome.runtime.sendMessage({ type: 'get-settings' });
    s.preferences = s.preferences || {};
    s.preferences.bannerPosition = bannerPos.value;
    await chrome.runtime.sendMessage({ type: 'save-settings', data: s });
  });


  // ═══════════════════════════════════════════════════════════════════════
  // Section 3: Magnetar Shield
  // ═══════════════════════════════════════════════════════════════════════

  const shieldEnabled = document.getElementById('shield-enabled');
  shieldEnabled.checked = shield?.enabled !== false;

  shieldEnabled.addEventListener('change', async () => {
    await chrome.runtime.sendMessage({ type: 'shield-toggle', enabled: shieldEnabled.checked });
  });

  renderShieldList(shield?.blockedDomains || []);

  document.getElementById('shield-add-btn').addEventListener('click', async () => {
    const input = document.getElementById('shield-domain-input');
    const domain = input.value.trim().toLowerCase();
    if (!domain) return;

    const updated = await chrome.runtime.sendMessage({ type: 'shield-block', domain });
    renderShieldList(updated.blockedDomains);
    input.value = '';
  });

  document.getElementById('shield-domain-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('shield-add-btn').click();
  });

  function renderShieldList(domains) {
    const list = document.getElementById('shield-list');
    list.innerHTML = domains.map(d => `
      <div class="shield-item">
        <span>${d}</span>
        <button class="shield-item-remove" data-domain="${d}" title="Remove">✕</button>
      </div>
    `).join('');

    list.querySelectorAll('.shield-item-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        const updated = await chrome.runtime.sendMessage({ type: 'shield-unblock', domain: btn.dataset.domain });
        renderShieldList(updated.blockedDomains);
      });
    });
  }

  document.getElementById('shield-export').addEventListener('click', async () => {
    const s = await chrome.runtime.sendMessage({ type: 'shield-get' });
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
          await chrome.runtime.sendMessage({ type: 'shield-block', domain });
        }
        const updated = await chrome.runtime.sendMessage({ type: 'shield-get' });
        renderShieldList(updated.blockedDomains);
      }
    } catch (err) {
      alert('Invalid JSON file');
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
    allHistory = await chrome.runtime.sendMessage({ type: 'get-history' });
    renderHistory(allHistory);
  }

  function renderHistory(items) {
    historyCount.textContent = `${allHistory.length} item${allHistory.length !== 1 ? 's' : ''}`;

    if (items.length === 0) {
      historyEmpty.style.display = 'block';
      historyEmpty.textContent = allHistory.length === 0 ? 'No downloads yet.' : 'No matches found.';
      // Clear any rendered items
      const existingItems = historyList.querySelectorAll('.history-item');
      existingItems.forEach(el => el.remove());
      return;
    }

    historyEmpty.style.display = 'none';

    // Build HTML
    const html = items.map(item => {
      const date = new Date(item.timestamp);
      const timeStr = formatDate(date);
      const name = escapeHtml(item.name || 'Unknown');
      const truncName = name.length > 55 ? name.substring(0, 52) + '…' : name;
      const hashShort = item.hash ? item.hash.substring(0, 10) + '…' : '';

      const providerLabels = {
        local: 'Local',
        realdebrid: 'Real-Debrid',
        rdtclient: 'RDT Client',
        torbox: 'TorBox'
      };

      const providerLabel = providerLabels[item.provider] || item.provider || '';
      const categoryLabel = item.category || '';

      return `
        <div class="history-item" data-hash="${item.hash}">
          <div class="history-item-main">
            <span class="history-item-name" title="${name}">${truncName}</span>
            <div class="history-item-meta">
              <span class="history-item-time">${timeStr}</span>
              ${providerLabel ? `<span class="history-item-pill">${providerLabel}</span>` : ''}
              ${categoryLabel ? `<span class="history-item-pill history-item-pill-cat">${categoryLabel}</span>` : ''}
              <span class="history-item-hash" title="${item.hash}">${hashShort}</span>
            </div>
          </div>
          <button class="history-item-delete" data-hash="${item.hash}" title="Remove from history">✕</button>
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
        await chrome.runtime.sendMessage({ type: 'delete-history-item', hash: btn.dataset.hash });
        await loadHistory();
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
      (item.category || '').toLowerCase().includes(query)
    );
    renderHistory(filtered);
  });

  // Export history
  document.getElementById('history-export').addEventListener('click', () => {
    downloadJSON('magnetar-history.json', { history: allHistory });
  });

  // Clear history
  document.getElementById('history-clear').addEventListener('click', async () => {
    if (!confirm('Clear all download history? This cannot be undone.')) return;
    await chrome.runtime.sendMessage({ type: 'clear-history' });
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
    document.getElementById('cs-value-label').textContent = method === 'selector' ? 'CSS Selector' : 'Regex pattern (use capture group for hash)';
    document.getElementById('cs-value').placeholder = method === 'selector' ? '#info-hash code' : '([a-fA-F0-9]{40})';
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

    const s = await chrome.runtime.sendMessage({ type: 'get-settings' });
    s.customSites = s.customSites || [];
    s.customSites.push(site);
    await chrome.runtime.sendMessage({ type: 'save-settings', data: s });

    renderCustomSites(s.customSites);
    document.getElementById('custom-site-form').style.display = 'none';
    clearCustomSiteForm();
  });

  function clearCustomSiteForm() {
    document.getElementById('cs-domain').value = '';
    document.getElementById('cs-value').value = '';
    document.getElementById('cs-method').value = 'selector';
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
          <span class="custom-site-domain">${site.domain}</span>
          <span class="custom-site-method">${site.method}: ${site.selector || site.regex}</span>
        </div>
        <button class="shield-item-remove" data-index="${i}" title="Remove">✕</button>
      </div>
    `).join('');

    list.querySelectorAll('.shield-item-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        const s = await chrome.runtime.sendMessage({ type: 'get-settings' });
        s.customSites.splice(parseInt(btn.dataset.index), 1);
        await chrome.runtime.sendMessage({ type: 'save-settings', data: s });
        renderCustomSites(s.customSites);
      });
    });
  }

  document.getElementById('cs-export').addEventListener('click', async () => {
    const s = await chrome.runtime.sendMessage({ type: 'get-settings' });
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
        const s = await chrome.runtime.sendMessage({ type: 'get-settings' });
        s.customSites = [...(s.customSites || []), ...data.customSites];
        await chrome.runtime.sendMessage({ type: 'save-settings', data: s });
        renderCustomSites(s.customSites);
      }
    } catch (err) {
      alert('Invalid JSON file');
    }
    e.target.value = '';
  });


  // ═══════════════════════════════════════════════════════════════════════
  // Section 6: Advanced
  // ═══════════════════════════════════════════════════════════════════════

  // Export all
  document.getElementById('export-all').addEventListener('click', async () => {
    const s = await chrome.runtime.sendMessage({ type: 'get-settings' });
    const sh = await chrome.runtime.sendMessage({ type: 'shield-get' });
    const hist = await chrome.runtime.sendMessage({ type: 'get-history' });
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
        await chrome.runtime.sendMessage({ type: 'save-settings', data: data.settings });
      }
      if (data.shield) {
        await chrome.storage.local.set({ shield: data.shield });
        if (data.shield.enabled) {
          await chrome.runtime.sendMessage({ type: 'shield-toggle', enabled: true });
        }
      }
      if (data.history && Array.isArray(data.history)) {
        await chrome.storage.local.set({ 'magnetar-history': data.history });
      }

      window.location.reload();
    } catch (err) {
      alert('Invalid JSON file');
    }
    e.target.value = '';
  });

  // Reset
  document.getElementById('reset-all').addEventListener('click', async () => {
    if (!confirm('Reset all Magnetar settings to defaults? This cannot be undone.')) return;

    await chrome.storage.sync.remove(['magnetar']);
    await chrome.storage.local.remove(['shield']);
    await chrome.storage.local.set({ 'magnetar-history': [] });

    await chrome.runtime.sendMessage({ type: 'shield-toggle', enabled: true });
    window.location.reload();
  });


  // ═══════════════════════════════════════════════════════════════════════
  // Footer
  // ═══════════════════════════════════════════════════════════════════════

  const manifest = chrome.runtime.getManifest();
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

  function formatDate(date) {
    const now = new Date();
    const diff = now - date;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;

    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  }

});
