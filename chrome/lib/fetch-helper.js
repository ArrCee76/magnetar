/**
 * Magnetar — fetch helper with timeout and consistent error semantics.
 *
 * Wraps fetch() with an AbortController so a stalled request fails after
 * 12 seconds instead of hanging the UI. Used by every provider's
 * validateCredentials, sendMagnet, and checkCache so a misbehaving network
 * (corporate firewall, ad blocker, region block, dead endpoint) never
 * leaves a Save & Test button stuck on "Testing" forever.
 *
 * Throws on timeout with a message users can act on. Provider code should
 * catch and return { valid: false, error: e.message } as usual.
 */
const FETCH_TIMEOUT_MS = 12000;

async function magnetarFetch(url, opts = {}) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), opts.timeout || FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('Connection timed out. Check your network or whether the service URL is reachable.');
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

if (typeof self !== 'undefined') self.magnetarFetch = magnetarFetch;
