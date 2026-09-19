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
 * Two-phase idempotent webhook execution wrapper.
 * Phase 1: In-flight lock with 30s TTL.
 * Phase 2: On handler success, release lock and set done tombstone for 24h.
 * On handler error, release lock immediately so external retries succeed.
 */
async function executeIdempotentWebhook(eventId, handler) {
  const redis = cacheService.getRedisClient();
  const lockKey = `webhook:lock:${eventId}`;
  const doneKey = `webhook:done:${eventId}`;

  if (redis) {
    const isDone = await redis.get(doneKey);
    if (isDone) return { status: 'duplicate_ignored', eventId };
    const acquired = await redis.set(lockKey, '1', 'NX', 'EX', 30);
    if (!acquired) return { status: 'concurrent_in_flight', eventId };
  } else {
    if (cacheService.l1.get(doneKey)) return { status: 'duplicate_ignored', eventId };
    if (cacheService.l1.get(lockKey)) return { status: 'concurrent_in_flight', eventId };
    cacheService.l1.set(lockKey, '1', { ttl: 30 * 1000 });
  }

  try {
    const result = await handler();
    if (redis) {
      await redis.set(doneKey, '1', 'EX', 86400);
      await redis.del(lockKey);
    } else {
      cacheService.l1.set(doneKey, '1', { ttl: 86400 * 1000 });
      cacheService.l1.delete(lockKey);
    }
    return result;
  } catch (err) {
    if (redis) {
      await redis.del(lockKey).catch(() => {});
    } else {
      cacheService.l1.delete(lockKey);
    }
    throw err;
  }
}

function handleWebhookOutcome(res, outcome) {
  if (outcome?.status === 'concurrent_in_flight') {
    res.set('Retry-After', '5');
    return error(res, 'CONCURRENT_WEBHOOK', 'Event is currently being processed. Please retry shortly.', 429);
  }
  return success(res, outcome);
}

/**
 * Webhook signature & replay verification middleware
 */
async function verifyWebhook(req, res, next) {
  try {
    if (!env.WEBHOOK_SECRET) {
      return error(res, 'WEBHOOKS_DISABLED', 'Webhook receiver is not configured on this server.', 503);
    }

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

    const secretsToTry = [env.WEBHOOK_SECRET];
    if (env.WEBHOOK_SECRET_FALLBACK) {
      secretsToTry.push(env.WEBHOOK_SECRET_FALLBACK);
    }

    const sigBuf = Buffer.from(signature, 'hex');
    let isValid = false;

    for (const secret of secretsToTry) {
      const computedHmac = crypto
        .createHmac('sha256', secret)
        .update(payloadToSign)
        .digest('hex');
      const expectedBuf = Buffer.from(computedHmac, 'hex');

      // Length guard prevents Node.js RangeError crashes
      if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) {
        isValid = true;
        break;
      }
    }

    if (!isValid) {
      return error(res, 'INVALID_SIGNATURE', 'Webhook signature verification failed.', 401);
    }

    // Derive deterministic eventId: use header/body eventId, or content-addressable hash of rawBody
    // (omits timestamp so retries with updated timestamp headers yield identical eventId)
    req.eventId = req.headers['x-comflex-event-id'] || req.body?.eventId || crypto.createHash('sha256').update(rawBody).digest('hex');

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
    const outcome = await executeIdempotentWebhook(req.eventId, async () => {
      const { key, clearAll, userId, groupId } = req.body;

      if (clearAll) {
        await cacheInvalidator.clearAll();
        return { status: 'l1_cleared' };
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

      return { status: 'invalidated', key, userId, groupId };
    });

    return handleWebhookOutcome(res, outcome);
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

    const outcome = await executeIdempotentWebhook(req.eventId, async () => {
      const cfKey = `cf:stats:${handle.toLowerCase()}`;
      const cachedStats = await cacheService.get(cfKey);

      // Monotonic timestamp check
      if (cachedStats && cachedStats.timestamp && timestamp && timestamp < cachedStats.timestamp) {
        return { status: 'ignored_stale_timestamp' };
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

      return { status: 'synced', stats: freshStats };
    });

    return handleWebhookOutcome(res, outcome);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/webhooks/payments
 * Inbound payment confirmation webhook with atomic credit fulfillment.
 */
router.post('/payments', async (req, res, next) => {
  try {
    const { userId, credits, txHash, referenceId } = req.body;
    const creditNum = parseInt(credits, 10);

    if (!userId || !/^[0-9a-fA-F]{24}$/.test(userId) || isNaN(creditNum) || creditNum <= 0) {
      return error(res, 'VALIDATION_ERROR', 'Valid 24-hex ObjectId userId and positive credits required.', 400);
    }

    const paymentRef = txHash || referenceId;
    if (!paymentRef) {
      return error(res, 'VALIDATION_ERROR', 'External txHash or referenceId is required for payment webhooks.', 400);
    }

    const outcome = await executeIdempotentWebhook(req.eventId, async () => {
      try {
        return await prisma.$transaction(async (tx) => {
          const updatedUser = await tx.user.update({
            where: { id: userId },
            data: { creditBalance: { increment: creditNum } },
            select: { id: true, creditBalance: true },
          });

          const transaction = await tx.transaction.create({
            data: {
              receiverId: userId,
              amount: creditNum,
              type: 'webhook_purchase',
              referenceId: paymentRef,
            },
          });

          return {
            status: 'completed',
            userId,
            credits: creditNum,
            newBalance: updatedUser.creditBalance,
            transactionId: transaction.id,
            txHash: paymentRef,
          };
        });
      } catch (dbErr) {
        if (dbErr.code === 'P2002' || String(dbErr.message).includes('duplicate')) {
          return { status: 'duplicate_ignored', eventId: req.eventId, referenceId: paymentRef };
        }
        throw dbErr;
      }
    });

    await cacheInvalidator.invalidateUser(userId);
    return handleWebhookOutcome(res, outcome);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
