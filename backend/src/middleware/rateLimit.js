/**
 * rateLimit — In-memory IP-based rate limiting middleware.
 *
 * Generic factory (no external deps). Each instance keeps its own
 * sliding-window bucket set (see utils/slidingWindow.js — shared with the
 * email limiter so all rate limits behave identically) mapping
 * `prefix:ip -> [timestamps]` and rejects requests past `max` within
 * `windowMs` with a 429. Note the bucket map and its 10k-entry sweep are
 * PER INSTANCE (previously one module-level map was shared across all
 * instances) — isolation is cleaner and the memory bound is per-route,
 * which is a non-issue at this scale.
 *
 * Client IP resolution prefers req.ip — with `trust proxy` set in
 * production, Express resolves the real client IP from the rightmost
 * untrusted hop, which a client can't spoof. The raw X-Forwarded-For
 * header is only a fallback for setups where trust proxy is off.
 *
 * NOTE: state is per-process (resets on restart) — fine for the
 * single-instance dev/Render setup.
 */

const { error } = require('../utils/apiResponse');
const { createSlidingWindow, formatWaitMinutes } = require('../utils/slidingWindow');

const BUCKET_SWEEP_THRESHOLD = 10000; // prune stale entries when this big

/**
 * Best-effort client IP extraction.
 */
function getClientIp(req) {
  if (req.ip) return req.ip;
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0].trim();
  if (Array.isArray(xff) && xff.length) return String(xff[0]).trim();
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * @param {object} opts
 * @param {number} [opts.windowMs] - window in ms (default 10 min)
 * @param {number} [opts.max] - max requests per window per IP (default 100)
 * @param {string} [opts.message] - 429 message
 * @param {string} [opts.code] - error code (default 'RATE_LIMITED')
 * @param {string} [opts.keyPrefix] - namespace for the bucket key (default 'rl')
 * @param {function} [opts.shouldCount] - (req) => bool; skip counting when false
 * @returns {import('express').RequestHandler}
 */
function rateLimiter({
  windowMs = 10 * 60 * 1000,
  max = 100,
  message = 'Too many requests. Please slow down and try again.',
  code = 'RATE_LIMITED',
  keyPrefix = 'rl',
  shouldCount = () => true,
} = {}) {
  const window = createSlidingWindow({ windowMs, max });

  return (req, res, next) => {
    if (!shouldCount(req)) return next();

    const key = `${keyPrefix}:${getClientIp(req)}`;

    // Opportunistic sweep to bound memory growth
    if (window.size() > BUCKET_SWEEP_THRESHOLD) window.sweep();

    const { allowed, waitMs } = window.tryConsume(key);
    if (!allowed) {
      return error(
        res,
        code,
        `${message} Try again in ${formatWaitMinutes(waitMs)}.`,
        429
      );
    }
    next();
  };
}

module.exports = { rateLimiter, getClientIp };
