/**
 * Cache Invalidator Service — Cluster-Wide Invalidation & Control Coordinator
 *
 * Handles:
 * 1. Publishing invalidation events across Redis Pub/Sub (comflex:cache:invalidate).
 * 2. Listening to invalidation broadcasts to clear local L1 memory on peer nodes.
 * 3. Cluster-wide WebSocket room evictions and disconnects via comflex:ws:control.
 * 4. Graceful fallback when running in single-process mode without Redis.
 */

const Redis = require('ioredis');
const EventEmitter = require('events');
const crypto = require('crypto');
const env = require('../config/env');
const cacheService = require('./cacheService');

class CacheInvalidator extends EventEmitter {
  constructor() {
    super();
    this.nodeId = crypto.randomUUID();
    this.pub = null;
    this.sub = null;
    this.isPubSubReady = false;
    this.initPubSub();
  }

  initPubSub() {
    if (!env.REDIS_URL) {
      return;
    }

    try {
      this.pub = new Redis(env.REDIS_URL, {
        enableOfflineQueue: false,
        commandTimeout: 800,
        connectTimeout: 2000,
        maxRetriesPerRequest: 1,
        retryStrategy: (times) => Math.min(times * 100, 3000),
      });

      this.sub = new Redis(env.REDIS_URL, {
        enableOfflineQueue: false,
        commandTimeout: 800,
        connectTimeout: 2000,
        maxRetriesPerRequest: 1,
        retryStrategy: (times) => Math.min(times * 100, 3000),
      });

      this.pub.on('error', (err) => {
        console.warn(`[CacheInvalidator] Redis Pub error: ${err.message}`);
      });

      this.sub.on('error', (err) => {
        console.warn(`[CacheInvalidator] Redis Sub error: ${err.message}`);
      });

      this.pub.on('close', () => { this.isPubSubReady = false; });
      this.pub.on('end', () => { this.isPubSubReady = false; });
      this.sub.on('close', () => { this.isPubSubReady = false; });
      this.sub.on('end', () => { this.isPubSubReady = false; });

      this.sub.on('ready', () => {
        this.isPubSubReady = true;
        this.sub.subscribe('comflex:cache:invalidate', 'comflex:ws:control', (err) => {
          if (err) {
            console.warn('[CacheInvalidator] Subscription error:', err.message);
          } else {
            console.log('[CacheInvalidator] ✅ Subscribed to invalidation & WS control channels');
          }
        });
      });

      this.sub.on('message', (channel, message) => {
        try {
          const payload = JSON.parse(message);
          // Skip messages broadcast from this exact instance (already processed locally)
          if (payload.originNodeId && payload.originNodeId === this.nodeId) {
            return;
          }

          if (channel === 'comflex:cache:invalidate') {
            if (payload.key) {
              cacheService.l1.delete(payload.key);
            } else if (payload.clearAll) {
              cacheService.clearL1();
            }
          } else if (channel === 'comflex:ws:control') {
            this.emit('ws:control', payload);
          }
        } catch (err) {
          console.warn('[CacheInvalidator] Could not process broadcast message:', err.message);
        }
      });
    } catch (err) {
      console.warn('[CacheInvalidator] Pub/Sub initialization skipped:', err.message);
    }
  }

  /**
   * Invalidate a key locally and broadcast to peer nodes.
   */
  async invalidateKey(key) {
    await cacheService.invalidate(key);
    if (this.isPubSubReady && this.pub) {
      try {
        await this.pub.publish('comflex:cache:invalidate', JSON.stringify({ key, originNodeId: this.nodeId }));
      } catch (err) {
        console.warn(`[CacheInvalidator] Publish failed for key ${key}:`, err.message);
      }
    }
  }

  /**
   * Invalidate user profile and permissions.
   */
  async invalidateUser(userId) {
    await this.invalidateKey(`auth:user:${userId}`);
    await this.invalidateKey(`group:memberships:${userId}`);
    await this.invalidateKey(`user:read_cursors:${userId}`);
  }

  /**
   * Invalidate group metadata and member lists.
   */
  async invalidateGroup(groupId) {
    await this.invalidateKey(`group:meta:${groupId}`);
    await this.invalidateKey(`group:members:${groupId}`);
  }

  /**
   * Invalidate member permissions in group.
   */
  async invalidateMemberPermissions(groupId, userId) {
    await this.invalidateKey(`group:perms:${groupId}:${userId}`);
    await this.invalidateKey(`group:mute:${groupId}:${userId}`);
  }

  /**
   * Broadcast WebSocket control actions across all cluster workers.
   * Actions:
   * - { action: 'EVICT_USER_GROUP', userId, groupId }
   * - { action: 'DISCONNECT_USER', userId }
   * - { action: 'EVICT_ANON_IDENTITY', groupId, identityId }
   */
  async broadcastWsControl(payload) {
    const fullPayload = { ...payload, originNodeId: this.nodeId };
    // Process locally first
    this.emit('ws:control', fullPayload);

    if (this.isPubSubReady && this.pub) {
      try {
        await this.pub.publish('comflex:ws:control', JSON.stringify(fullPayload));
      } catch (err) {
        console.warn('[CacheInvalidator] WS control publish failed:', err.message);
      }
    }
  }
}

const cacheInvalidator = new CacheInvalidator();

module.exports = cacheInvalidator;
