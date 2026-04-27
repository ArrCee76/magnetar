/**
 * Magnetar — Popup Script
 */

document.addEventListener('DOMContentLoaded', async () => {

  // ── Theme: apply saved preference before anything renders ──
  try {
    const themeRes = await MAGNETAR_API.runtime.sendMessage({ type: 'get-theme' });
    const dark = themeRes?.theme === 'dark';
    if (dark) document.documentElement.classList.add('mg-dark');
    const iconDark = document.getElementById('theme-icon-dark');
    const iconLight = document.getElementById('theme-icon-light');
    if (iconDark && iconLight) {
      iconDark.style.display = dark ? 'none' : '';
      iconLight.style.display = dark ? '' : 'none';
    }
  } catch (e) {}

  document.getElementById('theme-toggle')?.addEventListener('click', async () => {
    const isDark = document.documentElement.classList.toggle('mg-dark');
    const iconDark = document.getElementById('theme-icon-dark');
    const iconLight = document.getElementById('theme-icon-light');
    if (iconDark && iconLight) {
      iconDark.style.display = isDark ? 'none' : '';
      iconLight.style.display = isDark ? '' : 'none';
    }
    try {
      await MAGNETAR_API.runtime.sendMessage({ type: 'set-theme', theme: isDark ? 'dark' : 'light' });
    } catch (e) {}
  });

  // Live-sync: if theme is changed from another surface (banner, options), reflect here.
  MAGNETAR_API.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.magnetar) return;
    const newTheme = changes.magnetar.newValue?.preferences?.theme;
    if (!newTheme) return;
    const dark = newTheme === 'dark';
    document.documentElement.classList.toggle('mg-dark', dark);
    const iconDark = document.getElementById('theme-icon-dark');
    const iconLight = document.getElementById('theme-icon-light');
    if (iconDark && iconLight) {
      iconDark.style.display = dark ? 'none' : '';
      iconLight.style.display = dark ? '' : 'none';
    }
  });

  const t = (key, ...subs) => MAGNETAR_API.i18n.getMessage(key, subs) || key;

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
  const settings = await MAGNETAR_API.runtime.sendMessage({ type: 'get-settings' });
  const shield = await MAGNETAR_API.runtime.sendMessage({ type: 'shield-get' });

  // ── Mode selector ──
  const modeSelect = document.getElementById('mode-select');
  modeSelect.value = settings?.mode || 'local';

  modeSelect.addEventListener('change', async () => {
    const newSettings = await MAGNETAR_API.runtime.sendMessage({ type: 'get-settings' });
    newSettings.mode = modeSelect.value;

    // Check if credentials exist for this mode
    const creds = newSettings.credentials?.[modeSelect.value];
    if (modeSelect.value !== 'local' && (!creds || Object.keys(creds).length === 0)) {
      // No creds — flash the settings gear
      const gear = document.getElementById('open-settings');
      gear.style.color = '#fbbf24';
      setTimeout(() => gear.style.color = '', 1500);
    }

    await MAGNETAR_API.runtime.sendMessage({ type: 'save-settings', data: newSettings });
  });

  // ── Shield toggle ──
  const shieldToggle = document.getElementById('shield-toggle');
  shieldToggle.checked = shield?.enabled !== false;

  const shieldCount = document.getElementById('shield-count');
  const count = shield?.blockedDomains?.length || 0;
  shieldCount.textContent = count === 1 ? t('popupShieldCountSingular') : t('popupShieldCount', String(count));

  shieldToggle.addEventListener('change', async () => {
    await MAGNETAR_API.runtime.sendMessage({ type: 'shield-toggle', enabled: shieldToggle.checked });
  });

  // ── Manage shield → open settings ──
  document.getElementById('manage-shield').addEventListener('click', () => {
    MAGNETAR_API.runtime.openOptionsPage();
  });

  // ── Settings gear ──
  document.getElementById('open-settings').addEventListener('click', () => {
    MAGNETAR_API.runtime.openOptionsPage();
  });

  // ── Page status ──
  const [tab] = await MAGNETAR_API.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    const detection = await MAGNETAR_API.runtime.sendMessage({ type: 'get-detection', tabId: tab.id });
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
  const manifest = MAGNETAR_API.runtime.getManifest();
  document.getElementById('popup-version').textContent = `v${manifest.version}`;

});
