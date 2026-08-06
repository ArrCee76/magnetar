/**
 * Magnetar Sync data helpers.
 *
 * This phase exports only saved items and sent history. Provider configs,
 * API keys, preferences, and other sections are preserved or left empty.
 */
var MagnetarSyncData;
(function () {
  const SAVED_KEY = 'magnetar-saved';
  const HISTORY_KEY = 'magnetar-history';
  const ORGANISED_FOLDERS_KEY = 'magnetar-organised-folders';
  const HOSTED_CHECKPOINT_KEY = 'magnetar-sync-hosted-checkpoint';
  const ORGANISED_FOLDER_COLOR_IDS = new Set(['default', 'sage', 'blue', 'lavender', 'rose', 'peach', 'yellow', 'grey']);

  function normalizeOrganisedFolderColor(value) {
    const clean = String(value || '').trim().toLowerCase();
    return ORGANISED_FOLDER_COLOR_IDS.has(clean) ? clean : 'default';
  }
  const MOBILE_ACK_KEY = 'magnetar-sync-mobile-ack';
  const AUTO_STATUS_KEY = 'magnetar-sync-auto-status';
  const ORIGINS_KEY = 'magnetar-sync-item-origins';
  const AUTO_DEBOUNCE_MS = 3000;
  const AUTO_MIN_INTERVAL_MS = 10000;
  const AUTO_FAILURE_BACKOFF_MS = 30000;
  const AUTO_PULL_MIN_INTERVAL_MS = 30000;
  const AUTO_PULL_FAILURE_BACKOFF_MS = 30000;
  let autoPushTimer = null;
  let autoPushInFlight = false;
  let autoPullInFlight = false;
  let hostedSyncInFlight = null;
  let canonicalRunner = operation => operation();

  function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value == null ? null : value));
  }

  function isPaired(settings) {
    return !!(settings?.enabled && settings.syncId && settings.syncToken && settings.encryptionKey);
  }

  function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (isRecord(value)) {
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  function fnv1a(input) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }

  async function loadLocalSavedAndHistory() {
    const data = await MAGNETAR_API.storage.local.get([SAVED_KEY, HISTORY_KEY]);
    return {
      saved: Array.isArray(data[SAVED_KEY]) ? cloneJson(data[SAVED_KEY]) : [],
      history: Array.isArray(data[HISTORY_KEY]) ? cloneJson(data[HISTORY_KEY]) : []
    };
  }

  async function loadLocalOrganisedFolders() {
    const data = await MAGNETAR_API.storage.local.get([ORGANISED_FOLDERS_KEY]);
    return normalizeOrganisedFoldersSection(data[ORGANISED_FOLDERS_KEY]);
  }

  function normalizeMobileAcknowledgement(value) {
    if (!isRecord(value)) return null;
    const type = String(value.type || '').toLowerCase();
    const platform = String(value.platform || '').toLowerCase();
    if (type !== 'mobile' && platform !== 'android') return null;
    const capabilities = isRecord(value.capabilities) ? { ...value.capabilities } : {};
    return {
      paired: true,
      id: String(value.id || 'android'),
      type: value.type || 'mobile',
      platform: value.platform || 'android',
      name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : 'Magnetar Mobile',
      pairedAt: Number.isFinite(Number(value.pairedAt)) ? Number(value.pairedAt) : null,
      lastSeenAt: Number.isFinite(Number(value.lastSeenAt)) ? Number(value.lastSeenAt) : null,
      capabilities
    };
  }

  function extractMobileAcknowledgement(payload) {
    const candidates = [];
    if (isRecord(payload?.devices)) candidates.push(...Object.values(payload.devices));
    const sectionItems = payload?.sections?.devices?.items;
    if (Array.isArray(sectionItems)) candidates.push(...sectionItems);
    for (const candidate of candidates) {
      const ack = normalizeMobileAcknowledgement(candidate);
      if (ack) return ack;
    }
    return null;
  }

  async function loadMobileAcknowledgement() {
    const data = await MAGNETAR_API.storage.local.get([MOBILE_ACK_KEY]);
    return normalizeMobileAcknowledgement(data[MOBILE_ACK_KEY]);
  }


  async function saveMobileAcknowledgement(ack) {
    const normalized = normalizeMobileAcknowledgement(ack);
    if (normalized) {
      await MAGNETAR_API.storage.local.set({ [MOBILE_ACK_KEY]: normalized });
      return normalized;
    }
    await MAGNETAR_API.storage.local.remove([MOBILE_ACK_KEY]);
    return null;
  }

  function withLocalOrganisedFolders(payload, localSection, settings, timestamp = Date.now(), options = {}) {
    const local = normalizeOrganisedFoldersSection(localSection);
    if (!local) return payload;
    const next = normalizePayload(payload, timestamp);
    const remote = normalizeOrganisedFoldersSection(next.sections?.organisedFolders);
    const localUpdatedAt = Number(local.updatedAt) || 0;
    const remoteUpdatedAt = Number(remote?.updatedAt) || 0;
    if (!options.forceLocal && remoteUpdatedAt > localUpdatedAt) return next;
    next.sections = {
      ...next.sections,
      organisedFolders: {
        ...local,
        sourceDevice: local.sourceDevice || settings.deviceId || 'chrome'
      }
    };
    return next;
  }

  function computeSavedHistoryFingerprint(local) {
    const saved = Array.isArray(local?.saved) ? local.saved : [];
    const history = Array.isArray(local?.history) ? local.history : [];
    const organisedFolders = local?.organisedFolders || null;
    const summary = {
      savedCount: saved.length,
      historyCount: history.length,
      organisedFolders,
      savedLatest: Math.max(0, ...saved.map(item => Number(item?.savedAt || item?.createdAt || item?.timestamp || 0)).filter(Number.isFinite)),
      historyLatest: Math.max(0, ...history.map(item => Number(item?.lastSentAt || item?.timestamp || item?.createdAt || 0)).filter(Number.isFinite)),
      saved,
      history
    };
    return `${saved.length}:${history.length}:${summary.savedLatest}:${summary.historyLatest}:${fnv1a(stableStringify(summary))}`;
  }

  async function loadAutoStatus() {
    const data = await MAGNETAR_API.storage.local.get([AUTO_STATUS_KEY]);
    return isRecord(data[AUTO_STATUS_KEY]) ? data[AUTO_STATUS_KEY] : {};
  }

  async function saveAutoStatus(update) {
    const current = await loadAutoStatus();
    const cleanUpdate = { ...update };
    for (const key of Object.keys(cleanUpdate)) {
      if (cleanUpdate[key] === undefined) delete cleanUpdate[key];
    }
    const next = {
      ...current,
      ...cleanUpdate,
      updatedAt: Date.now()
    };
    await MAGNETAR_API.storage.local.set({ [AUTO_STATUS_KEY]: next });
    return next;
  }

  function syncItemKey(item) {
    const hash = normalizeHash(item?.hash || item?.infoHash) || extractHashFromMagnet(item?.magnet || item?.magnetUri);
    if (hash) return `hash:${hash.toLowerCase()}`;
    const magnet = typeof item?.magnet === 'string' ? item.magnet.trim() : typeof item?.magnetUri === 'string' ? item.magnetUri.trim() : '';
    if (magnet) return `magnet:${magnet}`;
    const provider = item?.providerId || item?.provider || item?.target || '';
    const sourceUrl = item?.sourceUrl || item?.url || '';
    if (provider && sourceUrl && item?.id) return `provider:${provider}:${sourceUrl}:${item.id}`;
    return `fallback:${String(sourceUrl).trim()}:${String(item?.name || item?.title || '').trim().toLowerCase()}:${String(item?.createdAt || item?.savedAt || item?.timestamp || '')}`;
  }

  function normalizeOrigins(value) {
    const normalizeSection = section => {
      if (!isRecord(section)) return {};
      const out = {};
      for (const [key, entry] of Object.entries(section)) {
        if (!key || !isRecord(entry)) continue;
        if (entry.source !== 'sync' && entry.source !== 'android-sync' && entry.source !== 'chrome-sync') continue;
        out[key] = {
          source: entry.source,
          lastSeenRevision: Number.isFinite(entry.lastSeenRevision) ? entry.lastSeenRevision : 0,
          lastSeenAt: Number.isFinite(entry.lastSeenAt) ? entry.lastSeenAt : 0
        };
      }
      return out;
    };
    if (!isRecord(value)) return { saved: {}, history: {} };
    return { saved: normalizeSection(value.saved), history: normalizeSection(value.history) };
  }

  function isSyncedOrigin(entry) {
    return entry?.source === 'sync' || entry?.source === 'android-sync' || entry?.source === 'chrome-sync';
  }

  async function loadOrigins() {
    const data = await MAGNETAR_API.storage.local.get([ORIGINS_KEY]);
    return normalizeOrigins(data[ORIGINS_KEY]);
  }

  async function saveOrigins(origins) {
    await MAGNETAR_API.storage.local.set({ [ORIGINS_KEY]: normalizeOrigins(origins) });
  }

  function mergeBySyncKey(baseItems, incomingItems) {
    const items = [];
    const indexByKey = new Map();
    for (const item of Array.isArray(baseItems) ? baseItems : []) {
      const key = syncItemKey(item);
      if (!indexByKey.has(key)) {
        indexByKey.set(key, items.length);
        items.push(item);
      }
    }
    for (const incoming of Array.isArray(incomingItems) ? incomingItems : []) {
      const key = syncItemKey(incoming);
      const index = indexByKey.get(key);
      if (index === undefined) {
        indexByKey.set(key, items.length);
        items.push(incoming);
      } else {
        items[index] = { ...items[index], ...incoming, id: items[index].id || incoming.id };
      }
    }
    return items;
  }
  function normalizePayload(value, timestamp = Date.now()) {
    const skeleton = MagnetarSyncContract.createPayloadSkeleton(timestamp);
    if (!isRecord(value)) return skeleton;
    return {
      ...skeleton,
      ...value,
      schema: 1,
      createdAt: typeof value.createdAt === 'number' ? value.createdAt : skeleton.createdAt,
      updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : skeleton.updatedAt,
      sections: {
        ...skeleton.sections,
        ...(isRecord(value.sections) ? value.sections : {})
      },
      devices: isRecord(value.devices) ? value.devices : {}
    };
  }

  function withChromeSavedHistory(payload, saved, history, settings, origins, timestamp = Date.now(), revision = 0) {
    const next = normalizePayload(payload, timestamp);
    const nextOrigins = normalizeOrigins(origins);
    const remoteSaved = Array.isArray(next.sections?.saved?.items) ? cloneJson(next.sections.saved.items) : [];
    const remoteHistory = Array.isArray(next.sections?.history?.items) ? cloneJson(next.sections.history.items) : [];
    const localSaved = Array.isArray(saved) ? cloneJson(saved) : [];
    const localHistory = Array.isArray(history) ? cloneJson(history) : [];
    const localSavedKeys = new Set(localSaved.map(syncItemKey));
    const savedByKey = new Map();

    for (const item of remoteSaved) {
      const key = syncItemKey(item);
      if (localSavedKeys.has(key)) continue;
      savedByKey.set(key, item);
    }
    for (const item of localSaved) {
      const key = syncItemKey(item);
      savedByKey.set(key, item);
      nextOrigins.saved[key] = { source: 'sync', lastSeenRevision: revision, lastSeenAt: timestamp };
    }

    const localHistoryKeys = new Set(localHistory.map(syncItemKey));
    const retainedRemoteHistory = [];
    let historyRemoved = 0;
    for (const item of remoteHistory) {
      const key = syncItemKey(item);
      if (localHistoryKeys.has(key)) continue;
      retainedRemoteHistory.push(item);
    }
    const mergedHistory = mergeBySyncKey(retainedRemoteHistory, localHistory);
    for (const item of mergedHistory) {
      nextOrigins.history[syncItemKey(item)] = { source: 'sync', lastSeenRevision: revision, lastSeenAt: timestamp };
    }

    next.updatedAt = timestamp;
    next.sections = {
      ...next.sections,
      saved: {
        ...(isRecord(next.sections?.saved) ? next.sections.saved : {}),
        updatedAt: timestamp,
        items: [...savedByKey.values()]
      },
      history: {
        ...(isRecord(next.sections?.history) ? next.sections.history : {}),
        updatedAt: timestamp,
        items: mergedHistory
      }
    };
    const deviceId = settings.deviceId || 'chrome';
    next.devices = {
      ...next.devices,
      [deviceId]: {
        name: settings.deviceName || 'Chrome',
        lastSeenAt: timestamp
      }
    };
    return { payload: next, origins: nextOrigins, savedCount: localSaved.length, historyCount: localHistory.length };
  }

  function buildMagnetUri(hash, name) {
    const cleanHash = normalizeHash(hash);
    if (!cleanHash) return '';
    const dn = name ? `&dn=${encodeURIComponent(name)}` : '';
    return `magnet:?xt=urn:btih:${cleanHash}${dn}`;
  }

  function sourceDomainFromUrl(value) {
    try {
      const url = String(value || '').trim();
      if (!url) return '';
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (e) {
      return '';
    }
  }

  function normalizeChromeSavedItem(item, index = 0) {
    const hash = normalizeHash(item?.hash || item?.infoHash) || extractHashFromMagnet(item?.magnet || item?.magnetUri);
    const name = String(item?.name || item?.title || 'Synced item').trim() || 'Synced item';
    const magnetUri = String(item?.magnetUri || item?.magnet || '').trim() || buildMagnetUri(hash, name);
    const savedAt = Number(item?.savedAt ?? item?.createdAt ?? item?.addedAt ?? item?.timestamp ?? 0);
    return {
      ...item,
      id: item?.id || `sync-saved-${hash || savedAt}-${index}`,
      hash,
      name,
      magnetUri,
      category: item?.category || '',
      sourceUrl: item?.sourceUrl || item?.url || '',
      savedAt: Number.isFinite(savedAt) ? savedAt : 0
    };
  }

  function normalizeChromeHistoryItem(item, index = 0) {
    const hash = normalizeHash(item?.hash || item?.infoHash) || extractHashFromMagnet(item?.magnet || item?.magnetUri);
    const name = String(item?.name || item?.title || 'Synced item').trim() || 'Synced item';
    const magnetUri = String(item?.magnetUri || item?.magnet || '').trim() || buildMagnetUri(hash, name);
    const sourceUrl = item?.sourceUrl || item?.url || '';
    const timestamp = Number(item?.timestamp ?? item?.lastSentAt ?? item?.createdAt ?? item?.addedAt ?? 0);
    const provider = item?.provider || item?.providerId || item?.target || '';
    return {
      ...item,
      id: item?.id || `sync-history-${hash || timestamp}-${index}`,
      hash,
      name,
      provider,
      category: item?.category || '',
      url: sourceUrl,
      sourceUrl,
      sourceDomain: item?.sourceDomain || sourceDomainFromUrl(sourceUrl),
      magnetUri,
      timestamp: Number.isFinite(timestamp) ? timestamp : 0,
      lastSentAt: Number.isFinite(Number(item?.lastSentAt)) ? Number(item.lastSentAt) : (Number.isFinite(timestamp) ? timestamp : 0),
      sendCount: Number.isFinite(Number(item?.sendCount)) ? Number(item.sendCount) : 1
    };
  }
  function normalizeOrganisedFolderItem(item, index = 0) {
    if (!isRecord(item)) return null;
    const clean = value => (typeof value === 'string' ? value.trim() : '');
    const displayName = clean(item.displayName);
    const name = clean(item.name);
    const title = clean(item.title) || name || displayName || 'Client item';
    const hash = normalizeHash(item.hash || item.infoHash) || extractHashFromMagnet(item.magnet || item.magnetUri);
    const magnet = clean(item.magnet) || clean(item.magnetUri);
    const sourceUrl = clean(item.sourceUrl) || clean(item.url);
    const provider = clean(item.provider || item.sourceProvider).toLowerCase();
    const providerId = clean(item.providerItemId || item.providerItemKey || item.torrentId);
    const parentItemKey = clean(item.parentItemKey) || (provider && providerId ? `provider:${provider}:${providerId}` : '');
    const providerFileId = clean(item.providerFileId || item.fileId);
    const filePath = clean(item.filePath);
    const preciseKey = item.kind === 'provider-file' && parentItemKey && providerFileId
      ? `provider-file:${parentItemKey}:${providerFileId}`
      : item.kind === 'provider-file' && parentItemKey && filePath
        ? `provider-file-path:${parentItemKey}:${filePath.toLowerCase()}`
        : provider && providerId
          ? `provider:${provider}:${providerId}`
          : '';
    const itemKey = clean(item.itemKey) || clean(item.stableKey) || preciseKey || (hash ? `hash:${hash.toLowerCase()}` : '') || (magnet ? `magnet:${magnet}` : '') || sourceUrl || clean(item.id) || title;
    return {
      id: String(item.id || `folder-item-${index}`),
      itemKey,
      title,
      name: name || title,
      displayName: displayName || '',
      kind: String(item.kind || 'provider-item').trim() || 'provider-item',
      clientType: String(item.clientType || item.provider || item.sourceProvider || '').trim(),
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
      addedAt: Number.isFinite(Number(item.addedAt)) ? Number(item.addedAt) : 0,
      updatedAt: Number.isFinite(Number(item.updatedAt)) ? Number(item.updatedAt) : 0,
      provider: item.provider || item.sourceProvider || '',
      sourceProvider: item.sourceProvider || item.provider || '',
      providerItemId: item.providerItemId || '',
      providerItemKey: item.providerItemKey || '',
      providerFileId: item.providerFileId || item.fileId || '',
      fileId: item.fileId || '',
      filePath: item.filePath || '',
      parentItemKey: item.parentItemKey || '',
      parentTitle: item.parentTitle || '',
      torrentId: item.torrentId || '',
      hash,
      infoHash: hash,
      magnet,
      magnetUri: magnet,
      url: sourceUrl,
      sourceUrl,
      sourceDomain: item.sourceDomain || sourceDomainFromUrl(sourceUrl),
      status: item.status || '',
      availability: item.availability || '',
      mediaKind: item.mediaKind || ''
    };
  }
  function normalizeOrganisedFolderTombstone(value) {
    if (!isRecord(value)) return null;
    const id = String(value.id || "").trim();
    if (!id) return null;
    return {
      id,
      deletedAt: Number.isFinite(Number(value.deletedAt)) ? Number(value.deletedAt) : 0,
      sourceDevice: String(value.sourceDevice || "").trim()
    };
  }

  function normalizeOrganisedFoldersSection(section) {
    if (!isRecord(section) || !Array.isArray(section.folders)) return null;
    const deletedFolders = Array.isArray(section.deletedFolders)
      ? section.deletedFolders.map(normalizeOrganisedFolderTombstone).filter(Boolean)
      : [];
    const deletedAtById = new Map(deletedFolders.map(entry => [entry.id, Number(entry.deletedAt) || 0]));
    const folders = section.folders.map((folder, index) => {
      if (!isRecord(folder)) return null;
      const items = Array.isArray(folder.items)
        ? folder.items.map(normalizeOrganisedFolderItem).filter(Boolean)
        : [];
      return {
        id: String(folder.id || `folder-${index}`),
        name: String(folder.name || 'Folder').trim() || 'Folder',
        order: Number.isFinite(Number(folder.order)) ? Number(folder.order) : index,
        createdAt: Number.isFinite(Number(folder.createdAt)) ? Number(folder.createdAt) : 0,
        updatedAt: Number.isFinite(Number(folder.updatedAt)) ? Number(folder.updatedAt) : 0,
        systemKey: folder.systemKey || '',
        color: normalizeOrganisedFolderColor(folder.color),
        items
      };
    }).filter(Boolean).filter(folder => !(deletedAtById.get(folder.id) > Number(folder.updatedAt || 0))).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    return {
      schema: 'magnetar-folders-v1',
      updatedAt: Number.isFinite(Number(section.updatedAt)) ? Number(section.updatedAt) : 0,
      sourceDevice: section.sourceDevice || '',
      deletedFolders,
      folders
    };
  }
  function mergeRemoteSavedHistoryIntoLocal(payload, local, origins, revision = 0, timestamp = Date.now()) {
    const nextOrigins = normalizeOrigins(origins);
    const remoteSaved = (Array.isArray(payload?.sections?.saved?.items) ? cloneJson(payload.sections.saved.items) : []).map(normalizeChromeSavedItem);
    const remoteHistory = (Array.isArray(payload?.sections?.history?.items) ? cloneJson(payload.sections.history.items) : []).map(normalizeChromeHistoryItem);
    const retainedSaved = Array.isArray(local?.saved) ? local.saved : [];
    const saved = mergeBySyncKey(retainedSaved.map(normalizeChromeSavedItem), remoteSaved);
    const retainedHistory = (Array.isArray(local?.history) ? local.history : []).map(normalizeChromeHistoryItem);
    const historyRemoved = 0;
    const history = mergeBySyncKey(retainedHistory, remoteHistory);
    for (const item of remoteSaved) nextOrigins.saved[syncItemKey(item)] = { source: 'sync', lastSeenRevision: revision, lastSeenAt: timestamp };
    for (const item of remoteHistory) nextOrigins.history[syncItemKey(item)] = { source: 'sync', lastSeenRevision: revision, lastSeenAt: timestamp };
    return { saved, history, origins: nextOrigins, remoteSavedCount: remoteSaved.length, remoteHistoryCount: remoteHistory.length, historyRemoved };
  }

  function normalizeHash(value) {
    const hash = typeof value === 'string' ? value.trim() : '';
    if (/^[a-fA-F0-9]{40}$/.test(hash)) return hash.toLowerCase();
    if (/^[A-Z2-7]{32}$/i.test(hash)) return hash.toUpperCase();
    return '';
  }

  function extractHashFromMagnet(value) {
    const magnet = typeof value === 'string' ? value.trim() : '';
    const match = magnet.match(/btih:([a-fA-F0-9]{40}|[A-Z2-7]{32})/i);
    return normalizeHash(match?.[1] || '');
  }

  function reviewQueueKey(item) {
    const hash = normalizeHash(item?.hash || item?.infoHash) || extractHashFromMagnet(item?.magnet);
    if (hash) return `hash:${hash.toLowerCase()}`;
    const magnet = typeof item?.magnet === 'string' ? item.magnet.trim() : '';
    if (magnet) return `magnet:${magnet}`;
    return `fallback:${String(item?.sourceUrl || '').trim()}:${String(item?.title || '').trim().toLowerCase()}`;
  }

  function makeReviewSendId(timestamp) {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    const random = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    return `send-${timestamp.toString(36)}-${random}`;
  }

  function normalizeReviewQueueItem(input, settings, timestamp = Date.now()) {
    const hash = normalizeHash(input?.hash || input?.infoHash) || extractHashFromMagnet(input?.magnet);
    const magnet = typeof input?.magnet === 'string' ? input.magnet.trim() : '';
    const title = typeof input?.title === 'string' && input.title.trim() ? input.title.trim() : 'Review item';
    const sourceUrl = typeof input?.sourceUrl === 'string' ? input.sourceUrl.trim() : '';
    const sourceDomain = typeof input?.sourceDomain === 'string' ? input.sourceDomain.trim() : '';
    const key = reviewQueueKey({ ...input, hash, infoHash: hash, magnet, title, sourceUrl });
    const sendId = makeReviewSendId(timestamp);
    if (!hash && !magnet && !sourceUrl) throw new Error('Send to mobile item is missing a hash, magnet, or source URL.');
    return {
      id: typeof input?.id === 'string' && input.id.trim() ? input.id.trim() : `mobile-review-${fnv1a(key)}`,
      itemKey: key,
      sendId,
      status: 'pending',
      title,
      hash,
      infoHash: hash,
      magnet,
      sourceUrl,
      sourceDomain,
      addedAt: timestamp,
      sentAt: timestamp,
      fromDevice: settings.deviceId || 'chrome',
      fromDeviceName: settings.deviceName || 'Chrome'
    };
  }

  function withMobileReviewQueueItem(payload, item, settings, timestamp = Date.now()) {
    const next = normalizePayload(payload, timestamp);
    const reviewItem = normalizeReviewQueueItem(item, settings, timestamp);
    const existingItems = Array.isArray(next.sections?.mobileReviewQueue?.items)
      ? cloneJson(next.sections.mobileReviewQueue.items)
      : [];
    const nextKey = reviewQueueKey(reviewItem);
    let updatedExisting = false;
    const items = existingItems.map(existing => {
      if (!isRecord(existing) || reviewQueueKey(existing) !== nextKey) return existing;
      updatedExisting = true;
      return {
        ...existing,
        ...reviewItem,
        id: typeof existing.id === 'string' && existing.id ? existing.id : reviewItem.id,
        itemKey: nextKey,
        sendId: reviewItem.sendId,
        addedAt: timestamp,
        sentAt: timestamp,
        status: 'pending'
      };
    });
    if (!updatedExisting) items.unshift(reviewItem);
    next.updatedAt = timestamp;
    next.sections = {
      ...next.sections,
      mobileReviewQueue: {
        updatedAt: timestamp,
        items: items.slice(0, 200)
      }
    };
    const deviceId = settings.deviceId || 'chrome';
    next.devices = {
      ...next.devices,
      [deviceId]: {
        name: settings.deviceName || 'Chrome',
        lastSeenAt: timestamp
      }
    };
    return { payload: next, item: reviewItem, deduped: updatedExisting };
  }

  function withMobileReviewQueueItems(payload, items, settings, timestamp = Date.now()) {
    const queued = [];
    let dedupedCount = 0;
    let nextPayload = payload;
    items.forEach((item, index) => {
      const next = withMobileReviewQueueItem(nextPayload, item, settings, timestamp + index);
      nextPayload = next.payload;
      queued.push(next.item);
      if (next.deduped) dedupedCount += 1;
    });
    return { payload: nextPayload, items: queued, dedupedCount };
  }

  async function pushMobileReviewItems(items, options = {}) {
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    if (list.length === 0) throw new Error('Select items first.');
    const settings = await MagnetarSyncStorage.loadSettings();
    if (!isPaired(settings)) {
      throw new Error('Magnetar Sync is not paired.');
    }

    async function attempt() {
      const vault = await MagnetarSyncApi.getVault(settings);
      let payload = null;
      if (vault.envelope) {
        payload = await MagnetarSyncCrypto.decryptJson(vault.envelope, settings.encryptionKey);
      }
      const timestamp = Date.now();
      const next = withMobileReviewQueueItems(payload, list, settings, timestamp);
      const envelope = await MagnetarSyncCrypto.encryptJson(next.payload, settings.encryptionKey);
      const result = await MagnetarSyncApi.putVault({
        serverUrl: settings.serverUrl,
        syncId: settings.syncId,
        syncToken: settings.syncToken,
        baseRevision: vault.revision,
        envelope
      });
      const savedSettings = await MagnetarSyncStorage.saveSettings({
        ...settings,
        lastRevision: result.revision,
        lastSyncAt: timestamp
      });
      return {
        ok: true,
        mode: options.manual ? 'manual' : 'app-review',
        revision: savedSettings.lastRevision,
        lastSyncAt: savedSettings.lastSyncAt,
        count: next.items.length,
        dedupedCount: next.dedupedCount,
        itemIds: next.items.map(item => item.id),
        itemKeys: next.items.map(item => reviewQueueKey(item))
      };
    }

    try {
      return await attempt();
    } catch (error) {
      if (!error?.conflict) throw error;
      return await attempt();
    }
  }

  async function pushMobileReviewItem(item, options = {}) {
    const result = await pushMobileReviewItems([item], options);
    return {
      ...result,
      itemId: result.itemIds?.[0] || '',
      itemKey: result.itemKeys?.[0] || '',
      deduped: result.dedupedCount > 0
    };
  }
  function hostedHistoryKey(item = {}) {
    const aggregate = `${syncItemKey(item)}|${String(item.providerId || item.provider || item.target || '').trim()}`;
    return aggregate;
  }

  function historyRecordTime(item = {}) {
    return Number(item.lastSentAt || item.timestamp || item.createdAt || item.attemptedAt || 0) || 0;
  }

  function historyWinner(base, local, remote) {
    const same = (left, right) => stableStringify(left ?? null) === stableStringify(right ?? null);
    const localValue = local === undefined ? base : local;
    const remoteValue = remote === undefined ? base : remote;
    const preserveSyncMetadata = winner => {
      if (!winner || winner._selfHostedSync) return winner;
      const candidates = [localValue?._selfHostedSync, remoteValue?._selfHostedSync, base?._selfHostedSync].filter(isRecord)
        .sort((left, right) => Number(right.sendCount || 0) - Number(left.sendCount || 0) || (right.eventIds?.length || 0) - (left.eventIds?.length || 0));
      return candidates[0] ? { ...winner, _selfHostedSync: cloneJson(candidates[0]) } : winner;
    };
    const localChanged = !same(localValue, base);
    const remoteChanged = !same(remoteValue, base);
    if (!localChanged) return preserveSyncMetadata(remoteValue);
    if (!remoteChanged) return preserveSyncMetadata(localValue);
    if (same(localValue, remoteValue)) return preserveSyncMetadata(localValue);
    const localTime = historyRecordTime(localValue);
    const remoteTime = historyRecordTime(remoteValue);
    if (localTime !== remoteTime) return preserveSyncMetadata(localTime > remoteTime ? localValue : remoteValue);
    const localCount = Number(localValue?.sendCount || 0);
    const remoteCount = Number(remoteValue?.sendCount || 0);
    if (localCount !== remoteCount) return preserveSyncMetadata(localCount > remoteCount ? localValue : remoteValue);
    return preserveSyncMetadata(stableStringify(localValue) >= stableStringify(remoteValue) ? localValue : remoteValue);
  }

  function historyMap(items) {
    const output = {};
    for (const item of Array.isArray(items) ? items : []) {
      const normalized = normalizeChromeHistoryItem(item);
      const key = hostedHistoryKey(normalized);
      if (!key) continue;
      output[key] = output[key] ? historyWinner(null, output[key], normalized) : normalized;
    }
    return output;
  }

  function mergeHostedHistory(base, local, remote) {
    const baseMap = isRecord(base) ? base : {};
    const localMap = historyMap(local);
    const remoteMap = historyMap(remote);
    const merged = {};
    for (const key of [...new Set([...Object.keys(baseMap), ...Object.keys(localMap), ...Object.keys(remoteMap)])].sort()) {
      const value = historyWinner(baseMap[key], localMap[key], remoteMap[key]);
      if (value) merged[key] = value;
    }
    return {
      map: merged,
      items: Object.entries(merged).sort(([left], [right]) => left.localeCompare(right)).map(([, item]) => cloneJson(item))
    };
  }

  async function loadHostedCheckpoint() {
    const data = await MAGNETAR_API.storage.local.get([HOSTED_CHECKPOINT_KEY]);
    const checkpoint = data[HOSTED_CHECKPOINT_KEY];
    return isRecord(checkpoint) && Number(checkpoint.schemaVersion || 0) === 1 && isRecord(checkpoint.canonical)
      ? checkpoint
      : null;
  }

  async function loadCanonicalLocalState() {
    const data = await MAGNETAR_API.storage.local.get([SAVED_KEY, HISTORY_KEY, ORGANISED_FOLDERS_KEY]);
    return {
      saved: Array.isArray(data[SAVED_KEY]) ? cloneJson(data[SAVED_KEY]) : [],
      history: Array.isArray(data[HISTORY_KEY]) ? cloneJson(data[HISTORY_KEY]) : [],
      folders: normalizeOrganisedFoldersSection(data[ORGANISED_FOLDERS_KEY]) || { schema: 'magnetar-folders-v1', updatedAt: 0, sourceDevice: '', deletedFolders: [], folders: [] }
    };
  }

  function hostedRemoteState(payload) {
    return {
      saved: (Array.isArray(payload?.sections?.saved?.items) ? payload.sections.saved.items : []).map(normalizeChromeSavedItem),
      savedTombstones: (Array.isArray(payload?.sections?.saved?.tombstones) ? payload.sections.saved.tombstones : []).map(item => ({ stableKey: String(item?.stableKey || item?.itemKey || ''), deletedAt: Number(item?.deletedAt || 0) })).filter(item => item.stableKey && item.deletedAt > 0),
      history: (Array.isArray(payload?.sections?.history?.items) ? payload.sections.history.items : []).map(normalizeChromeHistoryItem),
      folders: normalizeOrganisedFoldersSection(payload?.sections?.organisedFolders) || { schema: 'magnetar-folders-v1', updatedAt: 0, sourceDevice: '', deletedFolders: [], folders: [] }
    };
  }

  function canonicaliseHostedRemote(remote, baseline, timestamp) {
    const canonical = MagnetarSelfHostedSync.canonicaliseReplica(remote, baseline || {}, timestamp, false);
    for (const entity of ['saved', 'folders', 'assignments']) {
      for (const [key, record] of Object.entries(baseline?.[entity] || {})) {
        if (record?.deleted && !canonical[entity]?.[key]) canonical[entity][key] = cloneJson(record);
      }
    }
    return canonical;
  }

  function withCanonicalHostedState(payload, canonicalLocal, settings, timestamp, canonical = null) {
    const next = normalizePayload(payload, timestamp);
    next.updatedAt = timestamp;
    next.sections = {
      ...next.sections,
      saved: { ...(isRecord(next.sections?.saved) ? next.sections.saved : {}), updatedAt: timestamp, items: cloneJson(canonicalLocal.saved), tombstones: Object.values(canonical?.saved || {}).filter(item => item?.deleted && item?.stableKey).map(item => ({ stableKey: item.stableKey, deletedAt: Number(item.deletedAt || timestamp) })).sort((left, right) => left.stableKey.localeCompare(right.stableKey)) },
      history: { ...(isRecord(next.sections?.history) ? next.sections.history : {}), updatedAt: timestamp, items: cloneJson(canonicalLocal.history) },
      organisedFolders: { ...cloneJson(canonicalLocal.folders), updatedAt: Number(canonicalLocal.folders?.updatedAt || timestamp), sourceDevice: settings.deviceId || canonicalLocal.folders?.sourceDevice || 'chrome' }
    };
    const deviceId = settings.deviceId || 'chrome';
    next.devices = { ...next.devices, [deviceId]: { name: settings.deviceName || 'Chrome', lastSeenAt: timestamp } };
    return next;
  }

  function canonicalRecordSemantic(record) {
    if (!isRecord(record)) return record ?? null;
    const next = cloneJson(record);
    delete next.updatedAt;
    delete next.deletedAt;
    delete next.sourceDevice;
    return next;
  }

  function canonicalDifferenceCount(left, right) {
    let count = 0;
    for (const section of ['saved', 'folders', 'assignments']) {
      const leftMap = left?.[section] || {};
      const rightMap = right?.[section] || {};
      for (const key of new Set([...Object.keys(leftMap), ...Object.keys(rightMap)])) {
        if (stableStringify(canonicalRecordSemantic(leftMap[key])) !== stableStringify(canonicalRecordSemantic(rightMap[key]))) count += 1;
      }
    }
    return count;
  }

  async function inspectHostedReplica() {
    const settings = await MagnetarSyncStorage.loadSettings();
    if (!isPaired(settings)) throw new Error('Magnetar Sync is not paired.');
    const vault = await MagnetarSyncApi.getVault(settings);
    const payload = vault.envelope
      ? await MagnetarSyncCrypto.decryptJson(vault.envelope, settings.encryptionKey)
      : MagnetarSyncContract.createPayloadSkeleton(Date.now());
    return {
      settings,
      revision: Number(vault.revision || 0),
      state: hostedRemoteState(payload),
      counts: {
        saved: Array.isArray(payload?.sections?.saved?.items) ? payload.sections.saved.items.length : 0,
        history: Array.isArray(payload?.sections?.history?.items) ? payload.sections.history.items.length : 0,
        folders: Array.isArray(payload?.sections?.organisedFolders?.folders) ? payload.sections.organisedFolders.folders.length : 0
      }
    };
  }

  async function executeHostedCanonicalSync(options = {}) {
    const syncRunId = String(options.cycleId || `hosted-${Date.now().toString(36)}`);
    globalThis.MagnetarSyncDiagnostics?.lifecycle?.('mobile-sync-request', { syncRunId, trigger: options.reason || (options.manual ? 'manual' : 'automatic'), operation: options.pull ? 'pull' : 'reconcile' });
    const settings = await MagnetarSyncStorage.loadSettings();
    if (!isPaired(settings)) throw new Error('Magnetar Sync is not paired.');
    if (!globalThis.MagnetarSelfHostedSync?.reconcileReplica || !globalThis.MagnetarSelfHostedSync?.canonicaliseReplica) {
      throw new Error('Canonical sync engine is unavailable.');
    }
    const checkpoint = await loadHostedCheckpoint();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const vault = await MagnetarSyncApi.getVault(settings);
      const payload = vault.envelope
        ? await MagnetarSyncCrypto.decryptJson(vault.envelope, settings.encryptionKey)
        : MagnetarSyncContract.createPayloadSkeleton(Date.now());
      const timestamp = Date.now();
      const local = await loadCanonicalLocalState();
      const remote = hostedRemoteState(payload);
      const reconciled = MagnetarSelfHostedSync.reconcileReplica({ local, remote, checkpoint, now: timestamp, inferRemoteDeletes: false });
      const mergedHistory = mergeHostedHistory(checkpoint?.history, local.history, remote.history);
      if (Number.isFinite(options.expectedRevision) && Number(vault.revision || 0) !== Number(options.expectedRevision)) {
        throw Object.assign(new Error('Mobile sync changed during the coordinated sync. Canonical extension state was preserved; run Sync again.'), { code: 'HOSTED_CHANGED_DURING_COORDINATED_SYNC' });
      }
      const canonicalTarget = isRecord(options.canonical) ? cloneJson(options.canonical) : reconciled.canonical;
      const target = options.canonical ? MagnetarSelfHostedSync.projectCanonical(canonicalTarget, mergedHistory.items) : { ...reconciled.local, history: mergedHistory.items };
      const remoteCanonical = canonicaliseHostedRemote(remote, checkpoint?.canonical || {}, timestamp);
      const semanticChanges = canonicalDifferenceCount(canonicalTarget, remoteCanonical)
        + (stableStringify(mergedHistory.map) === stableStringify(historyMap(remote.history)) ? 0 : 1);
      const transportRepairChanges = Number(target.folders?.updatedAt || 0) > Number(remote.folders?.updatedAt || 0) ? 1 : 0;
      const localCanonical = MagnetarSelfHostedSync.canonicaliseReplica(local, checkpoint?.canonical || {}, timestamp);
      const localChanges = canonicalDifferenceCount(canonicalTarget, localCanonical)
        + (stableStringify(mergedHistory.map) === stableStringify(historyMap(local.history)) ? 0 : 1);
      const mobileAcknowledgement = extractMobileAcknowledgement(payload);
      const storageUpdate = {
        [SAVED_KEY]: target.saved,
        [HISTORY_KEY]: target.history,
        [ORGANISED_FOLDERS_KEY]: target.folders
      };
      if (mobileAcknowledgement) storageUpdate[MOBILE_ACK_KEY] = mobileAcknowledgement;
      if (localChanges > 0) {
        const writer = globalThis.MagnetarSyncDiagnostics?.write;
        if (writer) await writer(MAGNETAR_API.storage.local, storageUpdate, {
          syncRunId, caller: 'executeHostedCanonicalSync', trigger: options.reason || (options.manual ? 'manual-mobile-sync' : 'automatic-mobile-sync'),
          adapter: 'hosted-mobile', checkpoint: checkpoint?.revision ?? null, cursor: Number(vault.revision || 0), operation: 'record-merge',
          acceptedBecause: 'hosted-three-way-reconciliation'
        }); else await MAGNETAR_API.storage.local.set(storageUpdate);
      } else if (mobileAcknowledgement) await MAGNETAR_API.storage.local.set({ [MOBILE_ACK_KEY]: mobileAcknowledgement });
      if (!mobileAcknowledgement) await MAGNETAR_API.storage.local.remove([MOBILE_ACK_KEY]);

      let revision = Number(vault.revision || 0);
      if (semanticChanges > 0 || transportRepairChanges > 0 || !vault.envelope) {
        const outgoingPayload = withCanonicalHostedState(payload, target, settings, timestamp, canonicalTarget);
        const envelope = await MagnetarSyncCrypto.encryptJson(outgoingPayload, settings.encryptionKey);
        try {
          const result = await MagnetarSyncApi.putVault({
            serverUrl: settings.serverUrl,
            syncId: settings.syncId,
            syncToken: settings.syncToken,
            baseRevision: vault.revision,
            envelope
          });
          revision = Number(result.revision || revision);
        } catch (error) {
          if (error?.conflict && attempt < 2) continue;
          throw error;
        }
      }

      const persisted = await loadCanonicalLocalState();
      const persistedCanonical = MagnetarSelfHostedSync.canonicaliseReplica(persisted, canonicalTarget, timestamp);
      if (canonicalDifferenceCount(canonicalTarget, persistedCanonical) > 0) {
        throw new Error('Canonical extension state changed before hosted sync could be verified.');
      }
      const nextCheckpoint = { schemaVersion: 1, revision, canonical: canonicalTarget, history: mergedHistory.map, savedAt: timestamp };
      const fingerprint = computeSavedHistoryFingerprint({ ...persisted, organisedFolders: persisted.folders });
      await MAGNETAR_API.storage.local.set({ [HOSTED_CHECKPOINT_KEY]: nextCheckpoint });
      const savedSettings = await MagnetarSyncStorage.saveSettings({ ...settings, lastRevision: revision, lastSyncAt: timestamp });
      await saveAutoStatus({
        lastResult: 'success', lastError: '', lastPushedSavedHistoryFingerprint: fingerprint,
        lastSeenSavedHistoryFingerprint: fingerprint, lastSuccessAt: timestamp,
        lastRevision: revision, lastSyncAt: timestamp,
        savedCount: persisted.saved.length, historyCount: persisted.history.length,
        organisedFolderCount: persisted.folders.folders.length
      });
      return {
        ok: true,
        mode: options.manual ? 'manual' : 'auto',
        revision: savedSettings.lastRevision,
        lastSyncAt: savedSettings.lastSyncAt,
        savedCount: persisted.saved.length,
        historyCount: persisted.history.length,
        organisedFolderCount: persisted.folders.folders.length,
        mutationCount: semanticChanges,
        changed: semanticChanges > 0 || transportRepairChanges > 0,
        fingerprint
      };
    }
    throw new Error('Hosted Magnetar Sync kept changing during synchronisation. Try again.');
  }

  async function synchroniseHostedCanonical(options = {}) {
    if (hostedSyncInFlight) return hostedSyncInFlight;
    hostedSyncInFlight = executeHostedCanonicalSync(options).finally(() => { hostedSyncInFlight = null; });
    return hostedSyncInFlight;
  }

  async function pushSavedAndHistory(options = {}) {
    return synchroniseHostedCanonical(options);
  }

  async function pullSavedAndHistory(options = {}) {
    return synchroniseHostedCanonical({ ...options, pull: true });
  }

  async function maybePullLatest(reason = 'interaction', options = {}) {
    globalThis.MagnetarSyncDiagnostics?.lifecycle?.('auto-pull-fired', { adapter: 'hosted-mobile', trigger: reason, force: options.force === true });
    if (autoPullInFlight) return { ok: false, skipped: true, reason: 'pull-in-flight' };
    const settings = await MagnetarSyncStorage.loadSettings();
    if (!isPaired(settings)) {
      await saveAutoStatus({ lastAutoPullResult: 'skipped', lastAutoPullReason: reason, lastAutoPullSkipReason: 'not-paired' });
      return { ok: false, skipped: true, reason: 'not-paired' };
    }

    const status = await loadAutoStatus();
    const now = Date.now();
    const lastFailureAt = typeof status.lastAutoPullFailureAt === 'number' ? status.lastAutoPullFailureAt : 0;
    if (!options.force && lastFailureAt && now - lastFailureAt < AUTO_PULL_FAILURE_BACKOFF_MS) {
      await saveAutoStatus({ lastAutoPullResult: 'waiting', lastAutoPullReason: reason, lastAutoPullSkipReason: 'failure-backoff' });
      return { ok: false, skipped: true, reason: 'failure-backoff' };
    }

    const lastPullAt = typeof status.lastAutoPullAt === 'number' ? status.lastAutoPullAt : 0;
    if (!options.force && lastPullAt && now - lastPullAt < AUTO_PULL_MIN_INTERVAL_MS) {
      await saveAutoStatus({ lastAutoPullResult: 'waiting', lastAutoPullReason: reason, lastAutoPullSkipReason: 'min-interval' });
      return { ok: false, skipped: true, reason: 'min-interval' };
    }

    autoPullInFlight = true;
    await saveAutoStatus({ lastAutoPullResult: 'running', lastAutoPullReason: reason, lastAutoPullSkipReason: '', lastAutoPullStartedAt: now });
    try {
      const result = await pullSavedAndHistory({ manual: false, reason });
      await saveAutoStatus({
        lastAutoPullResult: 'success',
        lastAutoPullReason: reason,
        lastAutoPullSkipReason: '',
        lastAutoPullError: '',
        lastAutoPullAt: result.lastSyncAt || Date.now(),
        lastAutoPullFailureAt: 0,
        lastAutoPullRevision: result.revision || 0
      });
      return { ...result, autoPull: true };
    } catch (error) {
      await saveAutoStatus({
        lastAutoPullResult: 'failed',
        lastAutoPullReason: reason,
        lastAutoPullError: error?.message || 'Auto pull failed.',
        lastAutoPullFailureAt: Date.now()
      });
      return { ok: false, error: error?.message || 'Auto pull failed.' };
    } finally {
      autoPullInFlight = false;
    }
  }
  async function maybeAutoPush(reason = 'dirty-check', options = {}) {
    globalThis.MagnetarSyncDiagnostics?.lifecycle?.('dirty-check-fired', { adapter: 'hosted-mobile', trigger: reason, force: options.force === true });
    if (autoPushInFlight) return { ok: false, skipped: true, reason: 'in-flight' };
    const settings = await MagnetarSyncStorage.loadSettings();
    if (!isPaired(settings)) return { ok: false, skipped: true, reason: 'not-paired' };

    const local = await loadLocalSavedAndHistory();
    local.organisedFolders = await loadLocalOrganisedFolders();
    const fingerprint = computeSavedHistoryFingerprint(local);
    const status = await loadAutoStatus();
    const now = Date.now();

    if (fingerprint === status.lastPushedSavedHistoryFingerprint) {
      await saveAutoStatus({
        lastResult: 'idle',
        lastError: '',
        lastSeenSavedHistoryFingerprint: fingerprint,
        lastReason: reason
      });
      return { ok: true, skipped: true, reason: 'unchanged', fingerprint };
    }

    const lastFailureAt = typeof status.lastFailureAt === 'number' ? status.lastFailureAt : 0;
    if (!options.force && lastFailureAt && now - lastFailureAt < AUTO_FAILURE_BACKOFF_MS) {
      await saveAutoStatus({
        lastResult: 'waiting',
        lastReason: reason,
        lastSeenSavedHistoryFingerprint: fingerprint
      });
      return { ok: false, skipped: true, reason: 'failure-backoff', fingerprint };
    }

    const lastSuccessAt = typeof status.lastSuccessfulAutoPushAt === 'number' ? status.lastSuccessfulAutoPushAt : 0;
    if (!options.force && lastSuccessAt && now - lastSuccessAt < AUTO_MIN_INTERVAL_MS) {
      await saveAutoStatus({
        lastResult: 'waiting',
        lastReason: reason,
        lastSeenSavedHistoryFingerprint: fingerprint
      });
      return { ok: false, skipped: true, reason: 'min-interval', fingerprint };
    }

    autoPushInFlight = true;
    await saveAutoStatus({
      lastResult: 'running',
      lastError: '',
      lastReason: reason,
      lastSeenSavedHistoryFingerprint: fingerprint
    });
    try {
      return await pushSavedAndHistory({ manual: false, fingerprint });
    } catch (error) {
      await saveAutoStatus({
        lastResult: 'failed',
        lastError: error?.message || 'Auto sync failed.',
        lastAutoPushError: error?.message || 'Auto sync failed.',
        lastFailureAt: Date.now(),
        lastReason: reason,
        lastSeenSavedHistoryFingerprint: fingerprint
      });
      return { ok: false, error: error?.message || 'Auto sync failed.' };
    } finally {
      autoPushInFlight = false;
    }
  }

  function scheduleAutoPush(reason = 'storage-change') {
    if (autoPushTimer) clearTimeout(autoPushTimer);
    autoPushTimer = setTimeout(() => {
      autoPushTimer = null;
      globalThis.MagnetarSyncDiagnostics?.lifecycle?.('auto-push-fired', { adapter: 'hosted-mobile', trigger: reason });
      canonicalRunner(() => maybeAutoPush(reason)).catch(() => {});
    }, AUTO_DEBOUNCE_MS);
    saveAutoStatus({ lastResult: 'pending', lastReason: reason }).catch(() => {});
  }

  MagnetarSyncData = {
    loadLocalSavedAndHistory,
    loadMobileAcknowledgement,
    computeSavedHistoryFingerprint,
    loadAutoStatus,
    pushSavedAndHistory,
    pullSavedAndHistory,
    synchroniseHostedCanonical,
    inspectHostedReplica,
    pushMobileReviewItem,
    pushMobileReviewItems,
    maybePullLatest,
    maybeAutoPush,
    scheduleAutoPush,
    setCanonicalRunner(runner) {
      canonicalRunner = typeof runner === 'function' ? runner : operation => operation();
    }
  };

  globalThis.MagnetarSyncData = MagnetarSyncData;
})();
