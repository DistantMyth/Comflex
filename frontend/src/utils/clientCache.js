/**
 * clientCache.js — Production-Grade React 19 SWR In-Memory Cache Engine.
 *
 * Guarantees:
 * 1. React 19 useSyncExternalStore compatibility via frozen memoized snapshots & static COLD_SNAPSHOT.
 * 2. Monotonic mutation version vectors: resolves out-of-order race conditions where background
 *    fetches would otherwise overwrite newer optimistic mutations.
 * 3. Promise identity tracking in .finally(): superseded fetches never destroy active in-flight tracking.
 * 4. In-flight version matching: invalidating during a fetch forces a fresh fetch rather than stale coalescing.
 * 5. Account-scoped keys & epoch counters: prevents cross-account cache leakage on logout or token refresh.
 * 6. Protected LRU eviction: prevents evicting entries that have active React subscribers or active fetches.
 */

export const COLD_SNAPSHOT = Object.freeze({
  data: undefined,
  loading: true,
  isRevalidating: false,
  error: null,
  version: 0,
});

class ClientCache {
  constructor(maxEntries = 200) {
    this.entries = new Map();
    this.subscribers = new Map();
    this.maxEntries = maxEntries;
    this.epoch = 0;
    this.userIdProvider = null;
  }

  setUserIdProvider(fn) {
    this.userIdProvider = fn;
  }

