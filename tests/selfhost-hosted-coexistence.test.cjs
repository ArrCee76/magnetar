const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const now = 1_800_000_000_000;
const folder = (id, name, order, items = [], updatedAt = now) => ({ id, name, color: 'blue', order, createdAt: updatedAt, updatedAt, items });
const item = (stableKey, order = 0, updatedAt = now) => ({ stableKey, itemKey: stableKey, displayName: stableKey, order, updatedAt });
const section = (folders = [], deletedFolders = [], updatedAt = now) => ({ schema: 'magnetar-folders-v1', updatedAt, sourceDevice: 'replica', deletedFolders, folders });

const state = {
  'magnetar-saved': [],
  'magnetar-history': [],
  'magnetar-organised-folders': section([folder('self-folder', 'From My Magnetar', 0, [item('hash:one')])]),
  'magnetar-sync-mobile-ack': { paired: true, id: 'mobile', type: 'mobile', platform: 'android', name: 'Mobile' },
};
const settings = { enabled: true, serverUrl: 'https://sync.example.test', syncId: 'id', syncToken: 'token', encryptionKey: 'key', deviceId: 'browser', deviceName: 'Browser' };
let revision = 1;
let putCount = 0;
const scheduledTimers = [];
let hostedPayload = {
  schema: 1, createdAt: now, updatedAt: now,
  devices: { mobile: { paired: true, id: 'mobile', type: 'mobile', platform: 'android', name: 'Mobile' } },
  sections: { saved: { items: [] }, history: { items: [] }, organisedFolders: section([]) },
};
const storage = {
  async get(keys) { return Object.fromEntries(keys.filter(key => key in state).map(key => [key, clone(state[key])])); },
  async set(values) { Object.assign(state, clone(values)); },
  async remove(keys) { for (const key of keys) delete state[key]; },
};
const context = {
  console, Date, JSON, Math, Number, Object, String, Set, Map, URL, Error, AbortController,
  setTimeout(fn, ms) { scheduledTimers.push({ fn, ms }); return scheduledTimers.length; },
  clearTimeout() {}, crypto: { getRandomValues(bytes) { return bytes.fill(7); } },
  MAGNETAR_API: { storage: { local: storage } },
  MagnetarSyncStorage: {
    async loadSettings() { return clone(settings); },
    async saveSettings(next) { Object.assign(settings, clone(next)); return clone(settings); },
  },
  MagnetarSyncContract: {
    createPayloadSkeleton(timestamp) { return { schema: 1, createdAt: timestamp, updatedAt: timestamp, devices: {}, sections: {} }; },
  },
  MagnetarSyncApi: {
    async getVault() { return { revision, envelope: 'encrypted' }; },
    async putVault({ baseRevision }) {
      assert.equal(baseRevision, revision);
      hostedPayload = clone(context.__encryptedPayload);
      revision += 1; putCount += 1;
      return { revision };
    },
  },
  MagnetarSyncCrypto: {
    async decryptJson() { return clone(hostedPayload); },
    async encryptJson(payload) { context.__encryptedPayload = clone(payload); return 'next-encrypted'; },
  },
  globalThis: null,
};
context.globalThis = context;
vm.runInNewContext(fs.readFileSync(path.join(root, 'chrome', 'lib', 'selfhost-sync.js'), 'utf8'), context);
vm.runInNewContext(fs.readFileSync(path.join(root, 'chrome', 'lib', 'sync-data.js'), 'utf8'), context);
assert.equal(typeof context.MagnetarSyncData.maybePullLatest, 'function', 'the background auto-pull entry point must be exported');

