/** Deterministic reconciliation for the independent My Magnetar sync API. */
var MagnetarSelfHostedSync;
(function () {
  function isRecord(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function clone(value) { return JSON.parse(JSON.stringify(value == null ? null : value)); }
  function time(value, fallback = 0) {
    const parsed = typeof value === 'number' ? value : Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  }
  function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
  }
  function fnv1a(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; }
    return hash.toString(16).padStart(8, '0');
  }
  function stableKey(item = {}) {
    const explicit = String(item.stableKey || item.itemKey || '').trim();
    if (explicit) return explicit;
    const hash = String(item.hash || item.infoHash || '').trim().toLowerCase();
    if (hash) return `hash:${hash}`;
    const magnet = String(item.magnet || item.magnetUri || '').trim();
    if (magnet) return `magnet:${magnet}`;
    const sourceUrl = String(item.sourceUrl || item.url || '').trim();
    return sourceUrl ? `url:${sourceUrl}` : '';
  }
  function safeUrl(value) {
    const candidate = String(value || '').trim();
    if (!candidate) return '';
    try { const parsed = new URL(candidate); return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? candidate : ''; } catch { return ''; }
  }
  function semantic(record) {
    if (!record) return null;
    const next = clone(record);
    delete next.updatedAt; delete next.deletedAt; delete next.sourceDevice;
    return next;
  }
  function same(left, right) { return stableStringify(left) === stableStringify(right); }
  function recordTime(record) { return Number(record?.deletedAt || record?.updatedAt || 0); }
  function winner(base, local, remote) {
    const localChanged = !same(local, base);
    const remoteChanged = !same(remote, base);
    if (!localChanged) return remote;
    if (!remoteChanged) return local;
    if (same(local, remote)) return local;
    const localTime = recordTime(local); const remoteTime = recordTime(remote);
    if (localTime !== remoteTime) return localTime > remoteTime ? local : remote;
    if (Boolean(local?.deleted) !== Boolean(remote?.deleted)) return local?.deleted ? local : remote;
    return stableStringify(local) >= stableStringify(remote) ? local : remote;
  }
  function winnerMany(base, candidates) {
    const changed = (candidates || []).filter(candidate => candidate && !same(candidate, base));
    if (!changed.length) return base;
    const distinct = [...new Map(changed.map(candidate => [stableStringify(candidate), candidate])).values()];
    return distinct.sort((left, right) => recordTime(left) - recordTime(right) || Number(Boolean(left?.deleted)) - Number(Boolean(right?.deleted)) || stableStringify(left).localeCompare(stableStringify(right))).at(-1);
  }
  function mapBy(records, key) {
    const output = {};
    for (const record of records || []) { const id = key(record); if (id) output[id] = record; }
    return output;
  }
  function normaliseServer(snapshot = {}) {
    const saved = mapBy((snapshot.saved || []).map(item => ({ stableKey: stableKey(item), displayName: item.displayName || 'Saved item', hash: item.hash || '', magnet: item.magnet || '', sourceUrl: item.sourceUrl || '', updatedAt: time(item.updatedAt || item.savedAt) })), item => item.stableKey);
    for (const item of snapshot.tombstones?.saved || []) saved[item.stableKey] = { stableKey: item.stableKey, deleted: true, deletedAt: time(item.deletedAt) };
    const folders = mapBy((snapshot.folders || []).map(folder => ({ id: String(folder.id), name: String(folder.name || 'Folder'), color: String(folder.color || 'default'), order: Number(folder.sortOrder ?? folder.order ?? 0), updatedAt: time(folder.updatedAt) })), folder => folder.id);
    for (const item of snapshot.tombstones?.folders || []) folders[item.id] = { id: String(item.id), deleted: true, deletedAt: time(item.deletedAt) };
    const assignments = {};
    for (const folder of snapshot.folders || []) for (const [index, item] of (folder.items || []).entries()) {
      const key = stableKey(item); if (!key) continue;
      assignments[`${folder.id}|${key}`] = { folderId: String(folder.id), stableKey: key, displayName: item.displayName || 'Client item', hash: item.hash || '', magnet: item.magnet || '', sourceUrl: item.sourceUrl || '', order: Number(item.sortOrder ?? item.order ?? index), updatedAt: time(item.updatedAt) };
    }
    for (const item of snapshot.tombstones?.assignments || []) assignments[`${item.folderId}|${item.stableKey}`] = { folderId: String(item.folderId), stableKey: item.stableKey, deleted: true, deletedAt: time(item.deletedAt) };
    const historyEventIds = (snapshot.historyEvents || []).map(item => String(item.clientEventId || item.eventId || '')).filter(Boolean).sort();
    return { saved, folders, assignments, historyEventIds };
  }
  function localState(data = {}, baseline = {}, now = Date.now(), inferDeletes = true) {
    const saved = mapBy((data.saved || []).map(item => ({ stableKey: stableKey(item), displayName: item.name || item.displayName || 'Saved item', hash: item.hash || '', magnet: item.magnet || item.magnetUri || '', sourceUrl: safeUrl(item.sourceUrl || item.url), updatedAt: time(item.updatedAt || item.savedAt || item.createdAt, 0) })), item => item.stableKey);
    for (const item of data.savedTombstones || []) if (stableKey(item)) saved[stableKey(item)] = { stableKey: stableKey(item), deleted: true, deletedAt: time(item.deletedAt, now) };
    if (inferDeletes) for (const [key, previous] of Object.entries(baseline.saved || {})) if (!saved[key]) saved[key] = previous.deleted ? clone(previous) : { stableKey: key, deleted: true, deletedAt: now };
    const folderState = data.folders || {};
    const folders = mapBy((folderState.folders || []).map(folder => ({ id: String(folder.id), name: String(folder.name || 'Folder'), color: String(folder.color || 'default'), order: Number(folder.order || 0), updatedAt: time(folder.updatedAt || folder.createdAt, 0) })), folder => folder.id);
    for (const item of folderState.deletedFolders || []) folders[item.id] = { id: String(item.id), deleted: true, deletedAt: time(item.deletedAt, now) };
    if (inferDeletes) for (const [key, previous] of Object.entries(baseline.folders || {})) if (!folders[key]) folders[key] = previous.deleted ? clone(previous) : { id: key, deleted: true, deletedAt: now };
    const assignments = {};
    for (const folder of folderState.folders || []) for (const [index, item] of (folder.items || []).entries()) {
      const key = stableKey(item); if (!key) continue;
      assignments[`${folder.id}|${key}`] = { folderId: String(folder.id), stableKey: key, displayName: item.displayName || item.name || item.title || 'Client item', hash: item.hash || '', magnet: item.magnet || item.magnetUri || '', sourceUrl: safeUrl(item.sourceUrl || item.url), order: Number(item.order ?? index), updatedAt: time(item.updatedAt || item.addedAt, time(folder.updatedAt || folder.createdAt, 0)) };
    }
    if (inferDeletes) for (const [key, previous] of Object.entries(baseline.assignments || {})) if (!assignments[key]) assignments[key] = previous.deleted ? clone(previous) : { folderId: previous.folderId, stableKey: previous.stableKey, deleted: true, deletedAt: now };
    for (const collection of [saved, folders, assignments]) for (const [key, record] of Object.entries(collection)) {
      const previous = baseline[collection === saved ? 'saved' : collection === folders ? 'folders' : 'assignments']?.[key];
      if (previous && !record.deleted && same(semantic(record), semantic(previous)) && !record.updatedAt) record.updatedAt = recordTime(previous);
      if (!record.deleted && !record.updatedAt && (!previous || !same(semantic(record), semantic(previous)))) record.updatedAt = now;
      if (previous && !record.deleted && !same(semantic(record), semantic(previous)) && record.updatedAt <= recordTime(previous)) record.updatedAt = now;
    }
    return { saved, folders, assignments };
  }
  function mergeMaps(base, local, remote) {
    const merged = {};
    const keys = [...new Set([...Object.keys(base || {}), ...Object.keys(local || {}), ...Object.keys(remote || {})])].sort();
    for (const key of keys) {
      const baseline = base?.[key] || null;
      const value = winner(baseline, local?.[key] ?? baseline, remote?.[key] ?? baseline);
      if (value) merged[key] = value;
    }
    return merged;
  }
  function folderNameKey(value) { return String(value || '').trim().toLocaleLowerCase('en-US'); }
  function folderConflict(source, name, ids) {
    const error = new Error(`Sync could not reconcile multiple Organised folders named '${name}'. No changes were applied.`);
    error.code = 'SYNC_FOLDER_NAME_CONFLICT';
    error.conflict = { source, mutationType: 'folder.upsert', recordId: ids[0] || '', conflictingRecordId: ids[1] || '', conflictingName: name };
    return error;
  }
  function duplicateActiveFolder(map, source) {
    const names = new Map();
    for (const folder of Object.values(map || {})) {
      if (folder.deleted) continue;
      const key = folderNameKey(folder.name); if (!key) continue;
      const ids = names.get(key) || []; ids.push(folder.id); names.set(key, ids);
    }
    for (const ids of names.values()) if (ids.length > 1) {
      const sorted = [...ids].sort();
      throw folderConflict(source, map[sorted[0]]?.name || map[sorted[1]]?.name || 'Folder', sorted);
    }
  }
  function remapFolderMap(map, aliases) {
    const output = {};
    for (const [id, folder] of Object.entries(map || {})) {
      const targetId = folder.deleted ? id : aliases[id] || id;
      const next = targetId === id ? folder : { ...folder, id: targetId };
      output[targetId] = output[targetId] ? winner(null, output[targetId], next) : next;
    }
    return output;
  }
  function remapAssignmentMap(map, aliases) {
    const output = {};
    for (const assignment of Object.values(map || {})) {
      const folderId = aliases[assignment.folderId] || assignment.folderId;
      const next = folderId === assignment.folderId ? assignment : { ...assignment, folderId };
      const key = `${folderId}|${assignment.stableKey}`;
      output[key] = output[key] ? winner(null, output[key], next) : next;
    }
    return output;
  }
  function mergeAssignmentMaps(base, local, remote, aliasedFolderIds) {
    const merged = {};
    const keys = [...new Set([...Object.keys(base || {}), ...Object.keys(local || {}), ...Object.keys(remote || {})])].sort();
    for (const key of keys) {
      const values = [base?.[key], local?.[key], remote?.[key]].filter(Boolean);
      const folderId = values[0]?.folderId;
      let value;
      if (aliasedFolderIds.has(folderId) && values.some(item => !item.deleted) && !values.some(item => item.deleted)) {
        value = [...values].sort((left, right) => recordTime(left) - recordTime(right) || stableStringify(left).localeCompare(stableStringify(right))).at(-1);
      } else {
        const baseline = base?.[key] || null;
        value = winner(baseline, local?.[key] ?? baseline, remote?.[key] ?? baseline);
      }
      if (value) merged[key] = value;
    }
    return merged;
  }
  function collapseLegacyHashAssignmentAliases(assignments, now) {
    const activeSpecificByFolderHash = new Set();
    for (const assignment of Object.values(assignments || {})) {
      if (assignment.deleted) continue;
      const hash = String(assignment.hash || '').trim().toLowerCase();
      if (!hash || assignment.stableKey === `hash:${hash}`) continue;
      activeSpecificByFolderHash.add(`${assignment.folderId}|${hash}`);
    }
    for (const [key, assignment] of Object.entries(assignments || {})) {
      if (assignment.deleted) continue;
      const hash = String(assignment.hash || '').trim().toLowerCase();
      if (!hash || assignment.stableKey !== `hash:${hash}` || !activeSpecificByFolderHash.has(`${assignment.folderId}|${hash}`)) continue;
      assignments[key] = { folderId: assignment.folderId, stableKey: assignment.stableKey, deleted: true, deletedAt: now };
    }
    return assignments;
  }
  function collapseFolderNameAliases(folders, assignments, preferredFolders, now) {
    const groups = new Map();
    for (const folder of Object.values(folders || {})) {
      if (folder.deleted) continue;
      const name = folderNameKey(folder.name); if (!name) continue;
      const group = groups.get(name) || []; group.push(folder); groups.set(name, group);
    }
    const aliases = {};
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const ids = group.map(folder => folder.id).sort();
      const preferred = ids.filter(id => preferredFolders?.[id] && !preferredFolders[id].deleted);
      const targetId = preferred[0] || ids[0];
      const latest = [...group].sort((left, right) => recordTime(left) - recordTime(right) || stableStringify(left).localeCompare(stableStringify(right))).at(-1);
      folders[targetId] = { ...latest, id: targetId };
      for (const id of ids) if (id !== targetId) {
        aliases[id] = targetId;
        folders[id] = { id, deleted: true, deletedAt: now };
      }
    }
    return { folders, assignments: remapAssignmentMap(assignments, aliases) };
  }
  function reconcileFolderIdentities(baseFolders, localFolders, remoteFolders, baseAssignments, localAssignments, remoteAssignments, now, preferLocalIdentity = false) {
    duplicateActiveFolder(localFolders, 'local');
    duplicateActiveFolder(remoteFolders, 'server');
    const groups = new Map();
    for (const [source, folders] of [['checkpoint', baseFolders], ['local', localFolders], ['server', remoteFolders]]) for (const folder of Object.values(folders || {})) {
      if (folder.deleted) continue;
      const name = folderNameKey(folder.name); if (!name) continue;
      const group = groups.get(name) || { name: folder.name, checkpoint: [], local: [], server: [] };
      if (!group[source].includes(folder.id)) group[source].push(folder.id);
      groups.set(name, group);
    }
    const aliases = {};
    const retireRemoteIds = new Set();
    const aliasedFolderIds = new Set();
    for (const group of groups.values()) {
      const ids = [...new Set([...group.checkpoint, ...group.local, ...group.server])].sort();
      if (ids.length < 2) continue;
      const checkpointIds = group.checkpoint.filter(id => ids.includes(id)).sort();
      const serverIds = group.server.filter(id => ids.includes(id)).sort();
      const localIds = group.local.filter(id => ids.includes(id)).sort();
      const winnerId = (preferLocalIdentity ? localIds[0] : "") || checkpointIds[0] || serverIds[0] || localIds[0] || ids[0];
      aliasedFolderIds.add(winnerId);
      for (const id of ids) if (id !== winnerId) {
        aliases[id] = winnerId;
        if (serverIds.includes(id)) retireRemoteIds.add(id);
      }
    }
    const folders = {
      base: remapFolderMap(baseFolders, aliases),
      local: remapFolderMap(localFolders, aliases),
      remote: remapFolderMap(remoteFolders, aliases),
    };
    const assignments = {
      base: remapAssignmentMap(baseAssignments, aliases),
      local: remapAssignmentMap(localAssignments, aliases),
      remote: remapAssignmentMap(remoteAssignments, aliases),
    };
    const mergedFolders = mergeMaps(folders.base, folders.local, folders.remote);
    for (const id of [...retireRemoteIds].sort()) mergedFolders[id] = { id, deleted: true, deletedAt: now };
    return { aliases, aliasedFolderIds, folders, assignments, mergedFolders };
  }
  function historyPayload(item = {}) {
    return { stableKey: stableKey(item), displayName: item.name || item.displayName || 'Sent item', hash: item.hash || '', magnet: item.magnet || item.magnetUri || '', sourceUrl: safeUrl(item.sourceUrl || item.url), provider: item.provider || 'extension', destinationName: item.destinationName || item.provider || 'Extension provider', status: item.status === 'failed' ? 'failed' : 'succeeded', errorSummary: item.errorSummary || '', attemptedAt: time(item.lastSentAt || item.timestamp || item.attemptedAt || item.createdAt), sendCount: Number(item.sendCount || 1) };
  }
  function historyFingerprint(item = {}) { return fnv1a(stableStringify(historyPayload(item))); }
  function historyEvent(item = {}) {
    const payload = historyPayload(item);
    const imported = isRecord(item._selfHostedSync) ? item._selfHostedSync : null;
    if (imported?.fingerprint && imported.fingerprint === historyFingerprint(item)) return null;
    const sendCount = imported ? Math.max(1, payload.sendCount - Number(imported.sendCount || 0)) : payload.sendCount;
    const identity = stableStringify({ id: item.id || '', ...payload, sendCount, representedEventIds: [...(imported?.eventIds || [])].sort() });
    return { eventId: String(item.syncEventId || item.id || `event-${fnv1a(identity)}`), ...payload, sendCount };
  }
  function mutationsFor(remote, merged, localHistory, knownHistoryIds) {
    const mutations = [];
    for (const [collection, upsert, remove] of [['saved','saved.upsert','saved.delete']]) {
      for (const key of Object.keys(merged[collection]).sort()) {
        const next = merged[collection][key]; if (same(semantic(next), semantic(remote[collection]?.[key]))) continue;
        if (next.deleted) mutations.push(collection === 'saved' ? { type: remove, stableKey: next.stableKey, deletedAt: next.deletedAt } : collection === 'folders' ? { type: remove, id: next.id, deletedAt: next.deletedAt } : { type: remove, folderId: next.folderId, stableKey: next.stableKey, deletedAt: next.deletedAt });
        else mutations.push({ type: upsert, record: clone(next) });
      }
    }
    for (const deleted of [true, false]) for (const key of Object.keys(merged.folders).sort()) {
      const next = merged.folders[key]; if (Boolean(next.deleted) !== deleted || same(semantic(next), semantic(remote.folders?.[key]))) continue;
      mutations.push(next.deleted ? { type: 'folder.delete', id: next.id, deletedAt: next.deletedAt } : { type: 'folder.upsert', record: clone(next) });
    }
    for (const deleted of [true, false]) for (const key of Object.keys(merged.assignments).sort()) {
      const next = merged.assignments[key]; if (Boolean(next.deleted) !== deleted || same(semantic(next), semantic(remote.assignments?.[key]))) continue;
      mutations.push(next.deleted ? { type: 'assignment.delete', folderId: next.folderId, stableKey: next.stableKey, deletedAt: next.deletedAt } : { type: 'assignment.upsert', record: clone(next) });
    }
    const known = new Set(knownHistoryIds || []);
    for (const item of localHistory || []) { const record = historyEvent(item); if (!record || known.has(record.eventId)) continue; mutations.push({ type: 'history.append', record }); known.add(record.eventId); }
    return { mutations, historyEventIds: [...known].sort() };
  }
  function localProjection(merged, remoteSnapshot, currentHistory) {
    const saved = Object.values(merged.saved).filter(item => !item.deleted).sort((a,b) => b.updatedAt-a.updatedAt || a.stableKey.localeCompare(b.stableKey)).map(item => ({ name: item.displayName, hash: item.hash, magnet: item.magnet, sourceUrl: item.sourceUrl, savedAt: item.updatedAt, updatedAt: item.updatedAt, stableKey: item.stableKey }));
    const activeFolders = Object.values(merged.folders).filter(item => !item.deleted).sort((a,b) => a.order-b.order || a.id.localeCompare(b.id));
    const folders = activeFolders.map(folder => ({ id: folder.id, name: folder.name, color: folder.color, order: folder.order, updatedAt: folder.updatedAt, items: Object.values(merged.assignments).filter(item => !item.deleted && item.folderId === folder.id).sort((a,b) => a.order-b.order || a.stableKey.localeCompare(b.stableKey)) }));
    const deletedFolders = Object.values(merged.folders).filter(item => item.deleted).map(item => ({ id: item.id, deletedAt: item.deletedAt, sourceDevice: 'sync' }));
    const historyByKey = new Map();
    for (const item of currentHistory || []) historyByKey.set(`${stableKey(item)}|${item.provider || ''}`, clone(item));
    for (const item of remoteSnapshot.history || []) {
      const itemStableKey = stableKey(item);
      const projected = { name: item.displayName || 'Sent item', hash: item.hash || '', magnet: item.magnet || '', magnetUri: item.magnet || '', provider: item.provider || '', destinationName: item.destinationName || item.provider || 'My Magnetar', status: item.status === 'failed' ? 'failed' : 'succeeded', errorSummary: item.errorSummary || '', sourceUrl: item.sourceUrl || '', url: item.sourceUrl || '', timestamp: time(item.sentAt), lastSentAt: time(item.sentAt), sendCount: Number(item.sendCount || 1), stableKey: itemStableKey };
      const eventIds = (remoteSnapshot.historyEvents || []).filter(event => stableKey(event) === itemStableKey && String(event.provider || '') === String(item.provider || '')).map(event => String(event.clientEventId || event.eventId || '')).filter(Boolean).sort();
      projected._selfHostedSync = { eventIds, sendCount: projected.sendCount, fingerprint: historyFingerprint(projected) };
      historyByKey.set(`${itemStableKey}|${item.provider || ''}`, projected);
    }
    const assignmentUpdatedAt = Math.max(0, ...Object.values(merged.assignments).map(recordTime));
    return { saved, history: [...historyByKey.values()].sort((a,b) => time(b.timestamp)-time(a.timestamp)), folders: { version: 1, updatedAt: Math.max(0, assignmentUpdatedAt, ...folders.map(item => item.updatedAt), ...deletedFolders.map(item => item.deletedAt)), sourceDevice: 'sync', deletedFolders, folders } };
  }
  function reconcile({ local, serverSnapshot, checkpoint, now = Date.now() }) {
    const base = checkpoint?.canonical || { saved: {}, folders: {}, assignments: {}, historyEventIds: [] };
    const remote = normaliseServer(serverSnapshot);
    const client = localState(local, base, now);
    const identity = reconcileFolderIdentities(base.folders, client.folders, remote.folders, base.assignments, client.assignments, remote.assignments, now);
    const merged = { saved: mergeMaps(base.saved, client.saved, remote.saved), folders: identity.mergedFolders, assignments: collapseLegacyHashAssignmentAliases(mergeAssignmentMaps(identity.assignments.base, identity.assignments.local, identity.assignments.remote, identity.aliasedFolderIds), now) };
    for (const [key, assignment] of Object.entries(merged.assignments)) {
      const parent = merged.folders[assignment.folderId];
      if (parent && !parent.deleted) continue;
      if (base.assignments?.[key] || remote.assignments?.[key]) {
        const deletedAt = Math.max(recordTime(parent), recordTime(assignment), recordTime(base.assignments?.[key]), recordTime(remote.assignments?.[key])) || now;
        merged.assignments[key] = { folderId: assignment.folderId, stableKey: assignment.stableKey, deleted: true, deletedAt };
      }
      else delete merged.assignments[key];
    }
    const history = mutationsFor(remote, merged, local.history || [], [...new Set([...(base.historyEventIds || []), ...(remote.historyEventIds || [])])]);
    const canonical = { ...merged, historyEventIds: history.historyEventIds };
    return { canonical, mutations: history.mutations, local: localProjection(merged, serverSnapshot, local.history || []) };
  }
  function reconcileReplica({ local, remote, checkpoint, now = Date.now(), inferRemoteDeletes = true }) {
    const base = checkpoint?.canonical || { saved: {}, folders: {}, assignments: {}, historyEventIds: [] };
    const client = localState(local, base, now);
    const peer = localState(remote, base, now, inferRemoteDeletes);
    const identity = reconcileFolderIdentities(base.folders, client.folders, peer.folders, base.assignments, client.assignments, peer.assignments, now, true);
    const merged = {
      saved: mergeMaps(base.saved, client.saved, peer.saved),
      folders: identity.mergedFolders,
      assignments: collapseLegacyHashAssignmentAliases(mergeAssignmentMaps(identity.assignments.base, identity.assignments.local, identity.assignments.remote, identity.aliasedFolderIds), now)
    };
    for (const [key, assignment] of Object.entries(merged.assignments)) {
      const parent = merged.folders[assignment.folderId];
      if (parent && !parent.deleted) continue;
      if (base.assignments?.[key] || peer.assignments?.[key]) {
        const deletedAt = Math.max(recordTime(parent), recordTime(assignment), recordTime(base.assignments?.[key]), recordTime(peer.assignments?.[key])) || now;
        merged.assignments[key] = { folderId: assignment.folderId, stableKey: assignment.stableKey, deleted: true, deletedAt };
      } else delete merged.assignments[key];
    }
    const canonical = { ...merged, historyEventIds: [...new Set(base.historyEventIds || [])].sort() };
    return { canonical, local: localProjection(merged, { history: [] }, local.history || []) };
  }
  function mergeReplicaMaps(base, replicas, entity) {
    const keys = [...new Set([...(Object.keys(base?.[entity] || {})), ...replicas.flatMap(replica => Object.keys(replica?.canonical?.[entity] || {}))])].sort();
    const merged = {};
    for (const key of keys) {
      const baseline = base?.[entity]?.[key] || null;
      const changed = replicas
        .map(replica => replica?.canonical?.[entity]?.[key] || null)
        .filter((candidate, index) => candidate && !same(semantic(candidate), semantic(replicas[index]?.baseline?.[entity]?.[key] || null)));
      const value = changed.length ? winnerMany(baseline, changed) : baseline;
      if (value) merged[key] = value;
    }
    return merged;
  }
  function reconcileReplicas({ local, remotes = [], checkpoint, now = Date.now() }) {
    const base = checkpoint?.canonical || { saved: {}, folders: {}, assignments: {}, historyEventIds: [] };
    const localReplica = localState(local || {}, base, now);
    const sources = { ...(checkpoint?.sources || {}) };
    const remoteReplicas = remotes.map((entry, index) => {
      const id = entry?.id || `remote-${index}`;
      const prior = checkpoint?.sources?.[id]?.canonical || {};
      const state = entry?.state || entry || {};
      const canonical = state._canonicalSync
        ? clone(state._canonicalSync)
        : localState(state, prior, now, entry?.inferDeletes !== false && Boolean(checkpoint?.sources?.[id]));
      sources[id] = { canonical };
      return canonical;
    });
    const replicas = [
      { canonical: localReplica, baseline: base },
      ...remoteReplicas.map((canonical, index) => {
        const id = remotes[index]?.id || `remote-${index}`;
        return { canonical, baseline: checkpoint?.sources?.[id]?.canonical || {} };
      })
    ];
    const merged = {
      saved: mergeReplicaMaps(base, replicas, 'saved'),
      folders: mergeReplicaMaps(base, replicas, 'folders'),
      assignments: mergeReplicaMaps(base, replicas, 'assignments'),
      historyEventIds: [...new Set(base.historyEventIds || [])].sort()
    };
    const folderIdentity = collapseFolderNameAliases(merged.folders, merged.assignments, localReplica.folders, now);
    merged.folders = folderIdentity.folders;
    merged.assignments = collapseLegacyHashAssignmentAliases(folderIdentity.assignments, now);
    for (const [key, assignment] of Object.entries(merged.assignments)) {
      const parent = merged.folders[assignment.folderId];
      if (parent && !parent.deleted) continue;
      const deletedAt = Math.max(recordTime(parent), recordTime(assignment), recordTime(base.assignments?.[key])) || now;
      merged.assignments[key] = { folderId: assignment.folderId, stableKey: assignment.stableKey, deleted: true, deletedAt };
    }
    return { canonical: merged, local: localProjection(merged, { history: [] }, local?.history || []), sources };
  }
  function projectCanonical(canonical, history = []) {
    return localProjection(canonical || { saved: {}, folders: {}, assignments: {} }, { history: [] }, history);
  }
  function mutationId(deviceId, baseCursor, mutations) { return `cycle-${deviceId}-${baseCursor}-${fnv1a(stableStringify(mutations))}`; }
  function diagnosticValue(field, value) {
    if (/magnet|url/i.test(field)) return value ? '<redacted synced value>' : value;
    if (value && typeof value === 'object') return '<structured value>';
    return value === undefined ? '<missing>' : value;
  }
  function entitySemanticDiff(entity, serverCanonical = {}, localCanonical = {}, phase = 'canonicalisation') {
    const serverMap = serverCanonical[entity] || {}; const localMap = localCanonical[entity] || {};
    const entityName = entity === 'saved' ? 'saved' : entity.slice(0, -1);
    for (const id of [...new Set([...Object.keys(serverMap), ...Object.keys(localMap)])].sort()) {
      const serverRecord = serverMap[id]; const localRecord = localMap[id];
      if (!serverRecord || !localRecord) return { code: 'SYNC_NOT_CONVERGED', entity: entityName, id, field: 'presence', local: diagnosticValue('presence', Boolean(localRecord)), server: diagnosticValue('presence', Boolean(serverRecord)), phase };
      for (const field of [...new Set([...Object.keys(serverRecord), ...Object.keys(localRecord)])].sort()) if (!same(serverRecord[field], localRecord[field])) return { code: 'SYNC_NOT_CONVERGED', entity: entityName, id, field, local: diagnosticValue(field, localRecord[field]), server: diagnosticValue(field, serverRecord[field]), phase };
    }
    return null;
  }
  function historySemanticDiff(serverCanonical = {}, localCanonical = {}, phase = 'canonicalisation') {
    const serverEvents = new Set(serverCanonical.historyEventIds || []); const localEvents = new Set(localCanonical.historyEventIds || []);
    for (const id of [...new Set([...serverEvents, ...localEvents])].sort()) if (serverEvents.has(id) !== localEvents.has(id)) return { code: 'SYNC_NOT_CONVERGED', entity: 'history', id, field: 'eventId', local: localEvents.has(id), server: serverEvents.has(id), phase };
    return null;
  }
  function semanticDiffs(serverCanonical = {}, localCanonical = {}, phase = 'canonicalisation') {
    return {
      saved: entitySemanticDiff('saved', serverCanonical, localCanonical, phase),
      folders: entitySemanticDiff('folders', serverCanonical, localCanonical, phase),
      assignments: entitySemanticDiff('assignments', serverCanonical, localCanonical, phase),
      history: historySemanticDiff(serverCanonical, localCanonical, phase),
    };
  }
  function semanticDiff(serverCanonical = {}, localCanonical = {}, phase = 'canonicalisation') {
    return Object.values(semanticDiffs(serverCanonical, localCanonical, phase)).find(Boolean) || null;
  }
  MagnetarSelfHostedSync = { stableStringify, stableKey, normaliseServer, canonicaliseReplica: localState, reconcile, reconcileReplica, reconcileReplicas, projectCanonical, mutationId, semanticDiff, semanticDiffs };
  globalThis.MagnetarSelfHostedSync = MagnetarSelfHostedSync;
})();