  getUserId() {
    if (typeof this.userIdProvider === 'function') {
      try {
        const id = this.userIdProvider();
        if (id) return id;
      } catch { /* ignore */ }
    }
    // Safe browser fallback without module cycle
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const token = window.localStorage.getItem('accessToken');
        if (token) {
          const parts = token.split('.');
          if (parts.length === 3) {
            const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            const payload = JSON.parse(atob(base64));
            return payload.sub || payload.userId || payload.id || null;
          }
        }
      } catch { /* ignore */ }
    }
    return null;
  }

  getScopedKey(rawKey) {
    const uid = this.getUserId() || 'global';
    return `${uid}:${rawKey}`;
  }

  updateEntrySnapshot(entry) {
    entry.snapshot = Object.freeze({
      data: entry.data,
      loading: Boolean(entry.isCold && !entry.error),
      isRevalidating: Boolean(entry.promise !== null && !entry.isCold),
      error: entry.error,
      version: entry.version,
    });
  }

  getSnapshot(rawKey) {
    const scopedKey = this.getScopedKey(rawKey);
    const entry = this.entries.get(scopedKey);
    return entry ? entry.snapshot : COLD_SNAPSHOT;
  }

  getServerSnapshot() {
    return COLD_SNAPSHOT;
  }

  subscribe(rawKey, listener) {
    const scopedKey = this.getScopedKey(rawKey);
    let set = this.subscribers.get(scopedKey);
    if (!set) {
      set = new Set();
      this.subscribers.set(scopedKey, set);
    }
    set.add(listener);
    return () => {
      const currentSet = this.subscribers.get(scopedKey);
      if (currentSet) {
        currentSet.delete(listener);
        if (currentSet.size === 0) {
          this.subscribers.delete(scopedKey);
        }
      }
    };
  }

  notify(scopedKey) {
    const listeners = this.subscribers.get(scopedKey);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener();
        } catch (err) {
          console.error('[clientCache] Listener error:', err);
        }
      });
    }
  }

  isStale(rawKey, ttl = 60000) {
    const scopedKey = this.getScopedKey(rawKey);
    const entry = this.entries.get(scopedKey);
    if (!entry || entry.timestamp === 0 || entry.isCold) return true;
    return (Date.now() - entry.timestamp) >= ttl;
  }

  async getOrFetch(rawKey, fetcher, options = {}) {
    const { ttl = 60000, initialData } = options;
    const scopedKey = this.getScopedKey(rawKey);

    let entry = this.entries.get(scopedKey);
    if (!entry) {
      this.evictLRU();
      entry = {
        data: initialData !== undefined ? initialData : undefined,
        timestamp: 0,
        isCold: true,
        promise: null,
        error: null,
        version: 1,
        inFlightVersion: null,
        snapshot: null,
      };
      this.updateEntrySnapshot(entry);
      this.entries.set(scopedKey, entry);
    } else {
      // Re-insert for LRU order
      this.entries.delete(scopedKey);
      this.entries.set(scopedKey, entry);
    }

    const isStale = (Date.now() - entry.timestamp) >= ttl || entry.timestamp === 0 || entry.isCold;

    // Singleflight coalescing check: only coalesce if the in-flight promise matches CURRENT version
    if (entry.promise && entry.inFlightVersion === entry.version) {
      return entry.promise;
    }

    if (!isStale && !entry.isCold && entry.data !== undefined) {
      return entry.data;
    }

    // Launch background revalidation
    return this.revalidate(scopedKey, rawKey, fetcher);
  }

  async revalidate(scopedKey, rawKey, fetcher) {
    let entry = this.entries.get(scopedKey);
    if (!entry) return;

    const requestVersion = entry.version;
    const requestEpoch = this.epoch;
    entry.inFlightVersion = requestVersion;

    const fetchPromise = (async () => {
      try {
        const result = await fetcher();
        const currentEntry = this.entries.get(scopedKey);
        // Only accept result if version has NOT changed and epoch matches
        if (currentEntry && currentEntry.version === requestVersion && this.epoch === requestEpoch) {
          currentEntry.data = result;
          currentEntry.error = null;
          currentEntry.timestamp = Date.now();
          currentEntry.isCold = false;
          this.updateEntrySnapshot(currentEntry);
          this.notify(scopedKey);
        }
        return result;
      } catch (err) {
        const currentEntry = this.entries.get(scopedKey);
        if (currentEntry && currentEntry.version === requestVersion && this.epoch === requestEpoch) {
          currentEntry.error = err;
          currentEntry.isCold = false;
          this.updateEntrySnapshot(currentEntry);
          this.notify(scopedKey);
        }
        throw err;
      }
    })().finally(() => {
      const currentEntry = this.entries.get(scopedKey);
      // Promise Identity Guard: ONLY clear tracking if this promise is still the active one!
      if (currentEntry && currentEntry.promise === fetchPromise) {
        currentEntry.promise = null;
        currentEntry.inFlightVersion = null;
        this.updateEntrySnapshot(currentEntry);
        this.notify(scopedKey);
      }
    });

    entry.promise = fetchPromise;
    this.updateEntrySnapshot(entry);
    this.notify(scopedKey);

    return fetchPromise;
  }

  mutate(rawKey, updater) {
    const scopedKey = this.getScopedKey(rawKey);
    let entry = this.entries.get(scopedKey);
    if (!entry) {
      this.evictLRU();
      entry = {
        data: typeof updater === 'function' ? updater(undefined) : updater,
        timestamp: Date.now(),
        isCold: false,
        promise: null,
        error: null,
        version: 1,
        inFlightVersion: null,
        snapshot: null,
      };
      this.updateEntrySnapshot(entry);
      this.entries.set(scopedKey, entry);
    } else {
      entry.data = typeof updater === 'function' ? updater(entry.data) : updater;
      entry.timestamp = Date.now();
      entry.isCold = false;
      entry.error = null;
      entry.version++;
      this.updateEntrySnapshot(entry);
    }
    this.notify(scopedKey);
  }

  invalidate(rawKey) {
    const scopedKey = this.getScopedKey(rawKey);
    const entry = this.entries.get(scopedKey);
    if (entry) {
      entry.timestamp = 0;
      entry.version++;
      this.updateEntrySnapshot(entry);
      this.notify(scopedKey);
    }
  }

  invalidatePrefix(prefix) {
    const scopedPrefix = this.getScopedKey(prefix);
    for (const [k, entry] of this.entries.entries()) {
      if (k.startsWith(scopedPrefix)) {
        entry.timestamp = 0;
        entry.version++;
        this.updateEntrySnapshot(entry);
        this.notify(k);
      }
    }
  }

  evictLRU() {
    if (this.entries.size >= this.maxEntries) {
      for (const [k, entry] of this.entries.entries()) {
        const hasSubscribers = (this.subscribers.get(k)?.size || 0) > 0;
        const isInFlight = entry.promise !== null;
        if (!hasSubscribers && !isInFlight) {
          this.entries.delete(k);
          break;
        }
      }
    }
  }

  clear() {
    this.epoch++;
    const activeKeys = [...this.subscribers.keys()];
    this.entries.clear();
    for (const k of activeKeys) {
      this.notify(k);
    }
  }
}

export const clientCache = new ClientCache();
export default clientCache;
