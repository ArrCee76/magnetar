/**
 * Magnetar Sync crypto helpers.
 *
 * Encryption keys are generated and used client-side only. Do not log keys,
 * plaintext payloads, or decrypted data.
 */
var MagnetarSyncCrypto;
(function () {
  const KEY_BYTES = 32;
  const NONCE_BYTES = 12;
  const CIPHER = 'AES-256-GCM';

  function bytesToBase64Url(bytes) {
    const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binary = '';
    for (const byte of array) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function base64UrlToBytes(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new Error('Invalid base64url value.');
    }
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function randomBytes(length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
  }

  function generateEncryptionKey() {
    return bytesToBase64Url(randomBytes(KEY_BYTES));
  }

  async function importAesKey(base64UrlKey) {
    const raw = base64UrlToBytes(base64UrlKey);
    if (raw.byteLength !== KEY_BYTES) throw new Error('Invalid encryption key length.');
    return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  async function encryptJson(value, base64UrlKey) {
    const key = await importAesKey(base64UrlKey);
    const nonce = randomBytes(NONCE_BYTES);
    const encoded = new TextEncoder().encode(JSON.stringify(value));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, encoded);
    return {
      schema: MagnetarSyncContract.ENVELOPE_SCHEMA,
      cipher: CIPHER,
      nonce: bytesToBase64Url(nonce),
      ciphertext: bytesToBase64Url(ciphertext),
      updatedAt: Date.now()
    };
  }

  async function decryptJson(envelope, base64UrlKey) {
    if (!MagnetarSyncContract.isValidEnvelope(envelope)) throw new Error('Invalid sync envelope.');
    const key = await importAesKey(base64UrlKey);
    const nonce = base64UrlToBytes(envelope.nonce);
    const ciphertext = base64UrlToBytes(envelope.ciphertext);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext));
  }

  MagnetarSyncCrypto = {
    bytesToBase64Url,
    base64UrlToBytes,
    generateEncryptionKey,
    encryptJson,
    decryptJson
  };

  globalThis.MagnetarSyncCrypto = MagnetarSyncCrypto;
})();
