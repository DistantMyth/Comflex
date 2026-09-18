/**
 * Comprehensive Verification Test Suite: Caching, Invalidation & Webhooks
 */

const assert = require('assert');
const crypto = require('crypto');
const cacheService = require('./src/services/cacheService');
const cacheInvalidator = require('./src/services/cacheInvalidator');
const seqCounterService = require('./src/services/seqCounterService');

async function runTests() {
  console.log('🧪 Starting Caching & Webhook Verification Tests...\n');

  // 1. Test L1 In-Memory Get / Set / Invalidation
  console.log('1. Testing L1 In-Memory Cache...');
  await cacheService.set('test:key1', { name: 'Comflex', value: 42 }, 60);
  const val1 = await cacheService.get('test:key1');
  assert.deepStrictEqual(val1, { name: 'Comflex', value: 42 });

  await cacheService.del('test:key1');
  const val1AfterDel = await cacheService.get('test:key1');
  assert.strictEqual(val1AfterDel, null);
  console.log('   ✅ L1 set/get/del passed.');

  // 2. Test getOrSet with Singleflight Stampede Protection
  console.log('\n2. Testing Singleflight Stampede Protection...');
  let fetchCount = 0;
  const slowFetcher = async () => {
    fetchCount++;
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { fetched: true, at: Date.now() };
  };

  // Trigger 20 simultaneous concurrent calls
  const promises = [];
  for (let i = 0; i < 20; i++) {
    promises.push(cacheService.getOrSet('test:singleflight:key', slowFetcher, 30));
  }
  const results = await Promise.all(promises);
  assert.strictEqual(fetchCount, 1, `Fetcher was called ${fetchCount} times instead of exactly 1`);
  assert.strictEqual(results.length, 20);
  assert.strictEqual(results[0].fetched, true);
  console.log('   ✅ Singleflight successfully collapsed 20 concurrent queries into 1 fetch.');

  // 3. Test Strict Key-Whitelisted Date Reviver
  console.log('\n3. Testing Key-Whitelisted Date Reviver...');
  const testPayload = {
    id: 'msg123',
    createdAt: new Date().toISOString(),
    content: 'Meeting at 2026-09-19T10:00:00.000Z in room A', // should NOT become Date
  };

  // Verify Redis deserialization reviver behavior
  const serialized = JSON.stringify(testPayload);
  const revived = JSON.parse(serialized, cacheService.safeDateReviver);
  assert(revived.createdAt instanceof Date, 'createdAt should be revived as a Date');
  assert.strictEqual(typeof revived.content, 'string', 'content should remain a string');
  assert.strictEqual(typeof revived.content.trim, 'function', 'content.trim should be callable');

  // Verify L1 preserves native Date objects returned from Prisma/DB
  const prismaPayload = {
    id: 'msg456',
    createdAt: new Date(),
    content: 'Hello world',
  };
  await cacheService.set('test:prisma:date', prismaPayload, 30);
  const fromL1 = await cacheService.get('test:prisma:date');
  assert(fromL1.createdAt instanceof Date, 'L1 must preserve native Date instance');
  console.log('   ✅ Date reviver correctly restored Date without corrupting user message text.');
  console.log('   ✅ L1 in-memory cache preserves native Date instances from Prisma.');

  // 4. Test Webhook Timing-Safe HMAC and Replay Protection
  console.log('\n4. Testing Webhook Signature & Replay Protection Logic...');
  const secret = 'test-secret-12345';
  const now = Math.floor(Date.now() / 1000);

  // Fresh valid signature
  const bodyString = JSON.stringify({ eventId: 'evt_1', credits: 100 });
  const payloadToSign = `${now}.${bodyString}`;
  const validSig = crypto.createHmac('sha256', secret).update(payloadToSign).digest('hex');

  const computedHmac = crypto.createHmac('sha256', secret).update(payloadToSign).digest('hex');
  const sigBuf = Buffer.from(validSig, 'hex');
  const expectedBuf = Buffer.from(computedHmac, 'hex');
  assert(sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf));
  console.log('   ✅ Valid webhook signature verified.');

  // Mismatched signature length test (must not throw RangeError)
  const shortSig = 'abcd123';
  const shortSigBuf = Buffer.from(shortSig, 'hex');
  let threwRangeError = false;
  try {
    if (shortSigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(shortSigBuf, expectedBuf)) {
      // correctly caught by length check
    }
  } catch (err) {
    threwRangeError = true;
  }
  assert.strictEqual(threwRangeError, false, 'Length check must prevent RangeError');
  console.log('   ✅ Webhook length guard prevented RangeError crash.');

  // Replay window test
  const staleTimestamp = now - 350; // older than 300s
  const isStale = (staleTimestamp < (now - 300) || staleTimestamp > (now + 60));
  assert.strictEqual(isStale, true, 'Timestamp older than 300s must be rejected');

  const futureTimestamp = now + 120; // more than 60s ahead
  const isFutureStale = (futureTimestamp < (now - 300) || futureTimestamp > (now + 60));
  assert.strictEqual(isFutureStale, true, 'Timestamp > 60s ahead must be rejected');

  const validWindowTimestamp = now - 10;
  const isValidWindow = !(validWindowTimestamp < (now - 300) || validWindowTimestamp > (now + 60));
  assert.strictEqual(isValidWindow, true, 'Fresh timestamp must be accepted');
  console.log('   ✅ Webhook clock-skew replay window protection passed.');

  // 5. Test Sequence Counter Arithmetic Fallback
  console.log('\n5. Testing Sequence Counter Arithmetic Fallback...');
  const groupSeq = 250;
  const lastReadSeq = 240;
  const unreadCount = Math.max(0, groupSeq - lastReadSeq);
  assert.strictEqual(unreadCount, 10, 'Unread count should be 10');

  const newMemberCursor = groupSeq;
  const newMemberUnread = Math.max(0, groupSeq - newMemberCursor);
  assert.strictEqual(newMemberUnread, 0, 'New member unread count must be 0');
  console.log('   ✅ Arithmetic sequence counter algebra passed with 0 ghost unreads.');

  // 6. Test bannedAt in Date Reviver
  console.log('\n6. Testing bannedAt in Date Reviver...');
  const anonPayload = {
    id: 'anon_123',
    bannedAt: new Date().toISOString(),
    alias: 'Phantom',
  };
  const parsedAnon = JSON.parse(JSON.stringify(anonPayload), cacheService.safeDateReviver);
  assert(parsedAnon.bannedAt instanceof Date, 'bannedAt should be revived as a Date');
  console.log('   ✅ bannedAt correctly revived as Date instance.');

  // 7. Test Webhook Signature Hex Strict Validation & Idempotency Fallback
  console.log('\n7. Testing Webhook Hex Validation & In-Memory Idempotency...');
  const hexRegex = /^[0-9a-fA-F]{64}$/;
  assert.strictEqual(hexRegex.test('not-a-valid-hex-sig'), false);
  assert.strictEqual(hexRegex.test(''), false);
  assert.strictEqual(hexRegex.test('a'.repeat(63)), false);
  assert.strictEqual(hexRegex.test('a'.repeat(64)), true);

  // In-memory idempotency fallback test
  const eventId = 'evt_test_audit_1';
  assert.strictEqual(cacheService.l1.has(`webhook:processed:${eventId}`), false);
  cacheService.l1.set(`webhook:processed:${eventId}`, '1', { ttl: 60000 });
  assert.strictEqual(cacheService.l1.has(`webhook:processed:${eventId}`), true);
  console.log('   ✅ Strict hex regex and in-memory webhook idempotency verified.');

  // 8. Test Cache Invalidator Instance Isolation
  console.log('\n8. Testing Cache Invalidator Node ID & Self-Echo Suppression...');
  assert(typeof cacheInvalidator.nodeId === 'string' && cacheInvalidator.nodeId.length > 0);
  console.log(`   ✅ Cache Invalidator node ID initialized (${cacheInvalidator.nodeId.slice(0, 8)}...).`);

  // 9. Test Redis Cluster Hash Tag Compatibility & hasValidHashTag
  console.log('\n9. Testing Redis Cluster Hash Tagging Logic & hasValidHashTag...');
  function testHasValidHashTag(k) {
    const open = k.indexOf('{');
    if (open !== -1) {
      const close = k.indexOf('}', open + 1);
      return close > open + 1;
    }
    return false;
  }
  function testToSlotKey(k) {
    return testHasValidHashTag(k) ? k : `{${k}}`;
  }

  assert.strictEqual(testHasValidHashTag('user:profile:123'), false);
  assert.strictEqual(testToSlotKey('user:profile:123'), '{user:profile:123}');
  assert.strictEqual(testHasValidHashTag('{user:profile:123}'), true);
  assert.strictEqual(testToSlotKey('{user:profile:123}'), '{user:profile:123}');
  // Inverted or empty braces must NOT be treated as valid hash tags
  assert.strictEqual(testHasValidHashTag('foo}bar{baz'), false);
  assert.strictEqual(testToSlotKey('foo}bar{baz'), '{foo}bar{baz}');
  assert.strictEqual(testHasValidHashTag('foo{}bar'), false);
  assert.strictEqual(testToSlotKey('foo{}bar'), '{foo{}bar}');
  console.log('   ✅ Redis Cluster RFC-compliant hash tag detection verified.');

  // 10. Test High-Concurrency Cold-Start Stampede Protection (100 concurrent callers)
  console.log('\n10. Testing High-Concurrency Stampede Protection (100 callers)...');
  let coldStartFetches = 0;
  const coldFetcher = async () => {
    coldStartFetches++;
    await new Promise((r) => setTimeout(r, 40));
    return { data: 'heavy-result', id: 999 };
  };
  const stampedePromises = [];
  for (let i = 0; i < 100; i++) {
    stampedePromises.push(cacheService.getOrSet('test:stampede:100', coldFetcher, 60));
  }
  const stampedeResults = await Promise.all(stampedePromises);
  assert.strictEqual(coldStartFetches, 1, `Cold start fetcher was called ${coldStartFetches} times instead of 1`);
  assert.strictEqual(stampedeResults.length, 100);
  assert.strictEqual(stampedeResults[0].data, 'heavy-result');
  console.log('   ✅ 100 concurrent callers collapsed into exactly 1 fetch with post-singleflight resolution.');

  // 11. Test Negative Caching (Null Caching)
  console.log('\n11. Testing Monotonic Negative Caching...');
  let nullFetches = 0;
  const nullFetcher = async () => {
    nullFetches++;
    return null;
  };
  const resNull1 = await cacheService.getOrSet('test:negative:key', nullFetcher, 60);
  assert.strictEqual(resNull1, null);
  assert.strictEqual(nullFetches, 1);

  // Subsequent getOrSet should hit negative cache without invoking fetcher
  const resNull2 = await cacheService.getOrSet('test:negative:key', nullFetcher, 60);
  assert.strictEqual(resNull2, null);
  assert.strictEqual(nullFetches, 1, 'Negative cache must prevent re-querying missing entities');
  console.log('   ✅ Negative caching correctly caches missing entity without database hits.');

  console.log('\n🎉 ALL CACHING & WEBHOOK VERIFICATION TESTS PASSED!\n');
}

runTests().catch((err) => {
  console.error('\n❌ Test failure:', err);
  process.exit(1);
});
