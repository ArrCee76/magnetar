const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'chrome', 'lib', 'selfhost-sync.js'), 'utf8');
const context = { console, Date, JSON, Math, Number, Object, String, Set, Map, URL };
context.globalThis = context;
vm.runInNewContext(source, context);
const engine = context.MagnetarSelfHostedSync;
const hashA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const hashB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const saved = (hash, name, updatedAt) => ({ name, hash, savedAt: updatedAt });
const folderState = (folders = [], deletedFolders = []) => ({ version: 1, folders, deletedFolders });
const emptyLocal = () => ({ saved: [], history: [], folders: folderState() });
const emptyServer = () => ({ saved: [], history: [], historyEvents: [], folders: [], tombstones: { saved: [], folders: [], assignments: [] } });
const serverSaved = (hash, name, updatedAt) => ({ ...emptyServer(), saved: [{ stableKey: `hash:${hash}`, hash, displayName: name, updatedAt: new Date(updatedAt).toISOString(), savedAt: new Date(updatedAt).toISOString() }] });
const localFolder = (id, name, updatedAt, items = [], order = 0, color = 'default') => ({ id, name, color, order, updatedAt, items });
const remoteFolder = (id, name, updatedAt, items = [], order = 0, color = 'default') => ({ id, name, color, sortOrder: order, updatedAt: new Date(updatedAt).toISOString(), items });
const folderServer = (folders) => ({ ...emptyServer(), folders });

{
  const first = engine.reconcile({ local: { ...emptyLocal(), saved: [saved(hashA, 'Local', 100)] }, serverSnapshot: emptyServer(), now: 200 });
  assert.deepEqual(JSON.parse(JSON.stringify(first.mutations)), [{ type: 'saved.upsert', record: { stableKey: `hash:${hashA}`, displayName: 'Local', hash: hashA, magnet: '', sourceUrl: '', updatedAt: 100 } }]);
  assert.equal(engine.reconcile({ local: emptyLocal(), serverSnapshot: emptyServer(), now: 200 }).mutations.length, 0, 'empty first sync is a no-op');
  const serverOnly = engine.reconcile({ local: emptyLocal(), serverSnapshot: serverSaved(hashA, 'Remote', 100), now: 200 });
  assert.equal(serverOnly.mutations.length, 0, 'an empty first client must not delete unseen server state');
  assert.equal(serverOnly.local.saved[0].name, 'Remote');
}

{
  const sameId = engine.reconcile({
    local: { ...emptyLocal(), folders: folderState([localFolder('shared', 'Audiobooks', 100)]) },
    serverSnapshot: folderServer([remoteFolder('shared', 'Audiobooks', 100)]), now: 200,
  });
  assert.equal(sameId.mutations.length, 0, 'same-name/same-ID folders merge normally');

  const localItem = { hash: hashA, displayName: 'Local book', updatedAt: 200 };
  const first = engine.reconcile({
    local: { ...emptyLocal(), folders: folderState([localFolder('local-audio', 'Audiobooks', 200, [localItem], 1, 'blue')]) },
    serverSnapshot: folderServer([remoteFolder('server-audio', 'Audiobooks', 100, [], 4, 'sage')]), now: 300,
  });
  assert.equal(first.local.folders.folders.length, 1);
  assert.equal(first.local.folders.folders[0].id, 'server-audio', 'server identity wins without a checkpoint');
  assert.equal(first.local.folders.folders[0].items[0].folderId, 'server-audio', 'local assignments are remapped to the winning identity');
  assert.equal(first.mutations.some(item => item.record?.id === 'local-audio' || item.record?.folderId === 'local-audio'), false, 'losing local identity is never pushed');
  assert.equal(first.mutations.find(item => item.type === 'folder.upsert').record.id, 'server-audio');
  assert.equal(first.mutations.find(item => item.type === 'assignment.upsert').record.folderId, 'server-audio');

  const verifiedSnapshot = folderServer([remoteFolder('server-audio', 'Audiobooks', 200, [{ stableKey: `hash:${hashA}`, hash: hashA, displayName: 'Local book', updatedAt: new Date(200).toISOString() }], 1, 'blue')]);
  const verified = engine.reconcile({ local: first.local, serverSnapshot: verifiedSnapshot, checkpoint: { canonical: first.canonical }, now: 400 });
  assert.equal(verified.mutations.length, 0, 'the remapped first sync converges during final verification');
}

