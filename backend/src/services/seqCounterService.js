/**
 * Sequence Counter Service — Ghost-Free $O(1)$ Unread Message Diffing
 *
 * Implements:
 * 1. Monotonic sequence counter synchronization with DB-committed sequence numbers.
 * 2. Pure O(1) sender cursor advancement (prevents ghost unreads for author).
 * 3. Seed cursor on new member join (new members start with 0 unreads).
 * 4. Pipelined batch read diffing (HMGET user cursors + MGET group sequences in 1 round trip).
 * 5. Instantaneous arithmetic DB fallback Math.max(0, group.messageSeq - member.lastReadSeq).
 */

const prisma = require('../prisma');
const cacheService = require('./cacheService');

const SYNC_GROUP_SEQ_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
if (not cur) or (tonumber(cur) < tonumber(ARGV[1])) then
    redis.call('SET', KEYS[1], ARGV[1])
end
return redis.call('GET', KEYS[1])
`;

const ADVANCE_USER_CURSOR_SCRIPT = `
local curUser = redis.call('HGET', KEYS[1], ARGV[1])
if (not curUser) or (tonumber(curUser) < tonumber(ARGV[2])) then
    redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
end
return 1
`;

class SeqCounterService {
  /**
   * Synchronize committed DB sequence to Redis and advance author cursor monotonically.
   * Uses single-key scripts for 100% Redis Cluster cross-slot safety.
   */
  async syncCommittedMessageSeq(groupId, committedSeq, authorId = null) {
    const redis = cacheService.getRedisClient();
    if (!redis) return committedSeq;

    try {
      const groupKey = `group:msg_seq:${groupId}`;
      await redis.eval(SYNC_GROUP_SEQ_SCRIPT, 1, groupKey, committedSeq);

      if (authorId) {
        const authorKey = `user:read_cursors:${authorId}`;
        await redis.eval(ADVANCE_USER_CURSOR_SCRIPT, 1, authorKey, groupId, committedSeq);
      }
    } catch (err) {
      console.warn(`[SeqCounter] Redis sequence sync failed for ${groupId}:`, err.message);
    }
    return committedSeq;
  }

  /**
   * Advance a user's read cursor to the specified sequence number.
   */
  async setUserCursor(userId, groupId, seq) {
    const redis = cacheService.getRedisClient();
    if (redis) {
      try {
        await redis.hset(`user:read_cursors:${userId}`, groupId, seq);
      } catch (err) {
        console.warn(`[SeqCounter] Redis hset cursor failed for ${userId}:`, err.message);
      }
    }

    // Persist to MongoDB GroupMember
    try {
      await prisma.groupMember.updateMany({
        where: { userId, groupId },
        data: {
          lastReadSeq: seq,
          lastReadAt: new Date(),
        },
      });
    } catch (err) {
      console.warn(`[SeqCounter] DB lastReadSeq update failed for ${userId}:`, err.message);
    }
  }

  /**
   * Seed read cursor for a newly added / joined member.
   * Ensures new members start with exactly 0 unread messages.
   */
  async seedNewMemberCursor(userId, groupId) {
    let currentSeq = 0;
    const redis = cacheService.getRedisClient();

    if (redis) {
      try {
        const raw = await redis.get(`group:msg_seq:${groupId}`);
        if (raw !== null) {
          currentSeq = parseInt(raw, 10) || 0;
        }
      } catch (_) {}
    }

    if (currentSeq === 0) {
      const group = await prisma.cohortGroup.findUnique({
        where: { id: groupId },
        select: { messageSeq: true },
      });
      currentSeq = group?.messageSeq || 0;
    }

    if (redis) {
      try {
        await redis.hset(`user:read_cursors:${userId}`, groupId, currentSeq);
      } catch (_) {}
    }

    try {
      await prisma.groupMember.updateMany({
        where: { userId, groupId },
        data: {
          lastReadSeq: currentSeq,
          lastReadAt: new Date(),
        },
      });
    } catch (_) {}

    return currentSeq;
  }

  /**
   * Batch calculate unread counts for a user across multiple groups in O(1).
   */
  async getUnreadCountsBatch(userId, groupIds) {
    if (!groupIds || groupIds.length === 0) return {};

    const redis = cacheService.getRedisClient();
    if (redis) {
      try {
        const pipeline = redis.pipeline();
        pipeline.hmget(`user:read_cursors:${userId}`, ...groupIds);
        for (const gid of groupIds) {
          pipeline.get(`group:msg_seq:${gid}`);
        }
        const results = await pipeline.exec();

        const userCursors = results[0][1] || [];
        const counts = {};
        const missingGroupIds = [];

        for (let i = 0; i < groupIds.length; i++) {
          const gid = groupIds[i];
          const rawCursor = userCursors[i];
          const rawSeqResult = results[1 + i];
          const rawSeq = rawSeqResult ? rawSeqResult[1] : null;

          if (rawCursor != null && rawSeq != null) {
            const seq = parseInt(rawSeq, 10) || 0;
            const cur = parseInt(rawCursor, 10) || 0;
            counts[gid] = Math.max(0, seq - cur);
          } else {
            missingGroupIds.push(gid);
          }
        }

        // Hydrate any missing groups from DB
        if (missingGroupIds.length > 0) {
          const hydrated = await this.getUnreadCountsMongoFallback(userId, missingGroupIds);
          Object.assign(counts, hydrated);

          // Populate Redis for subsequent hits (best-effort)
          try {
            const missingMemberships = await prisma.groupMember.findMany({
              where: { userId, groupId: { in: missingGroupIds } },
              select: { groupId: true, lastReadSeq: true, group: { select: { messageSeq: true } } },
            });
            if (missingMemberships.length > 0) {
              const popPipeline = redis.pipeline();
              for (const m of missingMemberships) {
                popPipeline.hset(`user:read_cursors:${userId}`, m.groupId, m.lastReadSeq || 0);
                popPipeline.set(`group:msg_seq:${m.groupId}`, m.group?.messageSeq || 0);
              }
              await popPipeline.exec().catch(() => {});
            }
          } catch (_) {}
        }

        return counts;
      } catch (err) {
        console.warn(`[SeqCounter] Redis batch unread failed, degrading to DB: ${err.message}`);
      }
    }

    // Direct DB arithmetic fallback
    return this.getUnreadCountsMongoFallback(userId, groupIds);
  }

  /**
   * Resilient single-query arithmetic fallback for MongoDB.
   * Zero queries to the Message collection!
   */
  async getUnreadCountsMongoFallback(userId, groupIds) {
    if (!groupIds || groupIds.length === 0) return {};

    const memberships = await prisma.groupMember.findMany({
      where: {
        userId,
        groupId: { in: groupIds },
      },
      select: {
        groupId: true,
        lastReadSeq: true,
        group: {
          select: { messageSeq: true },
        },
      },
    });

    const counts = {};
    for (const gid of groupIds) {
      counts[gid] = 0;
    }

    for (const m of memberships) {
      const gSeq = m.group?.messageSeq || 0;
      const mSeq = m.lastReadSeq || 0;
      counts[m.groupId] = Math.max(0, gSeq - mSeq);
    }

    return counts;
  }
}

const seqCounterService = new SeqCounterService();

module.exports = seqCounterService;
