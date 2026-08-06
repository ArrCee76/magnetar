const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const chromeContent = read('chrome', 'content.js');
const firefoxContent = read('firefox', 'content.js');
const chromeCss = read('chrome', 'content.css');
const firefoxCss = read('firefox', 'content.css');

function shareMenuTemplate(source) {
  const start = source.indexOf('menu.innerHTML = `', source.indexOf('async function handleShare'));
  const end = source.indexOf('`;', start);
  assert.notEqual(start, -1, 'Missing share menu template');
  assert.notEqual(end, -1, 'Unclosed share menu template');
  return source.slice(start, end + 2);
}

test('Chrome and Firefox keep the mirrored share UI identical', () => {
  assert.equal(chromeContent, firefoxContent);
  assert.equal(chromeCss, firefoxCss);
});

test('the main toolbar no longer renders or binds a top-level Share control', () => {
  assert.doesNotMatch(chromeContent, /id=["']magnetar-share["']/);
  assert.doesNotMatch(chromeContent, /querySelector\(["']#magnetar-share["']\)/);
  assert.match(chromeContent, /id="magnetar-save"[\s\S]*id="magnetar-mobile-sync-open"[\s\S]*id="magnetar-banner-my-magnetar"/);
});

test('all five share entries use local inline SVGs and accessible native buttons', () => {
  const menu = shareMenuTemplate(chromeContent);
  for (const [action, label] of [
    ['email', 'shareEmail'],
    ['x', 'shareX'],
    ['reddit', 'shareReddit'],
    ['telegram', 'shareTelegram'],
    ['copy', 'shareCopyLink'],
  ]) {
    assert.match(menu, new RegExp(`<button type="button" class="magnetar-share-item" data-action="${action}"[^>]*aria-label="\\$\\{t\\('${label}'\\)\\}"`));
    assert.match(menu, new RegExp(`shareMenuIconSvg\\('${action}'\\)`));
  }
  assert.equal((menu.match(/class="magnetar-share-icon"/g) || []).length, 5);
  assert.doesNotMatch(menu, /magnetar-share-icon[^>]*>\?+/);
  assert.doesNotMatch(menu, /<img|https?:|url\(/i);
  assert.match(chromeContent, /function shareMenuIconSvg\(action\)[\s\S]*email: '<svg[\s\S]*x: '<svg[\s\S]*reddit: '<svg[\s\S]*telegram: '<svg[\s\S]*copy: '<svg/);
  assert.match(chromeCss, /#magnetar-share-menu \.magnetar-share-icon svg[\s\S]*width: 15px;[\s\S]*height: 15px;/);
  assert.match(chromeCss, /#magnetar-share-menu \.magnetar-share-item:focus-visible/);
});

test('Saved share entry points remain bound to the shared dropdown', () => {
  assert.ok((chromeContent.match(/querySelectorAll\('\.magnetar-saved-share'\)/g) || []).length >= 2);
  assert.ok((chromeContent.match(/handleShare\(\{/g) || []).length >= 2);
});

test('share actions and generated destinations are unchanged', () => {
  for (const expected of [
    'mailto:?subject=${encodedName}&body=${encodeURIComponent(t(\'shareEmailSubject\'))}%3A%0A%0A${encodedMagnet}%0A%0A${encodedPage}',
    'https://x.com/intent/tweet?text=${encodedName}&url=${encodedPage}',
    'https://reddit.com/submit?url=${encodedPage}&title=${encodedName}',
    'https://t.me/share/url?url=${encodedMagnet}&text=${encodedName}',
    "await handleCopy(magnetUri, t('magnetLinkCopied'))",
  ]) assert.ok(chromeContent.includes(expected), `Missing unchanged share action: ${expected}`);
});

