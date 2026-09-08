const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { webcrypto } = require('node:crypto');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
// Match corrupt byte-decoding signatures, not legitimate standalone accented letters.
const mojibake = /\ufffd|\u00ef\u00bf\u00bd|\u00c2[\u0080-\u00bf]|\u00c3[\u0080-\u00bf]|\u00e2(?:\u0080|[\u20ac\u201a\u201e\u2020\u02dc\u201d])|\u00f0\u0178|[\u0080-\u009f]/u;
const textFile = /\.(?:js|cjs|mjs|ts|tsx|html|css|json|svg|md|txt|ya?ml|ps1)$|(?:^|\/)(?:LICENSE|NOTICE|\.editorconfig|\.gitattributes)$/i;

test('all project source text is valid UTF-8 and contains no mojibake', () => {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter(file => file && !/^(?:dist|artifacts|\.tmp[^/]*)\//.test(file) && textFile.test(file));
  for (const file of files) {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(path.join(root, file)));
    assert.doesNotMatch(source, mojibake, file);
    if (file.endsWith('.json')) assert.doesNotThrow(() => JSON.parse(source), file);
    if (file.endsWith('.html')) assert.match(source.slice(0, 1024), /<meta\s+charset=["']UTF-8["']/i, file);
    // Also catch corrupted strings concealed by JS/JSON Unicode escapes or HTML entities.
    const decoded = source.replace(/\\u([0-9a-f]{4})|&#x([0-9a-f]+);|&#(\d+);/gi,
      (match, js, hex, dec) => String.fromCodePoint(parseInt(js || hex || dec, dec ? 10 : 16)));
    if (!file.startsWith('tests/')) assert.doesNotMatch(decoded, mojibake, file + ' escaped text');
  }
  console.log('UTF-8 audit: ' + files.length + ' project text files');
});

for (const browser of ['chrome', 'firefox']) {
  test(browser + ': Unicode survives magnet parsing, send normalization and encrypted sync', async () => {
    const context = vm.createContext({ TextEncoder, TextDecoder, Uint8Array, crypto: webcrypto, btoa, atob, URL, console });
    for (const file of ['detector', 'send-normalization', 'sync-contract', 'sync-crypto']) {
      vm.runInContext(fs.readFileSync(path.join(root, browser, 'lib', file + '.js'), 'utf8'), context);
    }
    const name = 'Björk · 日本語 — café → ✓ × 😀';
    const hash = '0123456789abcdef0123456789abcdef01234567';
    context.sample = { name, hash };
    assert.equal(vm.runInContext('MagnetarDetector.nameFromMagnet(MagnetarDetector.buildMagnet(sample.hash, sample.name))', context), name);
    const normalized = vm.runInContext('MagnetarSendNormalization.normalise({ item: sample })', context);
    assert.equal(new URL(normalized.magnetUri || normalized.magnet).searchParams.get('dn'), name);
    const cryptoApi = context.MagnetarSyncCrypto;
    const key = cryptoApi.generateEncryptionKey();
    const data = { saved: [{ name, hash }], history: [{ name, provider: 'Client · café' }] };
    const envelope = await cryptoApi.encryptJson(data, key);
    assert.deepEqual(JSON.parse(JSON.stringify(await cryptoApi.decryptJson(envelope, key))), data);
  });
}

for (const browser of ['chrome', 'firefox']) {
  test(browser + ': batch truncation preserves Unicode and escaped names', () => {
    const source = fs.readFileSync(path.join(root, browser, 'content.js'), 'utf8');
    const start = source.indexOf('    function buildRows(list)');
    const end = source.indexOf('\n    panel.innerHTML', start);
    const samples = [
      'x'.repeat(56) + '😀' + ' tail that will be truncated',
      '&'.repeat(56) + '<' + ' tail that will be truncated'
    ];
    for (const name of samples) {
      const magnets = [{ name, hash: 'a'.repeat(40), size: 850 * 1048576, seeders: 25 }];
      const context = vm.createContext({
        magnets, historyMap: {}, selectedHashes: new Set(), showCache: false,
        escapeHtml: value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
        t: value => value, formatSize: () => '850 MB'
      });
      const rendered = vm.runInContext(source.slice(start, end) + '\nbuildRows(magnets)', context);
      assert.match(rendered, /↑25 · 850 MB/);
      assert.doesNotMatch(rendered, /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
      const expected = context.escapeHtml(Array.from(name).slice(0, 57).join('') + '…');
      assert.ok(rendered.includes('>' + expected + '</span>'));
    }
  });
}
