/**
 * Magnetar API shim
 *
 * Prefer the WebExtension Promise API (`browser`) everywhere. Chromium gets it
 * from browser-polyfill; Firefox has it natively. We also expose it as
 * MAGNETAR_API so the rest of the code never depends on Firefox's callback-
 * style `chrome.*` alias.
 */
var MAGNETAR_API;
(function () {
  var root = (typeof globalThis !== 'undefined' && globalThis)
          || (typeof self !== 'undefined' && self)
          || (typeof window !== 'undefined' && window);
  if (!root) return;

  var api = (root.browser && root.browser.runtime) ? root.browser : root.chrome;
  MAGNETAR_API = api;
  root.MAGNETAR_API = api;

  // Best-effort backwards compatibility for any remaining chrome.* references.
  if (api && root.browser && root.browser.runtime) {
    try {
      Object.defineProperty(root, 'chrome', {
        value: api,
        writable: true,
        configurable: true
      });
    } catch (e) {
      try { root.chrome = api; } catch (_) {}
    }
  }
})();
