/**
 * Cache Service — Dual-Mode Multi-Tier Caching (L1 Process LRU + L2 Distributed Redis)
 *
 * Implements:
 * 1. Fast bounded L1 LRU in-memory cache (micro-burst TTL 3s-15s, 64MB cap).
 * 2. Distributed L2 Redis cache with fail-fast timeouts and transparent in-memory fallback.
 * 3. Monotonic version tombstones (ver:<key>) with Lua Compare-and-Set script
 *    preventing stale DB reads from overwriting fresher mutations.
 * 4. Key-whitelisted recursive Date reviver restoring true JavaScript Date instances.
 * 5. Singleflight promise deduplication with 5-second timeout and leak-free cleanup.
 * 6. L1 population guard (only populated on CAS acceptance).
 */

const Redis = require('ioredis');
const { LRUCache } = require('lru-cache');
const env = require('../config/env');

const KNOWN_DATE_KEYS = new Set([
  'createdAt', 'updatedAt', 'joinedAt', 'lastReadAt', 'mutedUntil',
  'pinnedAt', 'editedAt', 'readAt', 'grantedAt', 'submittedAt',
  'evaluatedAt', 'acquiredAt', 'startDate', 'endDate',
  'inviteTokenExpiry', 'emailVerifyExpiry', 'resetTokenExpiry',
  'walletNonceExpiry', 'usernameChangedAt', 'lastUploadDate', 'bannedAt',
  'date', 'lastPointDate'
]);

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function safeDateReviver(key, value) {
  if (typeof value === 'string' && KNOWN_DATE_KEYS.has(key) && ISO_DATE_PATTERN.test(value)) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d;
  }
  return value;
}

function hasValidHashTag(key) {
  const open = key.indexOf('{');
  if (open !== -1) {
    const close = key.indexOf('}', open + 1);
    return close > open + 1;
  }
  return false;
}

function toSlotKey(key) {
  return hasValidHashTag(key) ? key : `{${key}}`;
}

function toVerKey(key) {
  const slotKey = toSlotKey(key);
  return `${slotKey}:ver`;
}

const CAS_SET_SCRIPT = `
local current_ver = redis.call('GET', KEYS[2])
if current_ver and tonumber(ARGV[2]) < tonumber(current_ver) then
    return 0 -- Stale DB read rejected
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
if not current_ver then
    redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3] + 3600)
end
return 1
`;

class Singleflight {
  constructor() {
    this.inFlight = new Map();
  }

