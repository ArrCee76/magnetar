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

const synchroniseSource = extractFunction(background, 'synchroniseSelfHosted').replace(/^function /, 'async function ');
const hash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
let cursor = 4;
let serverFolder = {
  id: 'server-audiobooks', name: 'Audiobooks', color: 'sage', sortOrder: 4,
  updatedAt: new Date(100).toISOString(), items: [],
};
const processed = new Map();
const pushBodies = [];
const writes = [];
let lostResponse = true;

function snapshot() {
  return { saved: [], history: [], historyEvents: [], folders: [JSON.parse(JSON.stringify(serverFolder))], tombstones: { saved: [], folders: [], assignments: [] } };
}

async function request(route, options = {}) {
  if (route.startsWith('/api/v1/sync/changes')) return { schemaVersion: 'magnetar-self-hosted-sync-v2', cursor, snapshot: snapshot() };
  if (route === '/api/v1/sync/push') {
    const body = JSON.parse(JSON.stringify(options.body)); pushBodies.push(body);
    if (processed.has(body.mutationId)) return { ...processed.get(body.mutationId), duplicate: true };
    assert.equal(body.mutations.some(item => item.record?.id === 'local-audiobooks' || item.record?.folderId === 'local-audiobooks'), false, 'losing identity must never reach the server');
    for (const mutation of body.mutations) {
      if (mutation.type === 'folder.upsert') serverFolder = { ...serverFolder, id: mutation.record.id, name: mutation.record.name, color: mutation.record.color, sortOrder: mutation.record.order, updatedAt: new Date(mutation.record.updatedAt).toISOString() };
      if (mutation.type === 'assignment.upsert') serverFolder.items.push({ stableKey: mutation.record.stableKey, hash: mutation.record.hash, displayName: mutation.record.displayName, sortOrder: mutation.record.order, updatedAt: new Date(mutation.record.updatedAt).toISOString() });
      cursor += 1;
    }
    const response = { cursor, applied: body.mutations.length, noops: 0, duplicate: false };
    processed.set(body.mutationId, response);
    if (lostResponse) { lostResponse = false; throw new Error('response lost'); }
    return response;
  }
  if (route === '/api/v1/sync/ack') return { ok: true, cursor };
  throw new Error(`Unexpected route ${route}`);
}

const storageState = {
  'magnetar-saved': [], 'magnetar-history': [],
  'magnetar-organised-folders': { version: 1, folders: [{ id: 'local-audiobooks', name: 'Audiobooks', color: 'blue', order: 1, updatedAt: 200, items: [{ hash, displayName: 'Local book', updatedAt: 200 }] }], deletedFolders: [] },
};
const storage = {
  async get() { return JSON.parse(JSON.stringify(storageState)); },
  async set(value) { Object.assign(storageState, JSON.parse(JSON.stringify(value))); writes.push(JSON.parse(JSON.stringify(value))); },
};

const context = { console, Date, JSON, Math, Number, Object, String, Set, Map, URL, Error, selfHostedRequest: request, MAGNETAR_API: { storage: { local: storage } }, SELF_HOSTED_STORAGE_KEY: 'connection', globalThis: null };
context.globalThis = context;
vm.runInNewContext(engineSource, context);
vm.runInNewContext(`${synchroniseSource}; globalThis.run = synchroniseSelfHosted;`, context);

(async () => {
  const result = await context.run({ token: 'token', deviceId: 'device', cursor: 0, apiVersion: 2, schemaVersion: 'magnetar-self-hosted-sync-v2', capabilities: ['sync.mutations-v2'] });
  assert.equal(result.ok, true);
  assert.equal(pushBodies.length, 2, 'a lost response retries once');
  assert.deepEqual(pushBodies[0], pushBodies[1], 'lost-response retry reuses the exact deterministic batch and mutation ID');
  assert.equal(serverFolder.id, 'server-audiobooks');
  assert.equal(serverFolder.items.length, 1);
  const localWrite = writes.find(value => value['magnetar-organised-folders']);
  assert.equal(localWrite['magnetar-organised-folders'].folders[0].id, 'server-audiobooks');
  assert.equal(writes.some(value => value.connection?.checkpoint), true, 'checkpoint is saved only after final verification');
  console.log('My Magnetar first-sync folder identity integration checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
