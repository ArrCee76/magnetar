/**
 * Magnetar 2.2 What's New
 */

document.addEventListener('DOMContentLoaded', async () => {
  const startButton = document.getElementById('whatsnew-start');
  const syncButton = document.getElementById('whatsnew-sync');
  const closeButton = document.getElementById('whatsnew-close');
  const status = document.getElementById('whatsnew-status');

  try {
    const themeRes = await MAGNETAR_API.runtime.sendMessage({ type: 'get-theme' });
    document.documentElement.classList.toggle('mg-dark', themeRes?.theme === 'dark');
  } catch (e) {}

  MAGNETAR_API.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'sync' || !changes.magnetar) return;
    const newTheme = changes.magnetar.newValue?.preferences?.theme;
    if (!newTheme) return;
    document.documentElement.classList.toggle('mg-dark', newTheme === 'dark');
  });

  async function dismissWhatsNew() {
    await MAGNETAR_API.runtime.sendMessage({ type: 'dismiss-whatsnew', version: '2.2' }).catch(() => {});
  }

  async function closePage() {
    await dismissWhatsNew();
    window.close();
  }

  startButton?.addEventListener('click', closePage);
  closeButton?.addEventListener('click', closePage);

  syncButton?.addEventListener('click', async () => {
    syncButton.disabled = true;
    status.textContent = 'Opening Sync...';
    await dismissWhatsNew();
    const result = await MAGNETAR_API.runtime.sendMessage({ type: 'open-sync-panel' }).catch(() => null);
    if (result?.ok) {
      window.close();
      return;
    }
    status.textContent = result?.error || 'Open a page with Magnetar active, then try again.';
    syncButton.disabled = false;
  });
});