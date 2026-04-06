/**
 * Magnetar — Popup Script
 */

document.addEventListener('DOMContentLoaded', async () => {

  const t = (key, ...subs) => chrome.i18n.getMessage(key, subs) || key;

  // Hydrate data-i18n attributes
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  document.querySelectorAll('option[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });

  // ── Load settings ──
  const settings = await chrome.runtime.sendMessage({ type: 'get-settings' });
  const shield = await chrome.runtime.sendMessage({ type: 'shield-get' });

  // ── Mode selector ──
  const modeSelect = document.getElementById('mode-select');
  modeSelect.value = settings?.mode || 'local';

  modeSelect.addEventListener('change', async () => {
    const newSettings = await chrome.runtime.sendMessage({ type: 'get-settings' });
    newSettings.mode = modeSelect.value;

    // Check if credentials exist for this mode
    const creds = newSettings.credentials?.[modeSelect.value];
    if (modeSelect.value !== 'local' && (!creds || Object.keys(creds).length === 0)) {
      // No creds — flash the settings gear
      const gear = document.getElementById('open-settings');
      gear.style.color = '#fbbf24';
      setTimeout(() => gear.style.color = '', 1500);
    }

    await chrome.runtime.sendMessage({ type: 'save-settings', data: newSettings });
  });

  // ── Shield toggle ──
  const shieldToggle = document.getElementById('shield-toggle');
  shieldToggle.checked = shield?.enabled !== false;

  const shieldCount = document.getElementById('shield-count');
  const count = shield?.blockedDomains?.length || 0;
  shieldCount.textContent = count === 1 ? t('popupShieldCountSingular') : t('popupShieldCount', String(count));

  shieldToggle.addEventListener('change', async () => {
    await chrome.runtime.sendMessage({ type: 'shield-toggle', enabled: shieldToggle.checked });
  });

  // ── Manage shield → open settings ──
  document.getElementById('manage-shield').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // ── Settings gear ──
  document.getElementById('open-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // ── Page status ──
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    const detection = await chrome.runtime.sendMessage({ type: 'get-detection', tabId: tab.id });
    const statusIcon = document.getElementById('status-icon');
    const statusText = document.getElementById('status-text');

    if (detection?.hash && !detection?.lowConfidence) {
      statusIcon.textContent = '●';
      statusIcon.style.color = '#4ade80';
      statusText.textContent = t('popupStatusHashFound', detection.hash.substring(0, 8));
      statusText.classList.add('status-active');
    } else if (detection?.noHash) {
      statusIcon.textContent = '◐';
      statusIcon.style.color = '#fbbf24';
      statusText.textContent = t('popupStatusNoHash');
      statusText.classList.add('status-dimmed');
    } else if (detection?.lowConfidence) {
      statusIcon.textContent = '◐';
      statusIcon.style.color = '#fbbf24';
      statusText.textContent = t('popupStatusLowConfidence');
      statusText.classList.add('status-dimmed');
    } else {
      statusIcon.textContent = '○';
      statusIcon.style.color = '#3a3f4a';
      statusText.textContent = t('popupStatusNone');
    }
  }

  // ── Version ──
  const manifest = chrome.runtime.getManifest();
  document.getElementById('popup-version').textContent = `v${manifest.version}`;

});