{
  for (const [index, name] of ['Watch Later', 'Audiobooks', 'Other'].entries()) {
    const result = engine.reconcile({
      local: { ...emptyLocal(), folders: folderState([localFolder(`local-${index}`, name, 100)]) },
      serverSnapshot: folderServer([remoteFolder(`server-${index}`, name, 100)]), now: 200,
    });
    assert.equal(result.local.folders.folders[0].id, `server-${index}`, `${name} converges on the server identity`);
    assert.equal(result.mutations.some(item => item.type === 'folder.upsert'), false, `${name} equivalent upsert is a no-op`);
  }
}

{
  const itemA = { stableKey: `hash:${hashA}`, hash: hashA, displayName: 'A', updatedAt: new Date(100).toISOString() };
  const itemB = { hash: hashB, displayName: 'B', updatedAt: 110 };
  const result = engine.reconcile({
    local: { ...emptyLocal(), folders: folderState([localFolder('local-folder', 'Shared', 100, [itemB], 7)]) },
    serverSnapshot: folderServer([remoteFolder('server-folder', 'Shared', 100, [itemA], 3)]), now: 200,
  });
  assert.deepEqual(result.local.folders.folders[0].items.map(item => item.stableKey).sort(), [`hash:${hashA}`, `hash:${hashB}`], 'assignments from both identities are preserved');
  assert.equal(result.mutations.filter(item => item.type === 'assignment.upsert').length, 1, 'only the missing remapped assignment is pushed');

  const remoteOrderWins = engine.reconcile({
    local: { ...emptyLocal(), folders: folderState([localFolder('local-order', 'Ordered', 100, [], 9)]) },
    serverSnapshot: folderServer([remoteFolder('server-order', 'Ordered', 200, [], 2)]), now: 300,
  });
  assert.equal(remoteOrderWins.local.folders.folders[0].order, 2, 'folder ordering follows the existing deterministic timestamp rule');
}

{
  const checkpointSnapshot = folderServer([remoteFolder('checkpoint-folder', 'Checkpoint shelf', 100, [{ stableKey: `hash:${hashA}`, hash: hashA, displayName: 'A', updatedAt: new Date(100).toISOString() }])]);
  const checkpoint = engine.reconcile({ local: { ...emptyLocal(), folders: folderState([localFolder('checkpoint-folder', 'Checkpoint shelf', 100, [{ hash: hashA, displayName: 'A', updatedAt: 100 }])]) }, serverSnapshot: checkpointSnapshot, now: 100 }).canonical;
  const replacedServer = folderServer([remoteFolder('replacement-folder', 'Checkpoint shelf', 200, [{ stableKey: `hash:${hashB}`, hash: hashB, displayName: 'B', updatedAt: new Date(200).toISOString() }])]);
  const result = engine.reconcile({ local: { ...emptyLocal(), folders: folderState([localFolder('checkpoint-folder', 'Checkpoint shelf', 100, [{ hash: hashA, displayName: 'A', updatedAt: 100 }])]) }, serverSnapshot: replacedServer, checkpoint: { canonical: checkpoint }, now: 300 });
  assert.equal(result.local.folders.folders[0].id, 'checkpoint-folder', 'checkpoint identity wins over a replacement server identity');
  assert.equal(result.mutations[0].type, 'folder.delete', 'losing server identity is retired before canonical upsert');
  assert.equal(result.mutations[0].id, 'replacement-folder');
  assert.equal(result.mutations.find(item => item.type === 'folder.upsert').record.id, 'checkpoint-folder');
  assert.deepEqual(result.local.folders.folders[0].items.map(item => item.stableKey).sort(), [`hash:${hashA}`, `hash:${hashB}`], 'checkpoint remap preserves assignments from both identities');
}