(async () => {
  const identityCollision = context.MagnetarSelfHostedSync.reconcileReplica({
    local: { saved: [], history: [], folders: section([folder('canonical-folder', 'Audiobooks', 0)]) },
    remote: { saved: [], history: [], folders: section([folder('hosted-folder', 'Audiobooks', 0)]) },
    checkpoint: null,
    now,
  });
  assert.deepEqual(Object.values(identityCollision.canonical.folders).filter(value => !value.deleted).map(value => value.id), ['canonical-folder']);
  assert.equal(identityCollision.canonical.folders['hosted-folder'].deleted, true);
  assert.equal(identityCollision.local.folders.folders[0].id, 'canonical-folder');
  const identityNoOp = context.MagnetarSelfHostedSync.reconcileReplica({
    local: identityCollision.local,
    remote: identityCollision.local,
    checkpoint: { canonical: identityCollision.canonical },
    now: now + 1,
  });
  assert.deepEqual(identityNoOp.canonical, identityCollision.canonical, 'same-name identity reconciliation must not ping-pong');

  const timestampOnly = context.MagnetarSelfHostedSync.reconcile({
    local: { saved: [{ name: 'Timestamp stable', hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', savedAt: now + 100 }], history: [], folders: section([]) },
    serverSnapshot: { saved: [{ stableKey: 'hash:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', displayName: 'Timestamp stable', hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', updatedAt: now }], folders: [], history: [], historyEvents: [], tombstones: { saved: [], folders: [], assignments: [] } },
    checkpoint: { canonical: { saved: { 'hash:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa': { stableKey: 'hash:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', displayName: 'Timestamp stable', hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', magnet: '', sourceUrl: '', updatedAt: now } }, folders: {}, assignments: {}, historyEventIds: [] } },
    now: now + 100,
  });
  assert.equal(timestampOnly.mutations.length, 0, 'timestamp-only adapter metadata must be a semantic no-op');

  const collisionKey = 'hash:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const staleHostedLive = { stableKey: collisionKey, displayName: 'Old Mobile copy', hash: collisionKey.slice(5), magnet: '', sourceUrl: '', updatedAt: now };
  const acceptedSelfDelete = { stableKey: collisionKey, deleted: true, deletedAt: now + 100 };
  const collisionCheckpoint = {
    canonical: { saved: { [collisionKey]: acceptedSelfDelete }, folders: {}, assignments: {}, historyEventIds: [] },
    sources: {
      selfHosted: { canonical: { saved: { [collisionKey]: acceptedSelfDelete }, folders: {}, assignments: {} } },
      hosted: { canonical: { saved: { [collisionKey]: staleHostedLive }, folders: {}, assignments: {} } }
    }
  };
  const stalePresenceAfterDelete = context.MagnetarSelfHostedSync.reconcileReplicas({
    local: { saved: [], history: [], folders: section([]) },
    remotes: [
      { id: 'selfHosted', state: { _canonicalSync: collisionCheckpoint.sources.selfHosted.canonical } },
      { id: 'hosted', state: { saved: [{ name: 'Old Mobile copy', hash: collisionKey.slice(5), updatedAt: now }], history: [], folders: section([]) }, inferDeletes: false }
    ],
    checkpoint: collisionCheckpoint,
    now: now + 300_000
  });
  assert.equal(stalePresenceAfterDelete.canonical.saved[collisionKey].deleted, true, 'an unchanged stale Hosted presence must not resurrect a deletion accepted from My Magnetar');

  const newerHostedEdit = context.MagnetarSelfHostedSync.reconcileReplicas({
    local: { saved: [], history: [], folders: section([]) },
    remotes: [
      { id: 'selfHosted', state: { _canonicalSync: collisionCheckpoint.sources.selfHosted.canonical } },
      { id: 'hosted', state: { saved: [{ name: 'Restored on Mobile', hash: collisionKey.slice(5), updatedAt: now + 200 }], history: [], folders: section([]) }, inferDeletes: false }
    ],
    checkpoint: collisionCheckpoint,
    now: now + 300_000
  });
  assert.equal(newerHostedEdit.canonical.saved[collisionKey].deleted, undefined, 'a genuinely newer Hosted restoration must beat the older tombstone');
  assert.equal(newerHostedEdit.canonical.saved[collisionKey].displayName, 'Restored on Mobile');

  const first = await context.MagnetarSyncData.pushSavedAndHistory({ manual: true });
  assert.equal(first.changed, true);
  assert.deepEqual(hostedPayload.sections.organisedFolders.folders.map(value => value.id), ['self-folder']);
  assert.equal(hostedPayload.sections.organisedFolders.folders[0].items[0].stableKey, 'hash:one');
  assert.equal(state['magnetar-sync-hosted-checkpoint'].revision, revision);
  const selfHostedBase = { canonical: clone(state['magnetar-sync-hosted-checkpoint'].canonical) };
  const firstPutCount = putCount;

  const noOp = await context.MagnetarSyncData.pushSavedAndHistory({ manual: true });
  assert.equal(noOp.changed, false);
  assert.equal(noOp.mutationCount, 0);
  assert.equal(putCount, firstPutCount, 'acknowledged canonical state must not echo');

  const projectedAssignmentTime = now + 25;
  const timestampCanonical = clone(state['magnetar-sync-hosted-checkpoint'].canonical);
  const timestampAssignmentKey = Object.keys(timestampCanonical.assignments)[0];
  timestampCanonical.assignments[timestampAssignmentKey].updatedAt = projectedAssignmentTime;
  const timestampProjection = context.MagnetarSelfHostedSync.projectCanonical(timestampCanonical, []);
  assert.equal(timestampProjection.folders.updatedAt, projectedAssignmentTime, 'Hosted folder section time must include membership changes');

  const repairPutCount = putCount;
  hostedPayload.sections.organisedFolders.updatedAt = now - 1;
  revision += 1;
  const transportRepair = await context.MagnetarSyncData.pushSavedAndHistory({ manual: true });
  assert.equal(transportRepair.mutationCount, 0, 'repairing stale transport metadata is not a canonical mutation');
  assert.equal(transportRepair.changed, true, 'stale Hosted folder transport time must be repaired');
  assert.equal(putCount, repairPutCount + 1, 'the repair must publish even when canonical records are unchanged');
  assert.equal(hostedPayload.sections.organisedFolders.updatedAt, now);

  hostedPayload.sections.organisedFolders = section([
    clone(hostedPayload.sections.organisedFolders.folders[0]),
    folder('mobile-folder', 'From Mobile', 1, [item('hash:two')], now + 10),
  ], [], now + 10);
  revision += 1;
  const mobilePull = await context.MagnetarSyncData.pullSavedAndHistory({ manual: true });
  assert.equal(mobilePull.changed, false, 'current mobile snapshot already contains the merged target');
  assert.deepEqual(state['magnetar-organised-folders'].folders.map(value => value.id), ['self-folder', 'mobile-folder']);
  assert.equal(state['magnetar-organised-folders'].folders[1].items[0].stableKey, 'hash:two');

  const serverA = {
    saved: [], history: [], historyEvents: [], tombstones: { saved: [], folders: [], assignments: [] },
    folders: [{ id: 'self-folder', name: 'From My Magnetar', color: 'blue', sortOrder: 0, updatedAt: now, items: [{ stableKey: 'hash:one', displayName: 'hash:one', sortOrder: 0, updatedAt: now }] }],
  };
  const mobileToSelf = context.MagnetarSelfHostedSync.reconcile({
    local: { saved: state['magnetar-saved'], history: state['magnetar-history'], folders: state['magnetar-organised-folders'] },
    serverSnapshot: serverA, checkpoint: selfHostedBase, now: now + 11,
  });
  assert.ok(mobileToSelf.mutations.some(mutation => mutation.type === 'folder.upsert' && mutation.record.id === 'mobile-folder'));
  assert.ok(mobileToSelf.mutations.some(mutation => mutation.type === 'assignment.upsert' && mutation.record.folderId === 'mobile-folder'));

  const serverWithNewSelfFolder = clone(serverA);
  serverWithNewSelfFolder.folders.push(
    { id: 'mobile-folder', name: 'From Mobile', color: 'blue', sortOrder: 1, updatedAt: now + 10, items: [{ stableKey: 'hash:two', displayName: 'hash:two', sortOrder: 0, updatedAt: now + 10 }] },
    { id: 'self-folder-two', name: 'Second My Magnetar Folder', color: 'blue', sortOrder: 2, updatedAt: now + 20, items: [] },
  );
  const selfToCanonical = context.MagnetarSelfHostedSync.reconcile({
    local: { saved: state['magnetar-saved'], history: state['magnetar-history'], folders: state['magnetar-organised-folders'] },
    serverSnapshot: serverWithNewSelfFolder, checkpoint: { canonical: mobileToSelf.canonical }, now: now + 20,
  });
  assert.equal(selfToCanonical.mutations.length, 0);
  state['magnetar-organised-folders'] = clone(selfToCanonical.local.folders);
  const bridgePush = await context.MagnetarSyncData.pushSavedAndHistory({ manual: true });
  assert.equal(bridgePush.changed, true);
  assert.ok(hostedPayload.sections.organisedFolders.folders.some(value => value.id === 'self-folder-two'));

  hostedPayload.sections.organisedFolders = section(
    hostedPayload.sections.organisedFolders.folders.filter(value => value.id !== 'mobile-folder'),
    [{ id: 'mobile-folder', deletedAt: now + 30, sourceDevice: 'mobile' }],
    now + 30,
  );
  revision += 1;
  await context.MagnetarSyncData.pullSavedAndHistory({ manual: true });
  assert.equal(state['magnetar-organised-folders'].folders.some(value => value.id === 'mobile-folder'), false);
  assert.ok(state['magnetar-organised-folders'].deletedFolders.some(value => value.id === 'mobile-folder'));

  state['magnetar-saved'] = [{ id: 'saved-self', name: 'Saved from My Magnetar', hash: '1111111111111111111111111111111111111111', savedAt: now + 40 }];
  state['magnetar-history'] = [{ id: 'history-self', name: 'Sent from My Magnetar', hash: '1111111111111111111111111111111111111111', provider: 'torbox', status: 'succeeded', timestamp: now + 40, lastSentAt: now + 40, sendCount: 1 }];
  await context.MagnetarSyncData.pushSavedAndHistory({ manual: true });
  assert.ok(hostedPayload.sections.saved.items.some(value => value.hash === '1111111111111111111111111111111111111111'));
  assert.ok(hostedPayload.sections.history.items.some(value => value.provider === 'torbox'));

  hostedPayload.sections.saved.items.push({ id: 'saved-mobile', name: 'Saved from Mobile', hash: '2222222222222222222222222222222222222222', savedAt: now + 50 });
  hostedPayload.sections.history.items.push({ id: 'history-mobile', name: 'Sent from Mobile', hash: '2222222222222222222222222222222222222222', provider: 'realdebrid', status: 'succeeded', timestamp: now + 50, lastSentAt: now + 50, sendCount: 1 });
  revision += 1;
  await context.MagnetarSyncData.pullSavedAndHistory({ manual: true });
  assert.deepEqual(state['magnetar-saved'].map(value => value.hash).sort(), ['1111111111111111111111111111111111111111', '2222222222222222222222222222222222222222']);
  assert.deepEqual(state['magnetar-history'].map(value => value.provider).sort(), ['realdebrid', 'torbox']);

  const canonicalToSelf = context.MagnetarSelfHostedSync.reconcile({
    local: { saved: state['magnetar-saved'], history: state['magnetar-history'], folders: state['magnetar-organised-folders'] },
    serverSnapshot: { saved: [], folders: [], history: [], historyEvents: [], tombstones: { saved: [], folders: [], assignments: [] } },
    checkpoint: null, now: now + 51,
  });
  assert.equal(canonicalToSelf.mutations.filter(mutation => mutation.type === 'saved.upsert').length, 2);
  assert.equal(canonicalToSelf.mutations.filter(mutation => mutation.type === 'history.append').length, 2);

  hostedPayload.sections.saved.items = hostedPayload.sections.saved.items.filter(value => value.hash !== '2222222222222222222222222222222222222222');
  revision += 1;
  await context.MagnetarSyncData.pullSavedAndHistory({ manual: true });
  assert.equal(state['magnetar-saved'].some(value => value.hash === '2222222222222222222222222222222222222222'), true, 'Hosted Mobile absence is a stale presence snapshot, not a deletion tombstone');
  assert.equal(hostedPayload.sections.saved.items.some(value => value.hash === '2222222222222222222222222222222222222222'), true, 'canonical state must repair the stale Hosted Mobile snapshot');
  const finalPutCount = putCount;
  const finalNoOp = await context.MagnetarSyncData.pushSavedAndHistory({ manual: true });
  assert.equal(finalNoOp.mutationCount, 0);
  assert.equal(putCount, finalPutCount);
  assert.ok(state['magnetar-self-hosted'] === undefined, 'hosted adapter checkpoint remains independent');

  // Exercise the real debounced automatic Mobile path rather than calling the
  // coordinator directly. This is the path fired by extension storage changes.
  let exclusiveRuns = 0;
  context.MagnetarSyncData.setCanonicalRunner(async operation => { exclusiveRuns += 1; return operation(); });
  const delayedHash = '3333333333333333333333333333333333333333';
  const missingTimestampHash = '4444444444444444444444444444444444444444';
  state['magnetar-saved'] = [
    ...state['magnetar-saved'],
    { id: 'web-delayed', name: 'Delayed Web value', hash: delayedHash, savedAt: now + 300_000, updatedAt: now + 300_000 },
    { id: 'web-no-time', name: 'Web value without adapter timestamp', hash: missingTimestampHash }
  ];
  context.MagnetarSyncData.scheduleAutoPush('saved-history-change');
  const delayedTimer = scheduledTimers.at(-1);
  assert.equal(delayedTimer.ms, 3000, 'automatic hosted sync remains debounced');
  delayedTimer.fn();
  for (let turn = 0; turn < 100 && !state['magnetar-sync-hosted-checkpoint']?.canonical?.saved?.[`hash:${delayedHash}`]; turn += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok(state['magnetar-sync-hosted-checkpoint']?.canonical?.saved?.[`hash:${delayedHash}`], 'the first automatic transaction must persist its checkpoint before the delayed pull');
  assert.equal(exclusiveRuns, 1, 'delayed automatic hosted sync must enter the canonical lock');
  assert.ok(hostedPayload.sections.saved.items.some(value => value.hash === delayedHash), 'delayed automatic hosted sync must push the fresh canonical Web record');
  assert.ok(hostedPayload.sections.saved.items.some(value => value.hash === missingTimestampHash), 'a stale Mobile presence snapshot must not delete a new Web record lacking adapter timestamps');

  hostedPayload.sections.saved.items = hostedPayload.sections.saved.items.filter(value => ![delayedHash, missingTimestampHash].includes(value.hash));
  revision += 1;
  const delayedAutoPull = await context.MagnetarSyncData.maybePullLatest('physical-five-minute-delay', { force: true });
  assert.equal(delayedAutoPull.ok, true, 'the actual automatic Mobile handler must execute after the delay');
  assert.ok(state['magnetar-saved'].some(value => value.hash === delayedHash), 'a stale presence-only Mobile pull must retain a newer timestamped Web record');
  assert.ok(state['magnetar-saved'].some(value => value.hash === missingTimestampHash), 'a stale presence-only Mobile pull must retain a Web record without adapter timestamps');

  state['magnetar-saved'] = state['magnetar-saved'].filter(value => value.hash !== delayedHash);
  const explicitDelete = await context.MagnetarSyncData.pushSavedAndHistory({ manual: true, reason: 'self-hosted-delete-propagation' });
  assert.equal(explicitDelete.ok, true);
  assert.equal(hostedPayload.sections.saved.items.some(value => value.hash === delayedHash), false, 'canonical deletion must remove the Hosted live record');
  assert.ok(hostedPayload.sections.saved.tombstones.some(value => value.stableKey === `hash:${delayedHash}`), 'canonical deletion must be transported explicitly for Android');

  const greenDayHash = '67833d8b6c74ce2a2e9b0f95e209450284533a52';
  const greenDayParentKey = 'provider:realdebrid:U4CPS3ZV5HB7K';
  hostedPayload.sections.organisedFolders = section([
    folder('loppytrot', 'loppytrot', 0, [{
      id: 'android-green-day-file-7',
      kind: 'provider-file',
      provider: 'realdebrid',
      providerItemId: 'U4CPS3ZV5HB7K',
      providerItemKey: 'realdebrid:U4CPS3ZV5HB7K',
      parentItemKey: greenDayParentKey,
      providerFileId: '7',
      fileId: '7',
      filePath: 'Green Day - Saviors/07 - Corvette Summer.mp3',
      hash: greenDayHash,
      title: '07 - Corvette Summer.mp3',
      order: 0,
      addedAt: now + 400_000,
      updatedAt: now + 400_000,
    }], now + 400_000),
  ], [], now + 400_000);
  revision += 1;
  await context.MagnetarSyncData.pullSavedAndHistory({ manual: true, reason: 'android-child-membership' });
  const greenDayFolder = state['magnetar-organised-folders'].folders.find(value => value.id === 'loppytrot');
  assert.equal(greenDayFolder.items.length, 1, 'one Android child must remain one canonical extension membership');
  assert.equal(greenDayFolder.items[0].stableKey, `provider-file:${greenDayParentKey}:7`);
  const greenDayToSelf = context.MagnetarSelfHostedSync.reconcile({
    local: { saved: state['magnetar-saved'], history: state['magnetar-history'], folders: state['magnetar-organised-folders'] },
    serverSnapshot: { saved: [], folders: [], history: [], historyEvents: [], tombstones: { saved: [], folders: [], assignments: [] } },
    checkpoint: null,
    now: now + 400_001,
  });
  const greenDayAssignments = greenDayToSelf.mutations.filter(mutation => mutation.type === 'assignment.upsert' && mutation.record.folderId === 'loppytrot');
  assert.equal(greenDayAssignments.length, 1, 'extension to Self-Hosted projection must produce exactly one membership mutation');
  assert.equal(greenDayAssignments[0].record.stableKey, `provider-file:${greenDayParentKey}:7`);

  const repairedAliases = context.MagnetarSelfHostedSync.reconcileReplicas({
    local: { saved: [], history: [], folders: { folders: [folder('alias-folder', 'loppytrot alias repair', 0, [
      { stableKey: `hash:${greenDayHash}`, hash: greenDayHash, title: 'Legacy hash alias', updatedAt: now + 1 },
      { stableKey: 'provider:realdebrid:U4CPS3ZV5HB7K', hash: greenDayHash, title: 'Provider item', updatedAt: now + 2 },
    ], now + 2)], deletedFolders: [] } },
    remotes: [], checkpoint: null, now: now + 500_000,
  });
  assert.equal(repairedAliases.canonical.assignments[`alias-folder|hash:${greenDayHash}`].deleted, true, 'legacy hash alias must become a tombstone when the precise assignment exists');
  assert.equal(repairedAliases.local.folders.folders[0].items.length, 1, 'alias repair must project one live membership');
  assert.equal(repairedAliases.local.folders.folders[0].items[0].stableKey, 'provider:realdebrid:U4CPS3ZV5HB7K');

  const distinctChildren = context.MagnetarSelfHostedSync.reconcileReplicas({
    local: { saved: [], history: [], folders: { folders: [folder('siblings-folder', 'Distinct siblings', 0, [
      { stableKey: `provider-file:${greenDayParentKey}:7`, hash: greenDayHash, title: 'Sibling 7', updatedAt: now + 3 },
      { stableKey: `provider-file:${greenDayParentKey}:8`, hash: greenDayHash, title: 'Sibling 8', updatedAt: now + 4 },
    ], now + 4)], deletedFolders: [] } },
    remotes: [], checkpoint: null, now: now + 500_001,
  });
  assert.equal(distinctChildren.local.folders.folders[0].items.length, 2, 'two precise child identities sharing a parent hash must remain distinct');

  const reconciledFolderIds = context.MagnetarSelfHostedSync.reconcileReplicas({
    local: { saved: [], history: [], folders: { folders: [folder('extension-folder', 'Same Folder', 0, [item('hash:local')], now + 5)], deletedFolders: [] } },
    remotes: [{ id: 'selfHosted', state: { _canonicalSync: {
      saved: {}, historyEventIds: [],
      folders: { 'server-folder': { id: 'server-folder', name: 'same folder', color: 'blue', order: 2, updatedAt: now + 6 } },
      assignments: { 'server-folder|hash:remote': { folderId: 'server-folder', stableKey: 'hash:remote', displayName: 'Remote item', hash: 'remote', order: 0, updatedAt: now + 6 } },
    } } }],
    checkpoint: null, now: now + 500_002,
  });
  assert.equal(reconciledFolderIds.canonical.folders['server-folder'].deleted, true, 'remote same-name folder identity must be retired');
  assert.equal(reconciledFolderIds.local.folders.folders.filter(value => value.name.toLowerCase() === 'same folder').length, 1);
  assert.deepEqual(reconciledFolderIds.local.folders.folders[0].items.map(value => value.stableKey).sort(), ['hash:local', 'hash:remote']);

  console.log('Canonical hosted/self-hosted peer adapter checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });


