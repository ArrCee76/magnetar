/**
 * Magnetar Sync local settings storage.
 *
 * Sync secrets must stay in storage.local. Do not store syncToken or
 * encryptionKey in browser sync storage.
 */
var MagnetarSyncStorage;
(function () {
  const STORAGE_KEY = 'magnetar-sync-settings';

  function defaultSettings() {
    return {
      enabled: false,
      serverUrl: MagnetarSyncContract.SERVER_URL,
      syncId: '',
      syncToken: '',
      encryptionKey: '',
      lastRevision: 0,
      lastSyncAt: null,
      deviceId: '',
      deviceName: ''
    };
  }

  function normalizeSettings(value) {
    const defaults = defaultSettings();
    if (!MagnetarSyncContract.isRecord(value)) return defaults;
    return {
      ...defaults,
      enabled: value.enabled === true,
      serverUrl: typeof value.serverUrl === 'string' && value.serverUrl ? value.serverUrl : defaults.serverUrl,
      syncId: typeof value.syncId === 'string' ? value.syncId : '',
      syncToken: typeof value.syncToken === 'string' ? value.syncToken : '',
      encryptionKey: typeof value.encryptionKey === 'string' ? value.encryptionKey : '',
      lastRevision: Number.isInteger(value.lastRevision) && value.lastRevision >= 0 ? value.lastRevision : 0,
      lastSyncAt: typeof value.lastSyncAt === 'number' && Number.isFinite(value.lastSyncAt) ? value.lastSyncAt : null,
      deviceId: typeof value.deviceId === 'string' ? value.deviceId : '',
      deviceName: typeof value.deviceName === 'string' ? value.deviceName : ''
    };
  }

  async function loadSettings() {
    const data = await MAGNETAR_API.storage.local.get([STORAGE_KEY]);
    return normalizeSettings(data[STORAGE_KEY]);
  }

  async function saveSettings(settings) {
    const normalized = normalizeSettings(settings);
    await MAGNETAR_API.storage.local.set({ [STORAGE_KEY]: normalized });
    return normalized;
  }

  async function clearSettings() {
    await MAGNETAR_API.storage.local.remove([STORAGE_KEY]);
    return defaultSettings();
  }

  MagnetarSyncStorage = {
    STORAGE_KEY,
    defaultSettings,
    normalizeSettings,
    loadSettings,
    saveSettings,
    clearSettings
  };

  globalThis.MagnetarSyncStorage = MagnetarSyncStorage;
})();
