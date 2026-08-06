const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const chromeContent = read('chrome', 'content.js');
const firefoxContent = read('firefox', 'content.js');
const chromePage = read('chrome', 'whatsnew.html');
const firefoxPage = read('firefox', 'whatsnew.html');
const chromeMessages = JSON.parse(read('chrome', '_locales', 'en', 'messages.json'));
const firefoxMessages = JSON.parse(read('firefox', '_locales', 'en', 'messages.json'));

test('Chrome and Firefox keep the What’s New ecosystem UI identical', () => {
  assert.equal(chromeContent, firefoxContent);
  assert.equal(chromePage, firefoxPage);
  assert.deepEqual(chromeMessages, firefoxMessages);
});

test('the six-card layout now includes ecosystem sync and My Magnetar', () => {
  const features = chromeContent.slice(
    chromeContent.indexOf('const WHATS_NEW_FEATURES'),
    chromeContent.indexOf('function getWhatsNewFeature')
  );
  assert.equal((features.match(/{ id:/g) || []).length, 6);
  assert.match(features, /id: 'sync'.*whatsNewEcosystemTitle/);
  assert.match(features, /id: 'my-magnetar'.*whatsNewMyMagnetarTitle/);
  assert.doesNotMatch(features, /id: 'green'/);
  assert.match(chromeContent, /server: '<svg/);
});

test('ecosystem wording accurately covers two-way and three-way sync', () => {
  assert.equal(chromeMessages.whatsNewEcosystemIntro.message, 'Magnetar, Magnetar Mobile and My Magnetar now work together.');
  assert.match(chromeMessages.whatsNewEcosystemTeaser.message, /Mobile, My Magnetar or both/);
  assert.match(chromeMessages.whatsNewEcosystemSyncNote.message, /Use any two together, or connect all three through the extension/);
  assert.match(chromeMessages.whatsNewEcosystemSyncNote.message, /Saved, Sent and Organised folder information/);
  assert.match(chromeMessages.whatsNewMyMagnetarPrivacy.message, /Provider credentials stay local/);
  assert.match(chromePage, /Sync your ecosystem/);
  assert.match(chromePage, /My Magnetar/);
});

test('the former Maybe Later slot opens the existing My Magnetar panel', () => {
  assert.match(chromeContent, /data-whats-new-my-magnetar[^>]*>\$\{escapeHtml\(t\('whatsNewOpenMyMagnetar'\)\)\}/);
  assert.doesNotMatch(chromeContent, /data-whats-new-later/);
  assert.match(chromeContent, /querySelector\('\[data-whats-new-my-magnetar\]'\)[\s\S]*closeWhatsNewTour\(\{ dismiss: true, restore: true \}\)[\s\S]*getElementById\('magnetar-banner-my-magnetar'\)\?\.click\(\)/);
  assert.equal(chromeMessages.whatsNewOpenMyMagnetar.message, 'Open My Magnetar');
});
