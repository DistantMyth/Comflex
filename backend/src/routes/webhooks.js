/**
 * Webhooks API Routes — /api/v1/webhooks/*
 *
 * Hardened webhook ingestion pipeline:
 * 1. Timing-safe HMAC-SHA256 signature verification over raw body buffer.
 * 2. Buffer length guard preventing RangeError crashes.
 * 3. Clock-skew tolerant replay protection (-300s to +60s).
 * 4. Distributed atomic idempotency via Redis SET NX EX 86400.
 * 5. Monotonic cache write-through and invalidation.
 */

const express = require('express');
const crypto = require('crypto');
const env = require('../config/env');
const prisma = require('../prisma');
const cacheService = require('../services/cacheService');
const cacheInvalidator = require('../services/cacheInvalidator');
const { success, error } = require('../utils/apiResponse');

const router = express.Router();

/**
 * Webhook signature & replay verification middleware
 */
async function verifyWebhook(req, res, next) {
  try {
    const signature = req.headers['x-comflex-signature'];
    const timestampStr = req.headers['x-comflex-timestamp'];

    if (!signature || !timestampStr) {
      return error(res, 'AUTH_REQUIRED', 'Missing webhook signature or timestamp headers.', 401);
    }

    if (typeof signature !== 'string' || !/^[0-9a-fA-F]{64}$/.test(signature)) {
      return error(res, 'INVALID_SIGNATURE', 'Invalid signature format (must be 64-character hex string).', 401);
    }

    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp)) {
      return error(res, 'INVALID_TIMESTAMP', 'Webhook timestamp must be an integer.', 400);
    }

    // Replay protection with 60-second forward clock-skew tolerance
    const now = Math.floor(Date.now() / 1000);
    if (timestamp < (now - 300) || timestamp > (now + 60)) {
      return error(res, 'STALE_WEBHOOK', 'Webhook timestamp outside allowable tolerance window.', 401);
    }

    // Compute expected HMAC over `${timestamp}.${rawBody}`
    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
    const payloadToSign = `${timestamp}.${rawBody}`;
    const computedHmac = crypto
      .createHmac('sha256', env.WEBHOOK_SECRET)
      .update(payloadToSign)
      .digest('hex');

    const sigBuf = Buffer.from(signature, 'hex');
    const expectedBuf = Buffer.from(computedHmac, 'hex');

    // Length guard prevents Node.js RangeError crashes
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return error(res, 'INVALID_SIGNATURE', 'Webhook signature verification failed.', 401);
    }

    // Atomic idempotency deduplication with dual-mode fallback
    const eventId = req.headers['x-comflex-event-id'] || req.body?.eventId;
    if (eventId && typeof eventId === 'string') {
      const redis = cacheService.getRedisClient();
      if (redis) {
        const setOk = await redis.set(`webhook:processed:${eventId}`, '1', 'NX', 'EX', 86400);
        if (!setOk) {
          // Already processed — return idempotent success
          return success(res, { status: 'duplicate_ignored', eventId });
        }
      } else {
        // In-memory fallback using L1 cache
        if (cacheService.l1.has(`webhook:processed:${eventId}`)) {
          return success(res, { status: 'duplicate_ignored', eventId });
        }
        cacheService.l1.set(`webhook:processed:${eventId}`, '1', { ttl: 86400 * 1000 });
      }
    }

    next();
  } catch (err) {
    return error(res, 'WEBHOOK_VERIFY_ERROR', `Verification error: ${err.message}`, 500);
  }
}

// All webhook routes require valid signature
router.use(verifyWebhook);

/**
 * POST /api/v1/webhooks/cache/invalidate
 * Remote cache invalidation trigger.
 */
router.post('/cache/invalidate', async (req, res, next) => {
  try {
    const { key, clearAll, userId, groupId } = req.body;

    if (clearAll) {
      cacheService.clearL1();
      return success(res, { status: 'l1_cleared' });
    }

    if (userId) {
      await cacheInvalidator.invalidateUser(userId);
    }

    if (groupId) {
      await cacheInvalidator.invalidateGroup(groupId);
    }

    if (key) {
      await cacheInvalidator.invalidateKey(key);
    }

    return success(res, { status: 'invalidated', key, userId, groupId });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/webhooks/codeforces
 * Codeforces rating synchronization webhook.
 */
router.post('/codeforces', async (req, res, next) => {
  try {
    const { handle, rating, rank, timestamp } = req.body;

    if (!handle || rating === undefined) {
      return error(res, 'VALIDATION_ERROR', 'handle and rating are required.', 400);
    }

    const cfKey = `cf:stats:${handle.toLowerCase()}`;
    const cachedStats = await cacheService.get(cfKey);

    // Monotonic timestamp check
    if (cachedStats && cachedStats.timestamp && timestamp && timestamp < cachedStats.timestamp) {
      return success(res, { status: 'ignored_stale_timestamp' });
    }

    const freshStats = {
      handle,
      rating: parseInt(rating, 10),
      rank: rank || null,
      timestamp: timestamp || Date.now(),
    };

    // Cache stats for 1 hour
    await cacheService.set(cfKey, freshStats, 3600);

    // Update database user record if linked
    await prisma.user.updateMany({
      where: { cfHandle: { equals: handle, mode: 'insensitive' } },
      data: { cfRating: freshStats.rating },
    });

    // Invalidate leaderboard cache
    await cacheInvalidator.invalidateKey('cf:leaderboard');

    return success(res, { status: 'synced', stats: freshStats });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/webhooks/payments
 * Inbound payment confirmation webhook.
 */
router.post('/payments', async (req, res, next) => {
  try {
    const { userId, credits, txHash, referenceId } = req.body;

    if (!userId || !credits) {
      return error(res, 'VALIDATION_ERROR', 'userId and credits are required.', 400);
    }

    // Invalidate user cache to ensure fresh balance is visible immediately
    await cacheInvalidator.invalidateUser(userId);

    return success(res, { status: 'acknowledged', userId, credits, txHash });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
