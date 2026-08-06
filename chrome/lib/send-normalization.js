/** Canonical send request normalisation shared by every background send path. */
var MagnetarSendNormalization;
(function () {
  const text = value => typeof value === 'string' ? value.trim() : '';
  const first = (...values) => values.map(text).find(Boolean) || '';
  function decodeLegacyMagnet(value) {
    const candidate = text(value);
    if (/^magnet:\?/i.test(candidate)) return candidate;
    if (!/^magnet%3a/i.test(candidate)) return '';
    try { const decoded = decodeURIComponent(candidate); return /^magnet:\?/i.test(decoded) ? decoded : ''; } catch { return ''; }
  }
  function magnetHash(value) {
    const match = text(value).match(/(?:^|[?&])xt=urn:btih:([a-f0-9]{40})(?:&|$)/i);
    return match ? match[1].toLowerCase() : '';
  }
  function normaliseHash(value) {
    const candidate = text(value).replace(/^hash:/i, '');
    if (/^[a-f0-9]{40}$/i.test(candidate)) return candidate.toLowerCase();
    return magnetHash(candidate);
  }
  function safeUrl(value) {
    const candidate = text(value);
    if (!candidate) return '';
    try { const parsed = new URL(candidate); return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? candidate : ''; } catch { return ''; }
  }
  function normalise(input = {}) {
    const item = input.item && typeof input.item === 'object' ? input.item : {};
    const magnetCandidate = first(input.magnetUri, input.magnet, item.magnetUri, item.magnet, item.value, item.link);
    const suppliedMagnet = decodeLegacyMagnet(magnetCandidate);
    const hash = normaliseHash(first(input.hash, input.infoHash, item.hash, item.infoHash, item.stableKey, item.itemKey, suppliedMagnet));
    const displayName = first(input.name, input.displayName, input.title, item.name, item.displayName, item.title) || 'Saved item';
    const magnet = suppliedMagnet || (hash ? `magnet:?xt=urn:btih:${hash}${displayName ? `&dn=${encodeURIComponent(displayName)}` : ''}` : '');
    const url = safeUrl(first(input.url, input.sourceUrl, input.pageUrl, item.url, item.sourceUrl, item.link, item.value));
    const itemKey = first(input.itemKey, input.stableKey, item.itemKey, item.stableKey) || (hash ? `hash:${hash}` : magnet ? `magnet:${magnet}` : url ? `url:${url}` : '');
    return {
      itemKey,
      displayName,
      payloadKind: suppliedMagnet ? 'magnet' : hash ? 'hash' : url ? 'url' : 'invalid',
      hash,
      magnet,
      url,
      sourceUrl: safeUrl(first(input.sourceUrl, input.pageUrl, item.sourceUrl, item.url)) || url,
      category: first(input.category, item.category)
    };
  }
  function validate(request, options = {}) {
    if (request.magnet) return { ok: true, dispatchField: 'magnet', value: request.magnet };
    if (request.url && options.supportsUrl === true) return { ok: true, dispatchField: 'url', value: request.url };
    return { ok: false, code: 'SAVED_SEND_INVALID_PAYLOAD', error: 'This Saved item does not contain a valid magnet or torrent hash.' };
  }
  MagnetarSendNormalization = { normalise, validate, normaliseHash, magnetHash };
  globalThis.MagnetarSendNormalization = MagnetarSendNormalization;
})();