  async do(key, fetcher, timeoutMs = 5000) {
    if (this.inFlight.has(key)) {
      return this.inFlight.get(key);
    }

    const promise = (async () => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      timer.unref?.();
      try {
        return await Promise.race([
          fetcher({ signal: ac.signal }),
          new Promise((_, reject) => {
            ac.signal.addEventListener('abort', () =>
              reject(new Error(`Singleflight timeout for key: ${key}`))
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }
}

class CacheService {
  constructor() {
    this.l1 = new LRUCache({
      max: 5000,
      maxSize: 64 * 1024 * 1024, // 64 MB maximum heap cap
      sizeCalculation: (val, key) => {
        try {
          return Buffer.byteLength(typeof val === 'string' ? val : JSON.stringify(val)) + Buffer.byteLength(key);
        } catch {
          return 512;
        }
      },
      ttl: 15 * 1000, // 15s default max micro-burst TTL
      allowStale: false,
      updateAgeOnGet: false,
    });

    this.singleflight = new Singleflight();
    this.isRedisReady = false;
    this.redis = null;
    this.initRedis();
  }

  initRedis() {
    if (!env.REDIS_URL) {
      console.log('[Cache] REDIS_URL not configured. Running in L1 memory-only fallback mode.');
      return;
    }

    try {
      this.redis = new Redis(env.REDIS_URL, {
        enableOfflineQueue: false,
        commandTimeout: 800,
        connectTimeout: 2000,
        maxRetriesPerRequest: 1,
        retryStrategy: (times) => Math.min(times * 100, 3000),
        lazyConnect: false,
      });

      this.redis.on('connect', () => {
        this.isRedisReady = true;
        console.log('[Cache] ✅ Connected to Redis (L2 Cache active)');
      });

      this.redis.on('ready', () => {
        this.isRedisReady = true;
      });

      this.redis.on('close', () => {
        this.isRedisReady = false;
      });

      this.redis.on('error', (err) => {
        this.isRedisReady = false;
        console.warn(`[Cache] Redis connection issue (degrading to L1/DB): ${err.message}`);
      });
    } catch (err) {
      this.isRedisReady = false;
      console.warn(`[Cache] Could not initialize Redis client: ${err.message}`);
    }
  }

  getRedisClient() {
    return this.isRedisReady ? this.redis : null;
  }

  async get(key) {
    const l1Hit = this.l1.get(key);
    if (l1Hit !== undefined) return l1Hit;

    if (this.isRedisReady) {
      try {
        const slotKey = toSlotKey(key);
        const raw = await this.redis.get(slotKey);
        if (raw !== null) {
          const val = JSON.parse(raw, safeDateReviver);
          this.l1.set(key, val, { ttl: 5000 });
          return val;
        }
      } catch (err) {
        console.warn(`[Cache] Redis get error on ${key}:`, err.message);
      }
    }
    return null;
  }

  async set(key, value, ttlSeconds = 300) {
    const l1TtlMs = Math.min(ttlSeconds, 15) * 1000;
    this.l1.set(key, value, { ttl: l1TtlMs });

    if (this.isRedisReady) {
      try {
        const slotKey = toSlotKey(key);
        await this.redis.set(slotKey, JSON.stringify(value), 'EX', ttlSeconds);
      } catch (err) {
        console.warn(`[Cache] Redis set error on ${key}:`, err.message);
      }
    }
  }

  async del(key) {
    this.l1.delete(key);
    if (this.isRedisReady) {
      try {
        const slotKey = toSlotKey(key);
        await this.redis.del(slotKey);
      } catch (err) {
        console.warn(`[Cache] Redis del error on ${key}:`, err.message);
      }
    }
  }

  /**
   * High-performance multi-tier cache fetcher with CAS stale protection.
   *
   * @param {string} key - Cache key
   * @param {Function} fetcher - Async DB resolver
   * @param {number} ttlSeconds - L2 TTL (L1 gets min(ttlSeconds, 15s))
   * @param {object} options - { l1TtlMs, negativeTtlMs }
   */
  async getOrSet(key, fetcher, ttlSeconds = 300, options = {}) {
    // 1. Check L1 memory
    const l1Hit = this.l1.get(key);
    if (l1Hit !== undefined) {
      return l1Hit === '__NULL__' ? null : l1Hit;
    }

    const slotKey = toSlotKey(key);
    const verKey = toVerKey(key);

    // 2. Check L2 Redis
    if (this.isRedisReady) {
      try {
        const raw = await this.redis.get(slotKey);
        if (raw !== null) {
          if (raw === '__NULL__') {
            this.l1.set(key, '__NULL__', { ttl: 10000 });
            return null;
          }
          const val = JSON.parse(raw, safeDateReviver);
          const l1Ttl = options.l1TtlMs || Math.min(ttlSeconds, 15) * 1000;
          this.l1.set(key, val, { ttl: l1Ttl });
          return val;
        }
      } catch (err) {
        console.warn(`[Cache] Redis read failed for ${key}, falling back to fetcher:`, err.message);
      }
    }

    // 3. Capture expected version tombstone BEFORE fetching from DB
    let expectedVer = '0';
    if (this.isRedisReady) {
      try {
        expectedVer = (await this.redis.get(verKey)) || '0';
      } catch (_) {}
    }

    // 4. Singleflight DB fetch (prevents stampedes)
    let data;
    try {
      data = await this.singleflight.do(key, fetcher);
    } catch (err) {
      throw err; // Never negative-cache thrown DB errors
    }

    // Post-Singleflight L1 Check: If a concurrent caller in the same flight
    // already completed and populated L1 via CAS, return immediately!
    const postL1 = this.l1.get(key);
    if (postL1 !== undefined) {
      return postL1 === '__NULL__' ? null : postL1;
    }

    // 5. Handle null / missing entities (Negative Caching with Monotonic CAS)
    if (data === null || data === undefined) {
      const negTtl = options.negativeTtlMs ? Math.round(options.negativeTtlMs / 1000) : 15;
      if (this.isRedisReady) {
        try {
          const casResult = await this.redis.eval(
            CAS_SET_SCRIPT,
            2,
            slotKey,
            verKey,
            '__NULL__',
            expectedVer,
            negTtl
          );
          if (casResult === 1) {
            this.l1.set(key, '__NULL__', { ttl: negTtl * 1000 });
          }
        } catch (_) {}
      } else {
        this.l1.set(key, '__NULL__', { ttl: negTtl * 1000 });
      }
      return null;
    }

    // 6. Monotonic CAS write to L2 Redis
    const l1Ttl = options.l1TtlMs || Math.min(ttlSeconds, 15) * 1000;
    if (this.isRedisReady) {
      try {
        const serialized = JSON.stringify(data);
        const casResult = await this.redis.eval(
          CAS_SET_SCRIPT,
          2,
          slotKey,
          verKey,
          serialized,
          expectedVer,
          ttlSeconds
        );
        // L1 Population Guard: only populate L1 if CAS confirmed data was not superseded
        if (casResult === 1) {
          this.l1.set(key, data, { ttl: l1Ttl });
        }
      } catch (err) {
        console.warn(`[Cache] Redis CAS write failed on ${key}:`, err.message);
      }
      return data;
    }

    // Pure fallback mode when Redis is not configured / offline
    this.l1.set(key, data, { ttl: l1Ttl });
    return data;
  }

  /**
   * Invalidate local L1 and distributed L2 entry.
   * Atomically bumps the version tombstone in Redis.
   */
  async invalidate(key) {
    this.l1.delete(key);
    const slotKey = toSlotKey(key);
    const verKey = toVerKey(key);

    if (this.isRedisReady) {
      try {
        await this.redis
          .pipeline()
          .del(slotKey)
          .incr(verKey)
          .expire(verKey, 3600)
          .exec();
      } catch (err) {
        console.warn(`[Cache] Redis invalidation failed on ${key}:`, err.message);
      }
    }
  }

  /**
   * Flush all local L1 cache entries.
   */
  clearL1() {
    this.l1.clear();
  }
}

const cacheService = new CacheService();
cacheService.safeDateReviver = safeDateReviver;

module.exports = cacheService;
