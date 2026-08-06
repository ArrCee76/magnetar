const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'chrome', 'background.js'), 'utf8');
const engineSource = fs.readFileSync(path.join(root, 'chrome', 'lib', 'selfhost-sync.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`); assert.notEqual(start, -1);
  const bodyStart = source.indexOf('{', start); let depth = 0; let quote = ''; let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed ${name}`);
}

const context = { console, Date, JSON, Math, Number, Object, String, Set, Map, URL, Error, globalThis: null };
context.globalThis = context;
vm.runInNewContext(engineSource, context);
const engine = context.MagnetarSelfHostedSync;
const synchroniseSource = extractFunction(background, 'synchroniseSelfHosted').replace(/^function /, 'async function ');
const emptyLocal = () => ({ saved: [], history: [], folders: { version: 1, folders: [], deletedFolders: [] } });
const emptyServer = () => ({ saved: [], history: [], historyEvents: [], folders: [], tombstones: { saved: [], folders: [], assignments: [] } });
const iso = value => new Date(value).toISOString();
const clone = value => JSON.parse(JSON.stringify(value));
const hashA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

async function serverOnlyCycle(baseSnapshot, changedSnapshot, options = {}) {
  const initial = engine.reconcile({ local: options.initialLocal || emptyLocal(), serverSnapshot: baseSnapshot, now: 100 });
  const storageState = {
    'magnetar-saved': clone(initial.local.saved),
    'magnetar-history': clone(initial.local.history),
    'magnetar-organised-folders': clone(initial.local.folders),
  };
  const writes = []; const requests = [];
  const storage = {
    async get() { return clone(storageState); },
    async set(value) {
      Object.assign(storageState, clone(value));
      if (options.listenerMutation && value['magnetar-saved']) storageState['magnetar-saved'] = storageState['magnetar-saved'].map(item => ({ ...item, uiExpanded: true }));
      writes.push(clone(value));
    },
  };
  async function request(route, requestOptions = {}) {
    requests.push({ route, body: clone(requestOptions.body || null) });
    if (options.offline && route.startsWith('/api/v1/sync/changes')) throw new Error('My Magnetar could not be reached.');
    if (route.startsWith('/api/v1/sync/changes')) return { schemaVersion: 'magnetar-self-hosted-sync-v2', cursor: options.sameCursor ? 1 : 2, snapshot: clone(changedSnapshot) };
    if (route === '/api/v1/sync/push') throw new Error('A server-only change must not produce an outgoing mutation.');
    if (route === '/api/v1/sync/ack') return { ok: true };
    throw new Error(`Unexpected route ${route}`);
  }
  const cycleContext = { console, Date, JSON, Math, Number, Object, String, Set, Map, URL, Error, globalThis: null, MagnetarSelfHostedSync: engine, selfHostedRequest: request, MAGNETAR_API: { storage: { local: storage } }, SELF_HOSTED_STORAGE_KEY: 'connection' };
  cycleContext.globalThis = cycleContext;
  vm.runInNewContext(`${synchroniseSource}; globalThis.run = synchroniseSelfHosted;`, cycleContext);
  const connection = { token: 'token', deviceId: 'device', cursor: 1, apiVersion: 2, schemaVersion: 'magnetar-self-hosted-sync-v2', capabilities: ['sync.mutations-v2'], checkpoint: { schemaVersion: 4, canonical: initial.canonical } };
  try { return { result: await cycleContext.run(connection), storageState, writes, requests, initial, error: null }; }
  catch (error) { return { result: null, storageState, writes, requests, initial, error }; }
}

(async () => {
  const savedAdd = await serverOnlyCycle(emptyServer(), { ...emptyServer(), saved: [{ stableKey: `hash:${hashA}`, hash: hashA, magnet: `magnet:?xt=urn:btih:${hashA}`, displayName: 'Remote saved', savedAt: iso(200), updatedAt: iso(200) }] });
  assert.equal(savedAdd.error, null); assert.equal(savedAdd.result.changed, true); assert.equal(savedAdd.storageState['magnetar-saved'][0].name, 'Remote saved');
  assert.match(savedAdd.storageState['magnetar-saved'][0].magnet, /^magnet:/, 'hash/magnet Saved data survives projection');

  const urlAdd = await serverOnlyCycle(emptyServer(), { ...emptyServer(), saved: [{ stableKey: 'url:https://example.test/item', sourceUrl: 'https://example.test/item', displayName: 'URL item', savedAt: iso(200), updatedAt: iso(200) }] });
  assert.equal(urlAdd.error, null); assert.equal(urlAdd.storageState['magnetar-saved'][0].sourceUrl, 'https://example.test/item');

  const savedBase = { ...emptyServer(), saved: [{ stableKey: `hash:${hashA}`, hash: hashA, displayName: 'Delete me', savedAt: iso(100), updatedAt: iso(100) }] };
  const savedDelete = await serverOnlyCycle(savedBase, { ...emptyServer(), tombstones: { saved: [{ stableKey: `hash:${hashA}`, deletedAt: iso(200) }], folders: [], assignments: [] } });
  assert.equal(savedDelete.error, null); assert.equal(savedDelete.storageState['magnetar-saved'].length, 0);

  const folderCreate = await serverOnlyCycle(emptyServer(), { ...emptyServer(), folders: [{ id: 'remote-folder', name: 'Remote folder', color: 'blue', sortOrder: 4, updatedAt: iso(200), items: [] }] });
  assert.equal(folderCreate.error, null); assert.deepEqual(folderCreate.storageState['magnetar-organised-folders'].folders.map(folder => [folder.id, folder.order]), [['remote-folder', 4]]);

  const folderBase = { ...emptyServer(), folders: [{ id: 'f1', name: 'Before', color: 'sage', sortOrder: 1, updatedAt: iso(100), items: [] }] };
  const folderRename = await serverOnlyCycle(folderBase, { ...emptyServer(), folders: [{ id: 'f1', name: 'After', color: 'sage', sortOrder: 7, updatedAt: iso(200), items: [] }] });
  assert.equal(folderRename.error, null); assert.equal(folderRename.storageState['magnetar-organised-folders'].folders[0].name, 'After'); assert.equal(folderRename.storageState['magnetar-organised-folders'].folders[0].order, 7);

  const folderDelete = await serverOnlyCycle(folderBase, { ...emptyServer(), tombstones: { saved: [], assignments: [], folders: [{ id: 'f1', deletedAt: iso(200) }] } });
  assert.equal(folderDelete.error, null); assert.equal(folderDelete.storageState['magnetar-organised-folders'].folders.length, 0); assert.equal(folderDelete.storageState['magnetar-organised-folders'].deletedFolders[0].id, 'f1');

  const assignmentAddSnapshot = { ...emptyServer(), folders: [{ id: 'f1', name: 'Remote', color: 'default', sortOrder: 0, updatedAt: iso(100), items: [{ stableKey: 'remote:provider:item-1', displayName: 'Provider item', sortOrder: 3, updatedAt: iso(200) }] }] };
  const assignmentAdd = await serverOnlyCycle(folderBase, assignmentAddSnapshot);
  assert.equal(assignmentAdd.error, null); assert.equal(assignmentAdd.storageState['magnetar-organised-folders'].folders[0].items[0].stableKey, 'remote:provider:item-1'); assert.equal(assignmentAdd.storageState['magnetar-organised-folders'].folders[0].items[0].order, 3);

  const assignmentDelete = await serverOnlyCycle(assignmentAddSnapshot, { ...emptyServer(), folders: [{ id: 'f1', name: 'Remote', color: 'default', sortOrder: 0, updatedAt: iso(100), items: [] }], tombstones: { saved: [], folders: [], assignments: [{ folderId: 'f1', stableKey: 'remote:provider:item-1', deletedAt: iso(300) }] } });
  assert.equal(assignmentDelete.error, null); assert.equal(assignmentDelete.storageState['magnetar-organised-folders'].folders[0].items.length, 0);

  const historySnapshot = { ...emptyServer(), history: [{ stableKey: `hash:${hashA}`, displayName: 'Server send', hash: hashA, provider: 'torbox', destinationName: 'TorBox', sentAt: iso(200), sendCount: 1 }], historyEvents: [{ eventId: 'server-event-1', stableKey: `hash:${hashA}`, displayName: 'Server send', hash: hashA, provider: 'torbox', destinationName: 'TorBox', attemptedAt: iso(200), sendCount: 1 }] };
  const historyImport = await serverOnlyCycle(emptyServer(), historySnapshot);
  assert.equal(historyImport.error, null); assert.equal(historyImport.storageState['magnetar-history'].length, 1); assert.deepEqual(historyImport.storageState['magnetar-history'][0]._selfHostedSync.eventIds, ['server-event-1']);
  assert.equal(historyImport.requests.some(request => request.route === '/api/v1/sync/push'), false, 'server History imports without echoing history.append');

  const noOp = await serverOnlyCycle(historySnapshot, historySnapshot, { sameCursor: true });
  assert.equal(noOp.error, null); assert.equal(noOp.result.changed, false); assert.equal(noOp.result.cursor, 1); assert.equal(noOp.requests.some(request => request.route === '/api/v1/sync/push'), false);

  const listenerSafe = await serverOnlyCycle(emptyServer(), { ...emptyServer(), saved: [{ stableKey: `hash:${hashA}`, hash: hashA, displayName: 'Listener-safe', savedAt: iso(200), updatedAt: iso(200) }] }, { listenerMutation: true });
  assert.equal(listenerSafe.error, null, 'local UI-only listener metadata is excluded from convergence semantics');

  const offline = await serverOnlyCycle(emptyServer(), emptyServer(), { offline: true });
  assert.match(offline.error.message, /could not be reached/i); assert.equal(offline.writes.some(write => write.connection?.checkpoint), false);

  const originalMismatch = engine.semanticDiff({ saved: {}, folders: {}, assignments: {}, historyEventIds: ['client-event-1'] }, { saved: {}, folders: {}, assignments: {}, historyEventIds: ['extension-pair-client-event-1'] }, 'final-pull-canonicalisation');
  assert.deepEqual(JSON.parse(JSON.stringify(originalMismatch)), { code: 'SYNC_NOT_CONVERGED', entity: 'history', id: 'client-event-1', field: 'eventId', local: false, server: true, phase: 'final-pull-canonicalisation' });

  console.log('My Magnetar server-to-extension convergence checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