{
  const stalePreV2 = engine.reconcile({
    local: { ...emptyLocal(), folders: folderState([localFolder('old-default', 'Other', 150)]) },
    serverSnapshot: folderServer([remoteFolder('server-default', 'Other', 100)]), checkpoint: { cursor: 81 }, now: 200,
  });
  assert.equal(stalePreV2.local.folders.folders[0].id, 'server-default', 'a pre-v2 checkpoint without canonical state behaves as a fresh replica');
  assert.equal(stalePreV2.mutations.some(item => item.record?.id === 'old-default'), false);

  assert.throws(() => engine.reconcile({
    local: { ...emptyLocal(), folders: folderState([localFolder('duplicate-a', 'Duplicates', 100), localFolder('duplicate-b', 'duplicates', 110)]) },
    serverSnapshot: emptyServer(), now: 200,
  }), error => error.code === 'SYNC_FOLDER_NAME_CONFLICT' && /No changes were applied/.test(error.message), 'genuine same-replica duplicates fail before a mutation batch is built');
}

{
  const initial = engine.reconcile({ local: { ...emptyLocal(), saved: [saved(hashA, 'Base', 100)] }, serverSnapshot: serverSaved(hashA, 'Base', 100), now: 100 });
  const localDelete = engine.reconcile({ local: emptyLocal(), serverSnapshot: serverSaved(hashA, 'Base', 100), checkpoint: { canonical: initial.canonical }, now: 300 });
  assert.equal(localDelete.mutations[0].type, 'saved.delete', 'offline client deletion becomes an explicit tombstone');
  const remoteDeleteSnapshot = { ...emptyServer(), tombstones: { saved: [{ stableKey: `hash:${hashA}`, deletedAt: new Date(250).toISOString() }], folders: [], assignments: [] } };
  const remoteDelete = engine.reconcile({ local: { ...emptyLocal(), saved: [saved(hashA, 'Base', 100)] }, serverSnapshot: remoteDeleteSnapshot, checkpoint: { canonical: initial.canonical }, now: 300 });
  assert.equal(remoteDelete.mutations.length, 0);
  assert.equal(remoteDelete.local.saved.length, 0, 'server deletion is never resurrected');
}

{
  const baseSnapshot = serverSaved(hashA, 'Base', 100);
  const base = engine.reconcile({ local: { ...emptyLocal(), saved: [saved(hashA, 'Base', 100)] }, serverSnapshot: baseSnapshot, now: 100 }).canonical;
  const remote = serverSaved(hashA, 'Remote newer', 300);
  remote.saved.push({ stableKey: `hash:${hashB}`, hash: hashB, displayName: 'Remote add', updatedAt: new Date(250).toISOString(), savedAt: new Date(250).toISOString() });
  const concurrent = engine.reconcile({ local: { ...emptyLocal(), saved: [saved(hashA, 'Local older', 200), saved('cccccccccccccccccccccccccccccccccccccccc', 'Local add', 220)] }, serverSnapshot: remote, checkpoint: { canonical: base }, now: 400 });
  assert.equal(concurrent.local.saved.find(item => item.hash === hashA).name, 'Remote newer');
  assert.equal(concurrent.local.saved.length, 3, 'concurrent additions are unioned');
  assert.equal(concurrent.mutations.filter(item => item.type === 'saved.upsert').length, 1, 'only the missing local addition is pushed');
}

