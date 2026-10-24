/**
 * Bounded Real-Debrid status polling and viewport-safe tooltip placement.
 * This module performs no provider requests itself; callers supply the
 * background-message request function, keeping credentials out of content.
 */
const MagnetarRealDebridStatus = (() => {
  const POLL_DELAYS_MS = [1000, 2000, 4000, 8000, 10000, 10000];
  const DEFAULT_TIMEOUT_MS = 60000;

  function positionTooltip(anchor, tooltip, viewportWidth, viewportHeight, margin = 12) {
    const maxLeft = Math.max(margin, viewportWidth - tooltip.width - margin);
    const left = Math.max(margin, Math.min(anchor.left + anchor.width / 2 - tooltip.width / 2, maxLeft));
    const above = anchor.top - tooltip.height - 8;
    const top = above >= margin ? above : Math.min(viewportHeight - tooltip.height - margin, anchor.bottom + 8);
    return { left, top: Math.max(margin, top) };
  }

  async function poll(torrentId, requestStatus, onStatus, options = {}) {
    const now = options.now || Date.now;
    const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
    const maxRequestMs = Math.max(1000, Number(options.requestTimeoutMs) || 5000);
    const delays = Array.isArray(options.delays) ? options.delays : POLL_DELAYS_MS;
    const deadline = now() + timeoutMs;
    let current = 'checking';
    onStatus(current);

    for (let attempt = 0; attempt < delays.length && now() < deadline; attempt++) {
      const remaining = deadline - now();
      let result = null;
      try {
        result = await requestStatus(torrentId, Math.max(1000, Math.min(maxRequestMs, remaining)));
      } catch (_) {}

      if (result?.ok) {
        if (result.status === 'downloaded' && result.ready === true) {
          current = 'ready';
          break;
        }
        if (result.status === 'downloading') current = 'downloading';
        else if (result.status === 'queued') current = 'queued';
        else if (['error', 'virus', 'dead', 'magnet_error'].includes(result.status)) {
          current = 'sent';
          break;
        }
        else current = 'checking';
        onStatus(current);
      }

      if (attempt < delays.length - 1) {
        const waitMs = Math.max(Number(delays[attempt]) || 0, Number(result?.retryAfterMs) || 0);
        if (waitMs >= deadline - now()) break;
        await sleep(waitMs);
      }
    }

    if (current !== 'ready' && !['downloading', 'queued'].includes(current)) current = 'sent';
    onStatus(current);
    return current;
  }

  return { poll, positionTooltip };
})();

if (typeof self !== 'undefined') self.MagnetarRealDebridStatus = MagnetarRealDebridStatus;
