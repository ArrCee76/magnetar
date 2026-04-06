/**
 * Magnetar — What's New Script
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Show version
  const manifest = chrome.runtime.getManifest();
  document.getElementById('whatsnew-version').textContent = `v${manifest.version}`;

  // Dismiss and close
  document.getElementById('whatsnew-close').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'dismiss-whatsnew' });
    window.close();
  });

  // Mark as seen
  await chrome.runtime.sendMessage({ type: 'dismiss-whatsnew' });
});
