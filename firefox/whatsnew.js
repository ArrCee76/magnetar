/**
 * Magnetar What's New
 */

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('whatsnew-form');
  const goButton = document.getElementById('whatsnew-go');
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

  function setChecked(name, value, fallback) {
    const safeValue = value || fallback;
    const control = document.querySelector(`input[name="${name}"][value="${safeValue}"]`);
    if (control) control.checked = true;
  }

  try {
    const settings = (await MAGNETAR_API.runtime.sendMessage({ type: 'get-settings' })) || {};
    const preferences = settings.preferences || {};
    setChecked('interface-mode', preferences.interfaceMode === 'advanced' ? 'advanced' : 'standard', 'standard');
    setChecked('toolbar-style', preferences.bannerStyle === 'compact' ? 'compact' : 'full', 'full');
  } catch (e) {
    setChecked('interface-mode', 'standard', 'standard');
    setChecked('toolbar-style', 'full', 'full');
  }

  async function dismissWhatsNew() {
    await MAGNETAR_API.runtime.sendMessage({ type: 'dismiss-whatsnew' }).catch(() => {});
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    goButton.disabled = true;
    status.textContent = 'Saving...';

    try {
      const settings = (await MAGNETAR_API.runtime.sendMessage({ type: 'get-settings' })) || {};
      settings.preferences = settings.preferences || {};

      const interfaceMode = document.querySelector('input[name="interface-mode"]:checked')?.value;
      const toolbarStyle = document.querySelector('input[name="toolbar-style"]:checked')?.value;

      settings.preferences.interfaceMode = interfaceMode === 'advanced' ? 'advanced' : 'standard';
      settings.preferences.bannerStyle = toolbarStyle === 'compact' ? 'compact' : 'full';

      await MAGNETAR_API.runtime.sendMessage({ type: 'save-settings', data: settings });
      await dismissWhatsNew();
      window.close();
      status.textContent = 'Saved.';
    } catch (e) {
      status.textContent = 'Could not save. Try again.';
      goButton.disabled = false;
    }
  });

  MAGNETAR_API.runtime.sendMessage({ type: 'dismiss-whatsnew' }).catch(() => {});
});
