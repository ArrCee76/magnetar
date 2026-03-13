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

  // Init
  selectMode(currentMode);
  loadCredentials(settings?.credentials || {});

  // Mode card clicks
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
    // Real-Debrid
    if (creds.realdebrid?.apiKey) {
      document.getElementById('rd-apikey').value = creds.realdebrid.apiKey;
    }
    // RDT Client
    if (creds.rdtclient) {
      document.getElementById('rdt-url').value = creds.rdtclient.url || '';
      document.getElementById('rdt-username').value = creds.rdtclient.username || '';
      document.getElementById('rdt-password').value = creds.rdtclient.password || '';
      document.getElementById('rdt-rdkey').value = creds.rdtclient.rdApiKey || '';
    }
    // TorBox
    if (creds.torbox?.apiKey) {
      document.getElementById('tb-apikey').value = creds.torbox.apiKey;
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

    // Save first
    const s = await chrome.runtime.sendMessage({ type: 'get-settings' });
    s.credentials = s.credentials || {};
    s.credentials.realdebrid = { apiKey };
    await chrome.runtime.sendMessage({ type: 'save-settings', data: s });

    // Validate
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

  function showResult(el, message, success) {
    el.textContent = success ? `✓ ${message}` : `✗ ${message}`;
    el.className = 'test-result ' + (success ? 'success' : 'error');
  }


  // ═══════════════════════════════════════════════════════════════════════
  // Section 2: Magnetar Shield
  // ═══════════════════════════════════════════════════════════════════════

  const shieldEnabled = document.getElementById('shield-enabled');
  shieldEnabled.checked = shield?.enabled !== false;

  shieldEnabled.addEventListener('change', async () => {
    await chrome.runtime.sendMessage({ type: 'shield-toggle', enabled: shieldEnabled.checked });
  });

  renderShieldList(shield?.blockedDomains || []);

  // Add domain
  document.getElementById('shield-add-btn').addEventListener('click', async () => {
    const input = document.getElementById('shield-domain-input');
    const domain = input.value.trim().toLowerCase();
    if (!domain) return;

    const updated = await chrome.runtime.sendMessage({ type: 'shield-block', domain });
    renderShieldList(updated.blockedDomains);
    input.value = '';
  });

  // Enter key to add
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

    // Remove buttons
    list.querySelectorAll('.shield-item-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        const updated = await chrome.runtime.sendMessage({ type: 'shield-unblock', domain: btn.dataset.domain });
        renderShieldList(updated.blockedDomains);
      });
    });
  }

  // Export shield
  document.getElementById('shield-export').addEventListener('click', async () => {
    const s = await chrome.runtime.sendMessage({ type: 'shield-get' });
    downloadJSON('magnetar-shield.json', { blockedDomains: s.blockedDomains });
  });

  // Import shield
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
  // Section 3: Custom Sites
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

  // Update label when method changes
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

  // Export/Import custom sites
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
  // Section 4: Advanced
  // ═══════════════════════════════════════════════════════════════════════

  // Banner position
  const bannerPos = document.getElementById('banner-position');
  bannerPos.value = settings?.preferences?.bannerPosition || 'top';

  bannerPos.addEventListener('change', async () => {
    const s = await chrome.runtime.sendMessage({ type: 'get-settings' });
    s.preferences = s.preferences || {};
    s.preferences.bannerPosition = bannerPos.value;
    await chrome.runtime.sendMessage({ type: 'save-settings', data: s });
  });

  // Export all
  document.getElementById('export-all').addEventListener('click', async () => {
    const s = await chrome.runtime.sendMessage({ type: 'get-settings' });
    const sh = await chrome.runtime.sendMessage({ type: 'shield-get' });
    downloadJSON('magnetar-backup.json', { settings: s, shield: sh });
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
          // Re-init shield rules
          await chrome.runtime.sendMessage({ type: 'shield-toggle', enabled: true });
        }
      }

      // Reload page to reflect changes
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

    // Re-initialise
    await chrome.runtime.sendMessage({ type: 'shield-toggle', enabled: true });
    window.location.reload();
  });


  // ═══════════════════════════════════════════════════════════════════════
  // Footer
  // ═══════════════════════════════════════════════════════════════════════

  const manifest = chrome.runtime.getManifest();
  document.getElementById('settings-version').textContent = `v${manifest.version}`;
  document.getElementById('settings-coffee').href = 'https://buymeacoffee.com/arrcee76';
  document.getElementById('header-coffee').href = 'https://buymeacoffee.com/arrcee76';


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

});
