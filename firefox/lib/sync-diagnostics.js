/** Secret-safe diagnostics for canonical Saved, History, and Organised storage writes. */
var MagnetarSyncDiagnostics;
(function () {
  const KEYS = ['magnetar-saved', 'magnetar-history', 'magnetar-organised-folders'];
  const clone = value => JSON.parse(JSON.stringify(value == null ? null : value));
  const stableStringify = value => Array.isArray(value)
    ? `[${value.map(stableStringify).join(',')}]`
    : value && typeof value === 'object'
      ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
      : JSON.stringify(value);
  function fingerprint(value) {
    const input = stableStringify(value); let hash = 0x811c9dc5;
    for (let index = 0; index < input.length; index += 1) { hash ^= input.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; }
    return hash.toString(16).padStart(8, '0');
  }
  function state(data = {}) {
    return {
      saved: Array.isArray(data['magnetar-saved']) ? data['magnetar-saved'] : [],
      history: Array.isArray(data['magnetar-history']) ? data['magnetar-history'] : [],
      folders: data['magnetar-organised-folders'] && typeof data['magnetar-organised-folders'] === 'object'
        ? data['magnetar-organised-folders'] : { folders: [], deletedFolders: [] }
    };
  }
  function recordTime(item = {}) {
    const candidates = [item.deletedAt, item.updatedAt, item.savedAt, item.lastSentAt, item.timestamp, item.createdAt, item.addedAt];
    return Math.max(0, ...candidates.map(value => typeof value === 'number' ? value : Date.parse(String(value || ''))).filter(Number.isFinite));
  }
  function summary(value) {
    const folders = Array.isArray(value?.folders?.folders) ? value.folders.folders : [];
    const deletedFolders = Array.isArray(value?.folders?.deletedFolders) ? value.folders.deletedFolders : [];
    const assignments = folders.flatMap(folder => Array.isArray(folder.items) ? folder.items : []);
    return {
      saved: value.saved.length, history: value.history.length, folders: folders.length, assignments: assignments.length,
      tombstones: deletedFolders.length,
      newest: {
        saved: Math.max(0, ...value.saved.map(recordTime)), history: Math.max(0, ...value.history.map(recordTime)),
        folders: Math.max(0, ...folders.map(recordTime), ...deletedFolders.map(recordTime)), assignments: Math.max(0, ...assignments.map(recordTime))
      }
    };
  }
  async function write(storage, update, context = {}) {
    const timestamp = Date.now();
    const beforeData = await storage.get(KEYS);
    const before = state(beforeData);
    const afterData = { ...beforeData, ...clone(update) };
    const after = state(afterData);
    const incoming = state(Object.fromEntries(KEYS.filter(key => Object.prototype.hasOwnProperty.call(update, key)).map(key => [key, update[key]])));
    const beforeFingerprint = fingerprint(before);
    const afterFingerprint = fingerprint(after);
    const hasNonCanonicalUpdate = Object.keys(update || {}).some(key => !KEYS.includes(key));
    const skipped = beforeFingerprint === afterFingerprint && !hasNonCanonicalUpdate;
    console.info('Magnetar Sync canonical write', {
      timestamp: new Date(timestamp).toISOString(), syncRunId: context.syncRunId || `write-${timestamp.toString(36)}`,
      caller: context.caller || 'unknown', trigger: context.trigger || 'unknown', adapter: context.adapter || 'extension',
      canonicalFingerprintBefore: beforeFingerprint, incomingFingerprint: fingerprint(incoming), canonicalFingerprintAfter: afterFingerprint,
      recordCountsBefore: summary(before), recordCountsAfter: summary(after), checkpoint: context.checkpoint ?? null, cursor: context.cursor ?? null,
      operation: context.operation || 'replacement', skipped, acceptedBecause: context.acceptedBecause || (skipped ? 'canonical-state-unchanged' : 'validated-local-mutation')
    });
    if (!skipped) await storage.set(update);
    return { skipped, beforeFingerprint, afterFingerprint };
  }
  function lifecycle(event, detail = {}) {
    console.info('Magnetar Sync lifecycle', { timestamp: new Date().toISOString(), event, ...detail });
  }
  MagnetarSyncDiagnostics = { KEYS, fingerprint, state, summary, write, lifecycle };
  globalThis.MagnetarSyncDiagnostics = MagnetarSyncDiagnostics;
})();
