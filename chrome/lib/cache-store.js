/**
 * Magnetar — Cache Store
 *
 * Tiered cache for `checkCache(hash, providerId)` results. Cuts API hammering
 * from the banner and batch panel. Three layers:
 *
 *   1. In-memory LRU (fastest, lives with the service worker)
 *   2. Persistent chrome.storage.local (survives SW restarts)
 *   3. In-flight promise dedup (10 parallel calls for same hash → 1 API hit)
 *
 * TTL policy is status-aware:
 *   - 'cached'     → 24 hours (RD/etc. rarely evict once something's there)
 *   - 'not_cached' →  5 minutes (torrents can become cached as others add them)
 *   - 'unknown'    →  0 — don't cache errors
 *
 * Cache key format: `${providerId}:${hash}` (lowercase hash).
 */

const MagnetarCacheStore = (() => {
  const MEM_LIMIT = 500;          // LRU cap for in-memory tier
  const PERSIST_LIMIT = 2000;     // cap for storage tier
  const TTL_CACHED = 24 * 60 * 60 * 1000;   // 24h
  const TTL_NOT_CACHED = 5 * 60 * 1000;     //  5m
  const STORAGE_KEY = 'magnetar-cache-store';

  // In-memory LRU. Map preserves insertion order, so we delete+reinsert on hit.
  const mem = new Map();

  // In-flight promises keyed by cache key, so N parallel callers coalesce to 1.
  const inflight = new Map();

  // Persistent tier is loaded lazily on first access and written debounced.
  let persistLoaded = false;
  let persistMap = null;          // Map<key, {status, savedAt}>
  let persistDirty = false;
  let persistFlushTimer = null;

  function key(providerId, hash) {
    return `${providerId}:${String(hash || '').toLowerCase()}`;
  }

  function ttlFor(status) {
    if (status === 'cached')     return TTL_CACHED;
    if (status === 'not_cached') return TTL_NOT_CACHED;
    return 0;
  }

  function isFresh(entry) {
    if (!entry) return false;
    const ttl = ttlFor(entry.status);
    if (ttl === 0) return false;
    return (Date.now() - entry.savedAt) < ttl;
  }

  async function loadPersist() {
    if (persistLoaded) return;
    try {
      const data = await chrome.storage.local.get([STORAGE_KEY]);
      const raw = data[STORAGE_KEY] || {};
      persistMap = new Map(Object.entries(raw));
    } catch (e) {
      persistMap = new Map();
    }
    persistLoaded = true;
  }

  function schedulePersistFlush() {
    persistDirty = true;
    if (persistFlushTimer) return;
    // Debounce writes: several rapid sets coalesce into one storage write.
    persistFlushTimer = setTimeout(async () => {
      persistFlushTimer = null;
      if (!persistDirty || !persistMap) return;
      persistDirty = false;

      // Trim to cap, oldest-first.
      if (persistMap.size > PERSIST_LIMIT) {
        const entries = [...persistMap.entries()].sort(
          (a, b) => a[1].savedAt - b[1].savedAt
        );
        const excess = entries.slice(0, entries.length - PERSIST_LIMIT);
        for (const [k] of excess) persistMap.delete(k);
      }

      // Try to write. If we hit the quota, shrink aggressively and retry once.
      // If the retry also fails, drop the persist tier entirely until next SW
      // restart — we don't want to keep poisoning storage.set() calls from
      // other modules (history, saved, shield).
      const tryWrite = async () => {
        await chrome.storage.local.set({
          [STORAGE_KEY]: Object.fromEntries(persistMap)
        });
      };

      try {
        await tryWrite();
      } catch (e) {
        const isQuota = /quota|QUOTA_BYTES/i.test(String(e?.message || e));
        if (isQuota && persistMap.size > 100) {
          // Aggressive prune: keep only the 100 most recent entries.
          const recent = [...persistMap.entries()]
            .sort((a, b) => b[1].savedAt - a[1].savedAt)
            .slice(0, 100);
          persistMap = new Map(recent);
          try {
            await tryWrite();
            return;
          } catch (e2) {
            // Still failing — surrender the persist tier.
          }
        }
        // Give up on persistence for the rest of this SW lifetime. The mem
        // tier still works, so cache behaviour degrades gracefully rather
        // than hammering storage.set() on every subsequent write.
        persistMap = null;
        persistLoaded = false;
        try { await chrome.storage.local.remove([STORAGE_KEY]); } catch (_) {}
      }
    }, 2000);
  }

  function memSet(k, entry) {
    if (mem.has(k)) mem.delete(k);
    mem.set(k, entry);
    if (mem.size > MEM_LIMIT) {
      // Evict oldest.
      const oldestKey = mem.keys().next().value;
      mem.delete(oldestKey);
    }
  }

  function memGet(k) {
    if (!mem.has(k)) return null;
    const entry = mem.get(k);
    // Touch for LRU.
    mem.delete(k);
    mem.set(k, entry);
    return entry;
  }

  /**
   * Look up a cached result. Returns the entry or null if absent/stale.
   * Promotes a fresh persist-tier hit into memory.
   */
  async function get(providerId, hash) {
    const k = key(providerId, hash);

    const memEntry = memGet(k);
    if (memEntry && isFresh(memEntry)) return memEntry;

    await loadPersist();
    if (!persistMap) return null;
    const persistEntry = persistMap.get(k);
    if (persistEntry && isFresh(persistEntry)) {
      memSet(k, persistEntry);
      return persistEntry;
    }

    return null;
  }

  /** Write a result into both tiers. `unknown` results are not stored. */
  function set(providerId, hash, status) {
    if (ttlFor(status) === 0) return;
    const k = key(providerId, hash);
    const entry = { status, savedAt: Date.now() };
    memSet(k, entry);

    if (persistLoaded && persistMap) {
      persistMap.set(k, entry);
      schedulePersistFlush();
      return;
    }
    if (persistLoaded && !persistMap) {
      // Persist tier was surrendered earlier (quota surrender). Skip the
      // write — mem tier alone still gives good hit-rate for active sessions.
      return;
    }
    // Load lazily, then set (or skip if load surrenders).
    loadPersist().then(() => {
      if (!persistMap) return;
      persistMap.set(k, entry);
      schedulePersistFlush();
    });
  }

  /**
   * Wrap a cache-check function so concurrent callers for the same hash
   * share one API call.
   */
  function dedup(providerId, hash, fn) {
    const k = key(providerId, hash);
    const existing = inflight.get(k);
    if (existing) return existing;
    const p = Promise.resolve().then(fn).finally(() => inflight.delete(k));
    inflight.set(k, p);
    return p;
  }

  /** Clear everything. Useful for testing / "reset cache" option. */
  async function clear() {
    mem.clear();
    inflight.clear();
    persistMap = new Map();
    persistLoaded = true;
    try {
      await chrome.storage.local.remove([STORAGE_KEY]);
    } catch (e) {}
  }

  /** For debugging. */
  async function stats() {
    await loadPersist();
    return {
      mem: mem.size,
      persist: persistMap ? persistMap.size : 0,
      inflight: inflight.size,
      persistDisabled: !persistMap
    };
  }

  return { get, set, dedup, clear, stats };
})();

if (typeof self !== 'undefined') {
  self.MagnetarCacheStore = MagnetarCacheStore;
}
