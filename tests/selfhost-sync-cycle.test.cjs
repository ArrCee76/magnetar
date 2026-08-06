const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const background = fs.readFileSync(path.join(__dirname, '..', 'chrome', 'background.js'), 'utf8');
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1);
  const bodyStart = source.indexOf('{', start);
  let depth = 0; let quote = ''; let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error('unclosed function');
}
const synchroniseSource = extractFunction(background, 'synchroniseSelfHosted').replace(/^function /, 'async function ');

async function runCycle({ failPushes = 0 }) {
  const writes = [];
  const requests = [];
  let pushAttempts = 0;
  let reconcileCalls = 0;
  const engine = {
    stableStringify(value) { return JSON.stringify(value); },
    semanticDiff() { return null; },
    canonicaliseReplica() { return { saved: {}, folders: {}, assignments: {} }; },
    reconcile() {
      reconcileCalls += 1;
      return reconcileCalls === 1
        ? { mutations: [{ type: 'saved.upsert', record: { stableKey: 'hash:a', hash: 'a', displayName: 'A', updatedAt: 10 } }], canonical: { saved: {}, folders: {}, assignments: {}, historyEventIds: [] }, local: { saved: [{ name: 'A' }], history: [], folders: { folders: [] } } }
        : { mutations: [], canonical: { saved: {}, folders: {}, assignments: {}, historyEventIds: [] }, local: { saved: [{ name: 'A' }], history: [], folders: { folders: [] } } };
    },
    mutationId() { return 'stable-cycle-id'; },
  };
  const storageState = { 'magnetar-saved': [{ name: 'A' }], 'magnetar-history': [], 'magnetar-organised-folders': { folders: [] } };
  const storage = {
    async get() { return JSON.parse(JSON.stringify(storageState)); },
    async set(value) { Object.assign(storageState, JSON.parse(JSON.stringify(value))); writes.push(JSON.parse(JSON.stringify(value))); },
  };
  async function request(route, options = {}) {
    requests.push({ route, body: options.body && JSON.parse(JSON.stringify(options.body)) });
    if (route.includes('/sync/changes')) return { cursor: route.includes('cursor=0') ? 4 : 5, snapshot: {} };
    if (route === '/api/v1/sync/push') {
      pushAttempts += 1;
      if (pushAttempts <= failPushes) throw new Error('network unavailable');
      return { cursor: 5, applied: 1, noops: 0 };
    }
    return { ok: true };
  }
  const context = { console, Date, Number, Error, globalThis: null, MagnetarSelfHostedSync: engine, MAGNETAR_API: { storage: { local: storage } }, selfHostedRequest: request, SELF_HOSTED_STORAGE_KEY: 'connection' };
  context.globalThis = context;
  vm.runInNewContext(`${synchroniseSource}; globalThis.run = synchroniseSelfHosted;`, context);
  try {
    const result = await context.run({ token: 'token', deviceId: 'device', cursor: 0, apiVersion: 2, capabilities: ['sync.mutations-v2'] });
    return { result, writes, requests, error: null };
  } catch (error) {
    return { result: null, writes, requests, error };
  }
}

(async () => {
  const recovered = await runCycle({ failPushes: 1 });
  const pushes = recovered.requests.filter(item => item.route === '/api/v1/sync/push');
  assert.equal(pushes.length, 2, 'one transient network failure is retried');
  assert.deepEqual(pushes[0].body, pushes[1].body, 'retry reuses the exact mutation body and idempotency identity');
  assert.equal(pushes[0].body.mutationId, 'stable-cycle-id');
  assert.equal(recovered.writes.some(item => item.connection?.checkpoint), true, 'checkpoint is stored after final verification');

  const interrupted = await runCycle({ failPushes: 2 });
  assert.ok(interrupted.error, 'persistent network failure aborts the cycle');
  assert.equal(interrupted.writes.some(item => item.connection?.checkpoint), false, 'interrupted sync never advances its checkpoint');

  console.log('My Magnetar sync cycle retry and checkpoint checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
