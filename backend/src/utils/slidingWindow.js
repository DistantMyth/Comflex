/**
 * Sliding Window — shared core for every in-memory rate limit in the app.
 *
 * Unifies the logic that used to live in two places (the IP middleware and
 * the email-send limiter) so all limits behave identically:
 *   - timestamp filtering (keep only hits inside the window)
 *   - eviction (drop empty/stale buckets on access + optional sweep)
 *   - wait-time math (how long until the oldest hit expires)
 *
 * State is per-window-instance and in-memory (resets on restart, applies
 * per-process) — fine for the single-instance dev/Render setup, but a
 * multi-replica deploy would need a DB-backed counter.
 */

/**
 * @param {object} opts
 * @param {number} opts.windowMs - sliding window length in ms
 * @param {number} opts.max - max hits per key within the window
 */
function createSlidingWindow({ windowMs, max }) {
  const buckets = new Map(); // key -> number[] of hit timestamps (ms)
  const locks = new Map(); // key -> promise chain (serialize check+record)

  const filterFresh = (key, now) =>
    (buckets.get(key) || []).filter((t) => now - t < windowMs);

  /** Store a filtered list, evicting the key entirely when it's empty. */
  const storeFresh = (key, ts) => {
    if (!ts.length) buckets.delete(key);
    else buckets.set(key, ts);
  };

  /**
   * Synchronous consume — middleware hot path.
   * Filters, evicts, and records a hit when allowed (blocked hits don't
   * count). Returns { allowed, waitMs } where waitMs is how long until the
   * oldest in-window hit expires (0 when allowed).
   */
  function tryConsume(key) {
    const now = Date.now();
    const ts = filterFresh(key, now);
    const allowed = ts.length < max;
    if (allowed) {
      ts.push(now);
      storeFresh(key, ts);
    }
    const waitMs = allowed ? 0 : windowMs - (now - ts[0]);
    return { allowed, waitMs };
  }

  /**
   * Async consume with per-key serialization (email-send path): check and
   * record are atomic per key even across concurrent callers.
   */
  async function consume(key) {
    const prev = locks.get(key) || Promise.resolve();
    const run = prev.then(() => tryConsume(key), () => tryConsume(key));
    const wrapped = run.catch(() => {});
    locks.set(key, wrapped);
    wrapped.finally(() => {
      if (locks.get(key) === wrapped) locks.delete(key);
    });
    return run;
  }

  /** Report remaining allowance / retry-after so UIs can count down. */
  function status(key) {
    const now = Date.now();
    const ts = filterFresh(key, now);
    const retryAfterMs = ts.length >= max ? windowMs - (now - ts[0]) : 0;
    return {
      remaining: Math.max(0, max - ts.length),
      retryAfterMs,
      max,
      windowMs,
    };
  }

  /** Prune every bucket with no in-window hits; returns the new size. */
  function sweep() {
    const now = Date.now();
    for (const [k, ts] of buckets) {
      if (!ts.some((t) => now - t < windowMs)) buckets.delete(k);
    }
    return buckets.size;
  }

  return {
    consume,
    tryConsume,
    status,
    sweep,
    size: () => buckets.size,
  };
}

/**
 * Format a wait period into the shared "about X minute(s)" phrase used by
 * both limiter 429 messages.
 */
function formatWaitMinutes(waitMs) {
  const waitMin = Math.max(1, Math.ceil(waitMs / 60000));
  return `about ${waitMin} minute${waitMin > 1 ? 's' : ''}`;
}

module.exports = { createSlidingWindow, formatWaitMinutes };