{
  const baseFolder = { id: 'f1', name: 'Base', color: 'default', order: 1, updatedAt: 100, items: [{ hash: hashA, displayName: 'A', updatedAt: 100 }] };
  const initialServer = { ...emptyServer(), folders: [{ id: 'f1', name: 'Base', color: 'default', sortOrder: 1, updatedAt: new Date(100).toISOString(), items: [{ stableKey: `hash:${hashA}`, hash: hashA, displayName: 'A', updatedAt: new Date(100).toISOString() }] }] };
  const base = engine.reconcile({ local: { ...emptyLocal(), folders: folderState([baseFolder]) }, serverSnapshot: initialServer, now: 100 }).canonical;
  const remote = { ...emptyServer(), folders: [{ id: 'f1', name: 'Remote rename', color: 'blue', sortOrder: 4, updatedAt: new Date(300).toISOString(), items: [] }], tombstones: { saved: [], folders: [], assignments: [{ folderId: 'f1', stableKey: `hash:${hashA}`, deletedAt: new Date(300).toISOString() }] } };
  const localFolder = { ...baseFolder, name: 'Local rename', order: 2, updatedAt: 200, items: [{ hash: hashA, displayName: 'A local', updatedAt: 220 }] };
  const merged = engine.reconcile({ local: { ...emptyLocal(), folders: folderState([localFolder]) }, serverSnapshot: remote, checkpoint: { canonical: base }, now: 400 });
  assert.equal(merged.local.folders.folders[0].name, 'Remote rename', 'newer folder rename wins deterministically');
  assert.equal(merged.local.folders.folders[0].order, 4, 'winning folder ordering is preserved');
  assert.equal(merged.local.folders.folders[0].items.length, 0, 'assignment tombstone wins over a concurrent edit');
  assert.equal(merged.mutations.some(item => item.type === 'assignment.upsert'), false);
  const folderDeleted = { ...emptyServer(), tombstones: { saved: [], assignments: [], folders: [{ id: 'f1', deletedAt: new Date(350).toISOString() }] } };
  const deletion = engine.reconcile({ local: { ...emptyLocal(), folders: folderState([localFolder]) }, serverSnapshot: folderDeleted, checkpoint: { canonical: base }, now: 400 });
  assert.equal(deletion.local.folders.folders.length, 0, 'folder deletion wins and cannot be recreated');
}

{
  const history = [{ id: 'event-1', hash: hashA, name: 'Sent', provider: 'torbox', timestamp: 100, sendCount: 1 }];
  const first = engine.reconcile({ local: { ...emptyLocal(), history }, serverSnapshot: emptyServer(), now: 100 });
  assert.equal(first.mutations.filter(item => item.type === 'history.append').length, 1);
  const repeated = engine.reconcile({ local: first.local, serverSnapshot: emptyServer(), checkpoint: { canonical: first.canonical }, now: 200 });
  assert.equal(repeated.mutations.filter(item => item.type === 'history.append').length, 0, 'known history events never append twice');
  assert.equal(engine.mutationId('device', 4, first.mutations), engine.mutationId('device', 4, first.mutations), 'retry mutation identity is stable');
}

{
  const deletedAt = new Date(200).toISOString();
  const productionShape = {
    ...emptyServer(),
    folders: [remoteFolder('server-only-empty', 'Server only empty', 250, [], 7)],
    tombstones: {
      saved: [],
      folders: [{ id: 'deleted-parent', deletedAt }],
      assignments: [{ folderId: 'deleted-parent', stableKey: `hash:${hashA}`, deletedAt }],
    },
  };
  const first = engine.reconcile({ local: emptyLocal(), serverSnapshot: productionShape, now: 300 });
  assert.equal(first.canonical.assignments[`deleted-parent|hash:${hashA}`].deletedAt, 200, 'parent cleanup preserves an existing assignment tombstone timestamp');
  assert.equal(first.local.folders.folders.find(folder => folder.id === 'server-only-empty').name, 'Server only empty', 'a remote empty folder survives alongside old tombstones');
  const verified = engine.reconcile({ local: first.local, serverSnapshot: productionShape, checkpoint: { canonical: first.canonical }, now: 400 });
  assert.equal(verified.mutations.length, 0, 'reconciliation does not re-delete an already deleted parent assignment');
  assert.equal(engine.semanticDiff(first.canonical, verified.canonical, 'production-tombstone-round-trip'), null, 'the production tombstone shape is a stable canonical fixed point');
  assert.deepEqual(JSON.parse(JSON.stringify(engine.semanticDiffs(first.canonical, verified.canonical, 'entity-diagnostics'))), { saved: null, folders: null, assignments: null, history: null });
}

