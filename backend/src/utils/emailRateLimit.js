/**
 * Email Rate Limit — per-key sliding-window limiter for email sends.
 *
 * Built on the shared sliding-window core (utils/slidingWindow.js) that the
 * IP middleware also uses, so every rate limit behaves identically. Caps
 * email-send ATTEMPTS within a sliding window (a send is counted even if
 * SMTP delivery later fails). In-memory means it resets on restart and
 * applies per-instance — fine for the single-process dev/Render setup, but
 * a multi-replica deploy would need a DB-backed counter.
 *
 * Used by:
 *   - authService: per-account limits for verification / password-reset emails
 *   - emailService: per-recipient backstop applied to EVERY send, so future
 *     flows (welcome emails, invites, event reminders) are covered even if
 *     they forget their own limiter.
 */

const { createSlidingWindow, formatWaitMinutes } = require('./slidingWindow');

function createEmailSendLimiter({ maxSends = 3, message = 'Too many emails sent.' } = {}) {
  const windowMs = 10 * 60 * 1000; // 10 minutes
  const window = createSlidingWindow({ windowMs, max: maxSends });

  return {
    /** Throw a 429 when the key is over its window allowance. */
    async check(key) {
      const { allowed, waitMs } = await window.consume(key);
      if (!allowed) {
        throw Object.assign(
          new Error(`${message} Try again in ${formatWaitMinutes(waitMs)}.`),
          { statusCode: 429, code: 'RATE_LIMITED' }
        );
      }
    },
    /** Report remaining allowance / retry-after so the UI can count down. */
    status(key) {
      const s = window.status(key);
      return {
        remaining: s.remaining,
        retryAfterMs: s.retryAfterMs,
        maxSends: s.max, // keep the legacy key name the frontend reads
        windowMs: s.windowMs,
      };
    },
  };
}

/** Normalize an email address for use as a limiter key. */
function normalizeEmailKey(email) {
  return String(email || '').trim().toLowerCase();
}

module.exports = { createEmailSendLimiter, normalizeEmailKey };
