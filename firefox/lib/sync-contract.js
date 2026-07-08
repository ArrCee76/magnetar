/**
 * Magnetar Sync contract helpers.
 *
 * These helpers define local validation and payload shapes only. They do not
 * contact the server and must not log secrets or decrypted payloads.
 */
var MagnetarSyncContract;
(function () {
  const SERVER_URL = 'https://sync.arrcee.com';
  const PAIRING_TYPE = 'magnetar-sync-pairing';
  const PAIRING_VERSION = 1;
  const ENVELOPE_SCHEMA = 'magnetar-sync-v1';
  const PAYLOAD_SCHEMA = 1;
  const CIPHER = 'AES-256-GCM';

  const ENDPOINTS = {
    health: '/v1/health',
    vaults: '/v1/vaults',
    vault(syncId) {
      return `/v1/vaults/${encodeURIComponent(syncId)}`;
    }
  };

  function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function isBase64UrlLike(value) {
    return isNonEmptyString(value) && /^[A-Za-z0-9_-]+$/.test(value);
  }

  function isValidPairingPayload(value) {
    return isRecord(value) &&
      value.type === PAIRING_TYPE &&
      value.version === PAIRING_VERSION &&
      value.serverUrl === SERVER_URL &&
      isBase64UrlLike(value.syncId) &&
      isBase64UrlLike(value.syncToken) &&
      isBase64UrlLike(value.encryptionKey);
  }

  function isValidEnvelope(value) {
    return isRecord(value) &&
      value.schema === ENVELOPE_SCHEMA &&
      value.cipher === CIPHER &&
      isBase64UrlLike(value.nonce) &&
      isBase64UrlLike(value.ciphertext) &&
      typeof value.updatedAt === 'number' &&
      Number.isFinite(value.updatedAt);
  }

  function createPayloadSkeleton(timestamp = Date.now()) {
    return {
      schema: PAYLOAD_SCHEMA,
      createdAt: timestamp,
      updatedAt: timestamp,
      sections: {
        providers: {
          updatedAt: timestamp,
          items: []
        },
        selection: {
          updatedAt: timestamp,
          sendProvider: null,
          clientProvider: null
        },
        saved: {
          updatedAt: timestamp,
          items: []
        },
        history: {
          updatedAt: timestamp,
          items: []
        },
        mobileReviewQueue: {
          updatedAt: timestamp,
          items: []
        },
        preferences: {
          updatedAt: timestamp,
          data: {}
        }
      },
      devices: {}
    };
  }

  MagnetarSyncContract = {
    SERVER_URL,
    PAIRING_TYPE,
    PAIRING_VERSION,
    ENVELOPE_SCHEMA,
    PAYLOAD_SCHEMA,
    CIPHER,
    ENDPOINTS,
    isRecord,
    isValidPairingPayload,
    isValidEnvelope,
    createPayloadSkeleton
  };

  globalThis.MagnetarSyncContract = MagnetarSyncContract;
})();