{
  const key = `hash:${hashA}`;
  const baseRecord = { stableKey: key, displayName: 'Base', hash: hashA, magnet: '', sourceUrl: '', updatedAt: 100 };
  const checkpoint = { canonical: { saved: { [key]: baseRecord }, folders: {}, assignments: {}, historyEventIds: [] }, sources: {} };
  const mobileDelete = { ...emptyLocal(), _canonicalSync: { saved: { [key]: { stableKey: key, deleted: true, deletedAt: 200 } }, folders: {}, assignments: {} } };
  const webRestore = { ...emptyLocal(), _canonicalSync: { saved: { [key]: { ...baseRecord, displayName: 'Restored', updatedAt: 300 } }, folders: {}, assignments: {} } };
  const canonicalLocal = { ...emptyLocal(), saved: [saved(hashA, 'Base', 100)] };
  const unseenMissing = engine.reconcileReplicas({ local: canonicalLocal, remotes: [{ id: 'new-peer', state: emptyLocal() }], checkpoint, now: 400 });
  assert.equal(unseenMissing.local.saved[0].name, 'Base', 'an absent record on an uncheckpointed adapter is not a deletion');
  const restored = engine.reconcileReplicas({ local: canonicalLocal, remotes: [{ id: 'hosted', state: mobileDelete }, { id: 'selfHosted', state: webRestore }], checkpoint, now: 400 });
  assert.equal(restored.local.saved[0].name, 'Restored', 'newer restoration beats an older tombstone');
  const newerDelete = { ...emptyLocal(), _canonicalSync: { saved: { [key]: { stableKey: key, deleted: true, deletedAt: 350 } }, folders: {}, assignments: {} } };
  const deleted = engine.reconcileReplicas({ local: canonicalLocal, remotes: [{ id: 'hosted', state: newerDelete }, { id: 'selfHosted', state: webRestore }], checkpoint, now: 400 });
  assert.equal(deleted.local.saved.length, 0, 'newer deletion beats an older restoration');
}

{
  const base = { canonical: { saved: {}, folders: {}, assignments: {}, historyEventIds: [] }, sources: {} };
  const mobile = { ...emptyLocal(), saved: [saved(hashA, 'Mobile addition', 200)] };
  const web = { ...emptyLocal(), saved: [saved(hashB, 'Web addition', 210)] };
  const merged = engine.reconcileReplicas({ local: emptyLocal(), remotes: [{ id: 'hosted', state: mobile }, { id: 'selfHosted', state: web }], checkpoint: base, now: 300 });
  assert.deepEqual(merged.local.saved.map(item => item.name).sort(), ['Mobile addition', 'Web addition'], 'independent records from both adapters survive one merge');
  const repeated = engine.reconcileReplicas({ local: merged.local, remotes: [{ id: 'hosted', state: merged.local }, { id: 'selfHosted', state: merged.local }], checkpoint: { canonical: merged.canonical, sources: merged.sources }, now: 400 });
  assert.equal(engine.semanticDiff(merged.canonical, repeated.canonical, 'three-way-idempotence'), null, 'three-way merge reaches a stable fixed point');
}

console.log('My Magnetar deterministic sync engine checks passed.');
