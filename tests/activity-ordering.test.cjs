const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const chromeSource = readFileSync(new URL('../chrome/content.js', `file://${__filename.replace(/\\/g, '/')}`), 'utf8');
const firefoxSource = readFileSync(new URL('../firefox/content.js', `file://${__filename.replace(/\\/g, '/')}`), 'utf8');

function orderingBlock(source) {
  const start = source.indexOf('  function chronologicalTimestamp');
  const end = source.indexOf('  function formatRelative', start);
  assert.notEqual(start, -1, 'timestamp ordering helpers are present');
  assert.notEqual(end, -1, 'timestamp ordering helper boundary is present');
  return source.slice(start, end);
}

function orderingApi(source) {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${orderingBlock(source)}\nglobalThis.ordering = { sortSavedBySavedAt, sortHistoryBySentAt, savedItemTimestamp, historySentTimestamp };`, context);
  return context.ordering;
}

test('expanded Saved for Later sorts newest saved timestamp first without mutating storage order', () => {
  const { sortSavedBySavedAt } = orderingApi(chromeSource);
  const stored = [
    { id: 'legacy-seconds', savedAt: 1_700_000_000 },
    { id: 'newest-iso', savedAt: '2026-07-24T12:00:00.000Z' },
    { id: 'middle-created', createdAt: Date.parse('2025-01-01T00:00:00.000Z') },
    { id: 'unknown' }
  ];
  assert.deepEqual(Array.from(sortSavedBySavedAt(stored), item => item.id), ['newest-iso', 'middle-created', 'legacy-seconds', 'unknown']);
  assert.deepEqual(stored.map(item => item.id), ['legacy-seconds', 'newest-iso', 'middle-created', 'unknown']);
});

test('expanded History sorts newest sent timestamp first and prefers lastSentAt', () => {
  const { sortHistoryBySentAt } = orderingApi(chromeSource);
  const history = [
    { id: 'older', lastSentAt: Date.parse('2025-01-01T00:00:00.000Z') },
    { id: 'newest', sentAt: '2026-07-24T14:00:00.000Z' },
    { id: 'resent', lastSentAt: Date.parse('2026-01-01T00:00:00.000Z'), timestamp: Date.parse('2030-01-01T00:00:00.000Z') },
    { id: 'unknown' }
  ];
  assert.deepEqual(Array.from(sortHistoryBySentAt(history), item => item.id), ['newest', 'resent', 'older', 'unknown']);
});

test('Chrome and Firefox use identical ordering and both expanded render paths apply it', () => {
  assert.equal(orderingBlock(chromeSource), orderingBlock(firefoxSource));
  for (const source of [chromeSource, firefoxSource]) {
    assert.equal((source.match(/sortSavedBySavedAt\(/g) || []).length, 3);
    assert.equal((source.match(/sortHistoryBySentAt\(/g) || []).length, 3);
    assert.equal((source.match(/formatRelative\(savedItemTimestamp\(s\)\)/g) || []).length, 2);
    assert.equal((source.match(/formatRelative\(historySentTimestamp\(h\)\)/g) || []).length, 2);
  }
});
