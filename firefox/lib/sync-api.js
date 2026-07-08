/**
 * Magnetar Sync API helpers.
 *
 * These helpers send syncId/syncToken and encrypted envelopes only. They must
 * never receive or send encryption keys.
 */
var MagnetarSyncApi;
(function () {
  class MagnetarSyncApiError extends Error {
    constructor(message, status, payload) {
      super(message);
      this.name = 'MagnetarSyncApiError';
      this.status = status;
      this.payload = payload || null;
      this.conflict = status === 409;
      this.unauthorized = status === 401;
      this.notFound = status === 404;
    }
  }

  function normalizeServerUrl(serverUrl) {
    return String(serverUrl || MagnetarSyncContract.SERVER_URL).replace(/\/+$/g, '');
  }

  function authHeaders(syncToken) {
    if (!syncToken) throw new MagnetarSyncApiError('Missing sync token.', 0);
    return {
      Authorization: `Bearer ${syncToken}`
    };
  }

  async function parseJsonResponse(response) {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new MagnetarSyncApiError('Invalid sync server response.', response.status);
    }
  }

  async function requestJson(path, options = {}) {
    const response = await fetch(`${normalizeServerUrl(options.serverUrl)}${path}`, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store'
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      throw new MagnetarSyncApiError(payload?.error || `Sync request failed (${response.status}).`, response.status, payload);
    }
    return payload;
  }

  async function healthCheck(serverUrl = MagnetarSyncContract.SERVER_URL) {
    return await requestJson(MagnetarSyncContract.ENDPOINTS.health, { serverUrl });
  }

  async function createVault(serverUrl = MagnetarSyncContract.SERVER_URL) {
    return await requestJson(MagnetarSyncContract.ENDPOINTS.vaults, {
      serverUrl,
      method: 'POST'
    });
  }

  async function getVault({ serverUrl = MagnetarSyncContract.SERVER_URL, syncId, syncToken }) {
    if (!syncId) throw new MagnetarSyncApiError('Missing syncId.', 0);
    return await requestJson(MagnetarSyncContract.ENDPOINTS.vault(syncId), {
      serverUrl,
      headers: authHeaders(syncToken)
    });
  }

  async function putVault({ serverUrl = MagnetarSyncContract.SERVER_URL, syncId, syncToken, baseRevision, envelope }) {
    if (!syncId) throw new MagnetarSyncApiError('Missing syncId.', 0);
    if (!Number.isInteger(baseRevision) || baseRevision < 0) throw new MagnetarSyncApiError('Invalid baseRevision.', 0);
    if (!MagnetarSyncContract.isValidEnvelope(envelope)) throw new MagnetarSyncApiError('Invalid envelope.', 0);
    return await requestJson(MagnetarSyncContract.ENDPOINTS.vault(syncId), {
      serverUrl,
      method: 'PUT',
      headers: authHeaders(syncToken),
      body: { baseRevision, envelope }
    });
  }

  MagnetarSyncApi = {
    MagnetarSyncApiError,
    authHeaders,
    healthCheck,
    createVault,
    getVault,
    putVault
  };

  globalThis.MagnetarSyncApi = MagnetarSyncApi;
})();
