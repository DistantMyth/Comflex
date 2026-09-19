/**
 * test-client-cache.mjs — Comprehensive Unit & Concurrency Test Suite for clientCache.js
 */

import assert from 'node:assert';
import { clientCache, COLD_SNAPSHOT } from './src/utils/clientCache.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    clientCache.clear();
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    failed++;
  }
}

console.log('\n--- Running Client Cache Unit & Concurrency Tests ---\n');

// Mock User ID provider
let currentTestUserId = 'user_alice';
clientCache.setUserIdProvider(() => currentTestUserId);

await test('Snapshot reference stability on cold keys (COLD_SNAPSHOT singleton)', async () => {
  const s1 = clientCache.getSnapshot('unknown_key');
  const s2 = clientCache.getSnapshot('unknown_key');
  assert.strictEqual(s1, COLD_SNAPSHOT);
  assert.strictEqual(s1, s2);
  assert.strictEqual(Object.is(s1, s2), true);
});

await test('Immediate return on fresh cache hit (0ms)', async () => {
  let networkCalls = 0;
  const fetcher = async () => {
    networkCalls++;
    return [{ id: 'g1', name: 'Alpha Cohort' }];
  };

  // First cold fetch
  const p1 = clientCache.getOrFetch('groups:list', fetcher, { ttl: 5000 });
  const res1 = await p1;
  assert.strictEqual(networkCalls, 1);
  assert.deepStrictEqual(res1, [{ id: 'g1', name: 'Alpha Cohort' }]);

  // Snapshot reference stability check
  const snap1 = clientCache.getSnapshot('groups:list');
  const snap2 = clientCache.getSnapshot('groups:list');
  assert.strictEqual(snap1, snap2);
  assert.strictEqual(Object.is(snap1, snap2), true);

  // Second immediate fetch (fresh hit)
  const res2 = await clientCache.getOrFetch('groups:list', fetcher, { ttl: 5000 });
  assert.strictEqual(networkCalls, 1, 'Should NOT call network on fresh hit');
  assert.deepStrictEqual(res2, [{ id: 'g1', name: 'Alpha Cohort' }]);
});

await test('Singleflight promise sharing (10 concurrent requests = 1 fetch)', async () => {
  let networkCalls = 0;
  const fetcher = async () => {
    networkCalls++;
    await new Promise((r) => setTimeout(r, 50));
    return { status: 'ok', count: 42 };
  };

  const promises = Array.from({ length: 10 }, () =>
    clientCache.getOrFetch('stats', fetcher, { ttl: 5000 })
  );

  const results = await Promise.all(promises);
  assert.strictEqual(networkCalls, 1, 'Only 1 underlying network call should occur');
  results.forEach((r) => assert.deepStrictEqual(r, { status: 'ok', count: 42 }));
});

await test('Monotonic version guard: optimistic mutation during fetch is NEVER overwritten', async () => {
  let resolveNetwork;
  const fetcher = () =>
    new Promise((resolve) => {
      resolveNetwork = resolve;
    });

  // Start background fetch (version 1)
  const p = clientCache.getOrFetch('groups:list', fetcher, { ttl: 5000 });

  // Optimistically mutate before fetch resolves (bumps version to 2)
  clientCache.mutate('groups:list', [{ id: 'g2', name: 'Optimistic Squad' }]);
  assert.deepStrictEqual(clientCache.getSnapshot('groups:list').data, [
    { id: 'g2', name: 'Optimistic Squad' },
  ]);

  // Network fetch finishes with stale data from version 1
  resolveNetwork([{ id: 'g1', name: 'Stale Outdated Cohort' }]);
  await p;

  // Stale network response MUST be discarded!
  const finalSnap = clientCache.getSnapshot('groups:list');
  assert.deepStrictEqual(finalSnap.data, [{ id: 'g2', name: 'Optimistic Squad' }]);
});

await test('In-flight version matching: invalidation during fetch forces fresh fetch', async () => {
  let callCount = 0;
  let resolveFirst;

  const fetcher1 = () =>
    new Promise((resolve) => {
      callCount++;
      resolveFirst = resolve;
    });

  // Start fetch 1 (version 1)
  clientCache.getOrFetch('events', fetcher1, { ttl: 5000 });
  assert.strictEqual(callCount, 1);

  // Invalidate while fetch 1 is in-flight (version increments to 2)
  clientCache.invalidate('events');

  // Next fetch should NOT coalesce onto fetch 1 because inFlightVersion (1) !== version (2)
  const fetcher2 = async () => {
    callCount++;
    return [{ id: 'e2', title: 'Fresh Event After Invalidation' }];
  };

  const p2 = clientCache.getOrFetch('events', fetcher2, { ttl: 5000 });
  assert.strictEqual(callCount, 2, 'Should initiate fresh fetch rather than coalescing');

  resolveFirst([{ id: 'e1', title: 'Stale Event' }]);
  const res2 = await p2;
  assert.deepStrictEqual(res2, [{ id: 'e2', title: 'Fresh Event After Invalidation' }]);
});

await test('Promise identity guard in .finally(): superseded fetch does not clear active promise', async () => {
  let resolveFetch1;
  let resolveFetch2;

  const fetcher1 = () =>
    new Promise((resolve) => {
      resolveFetch1 = resolve;
    });
  const fetcher2 = () =>
    new Promise((resolve) => {
      resolveFetch2 = resolve;
    });

  // Fetch 1 starts
  clientCache.getOrFetch('key', fetcher1, { ttl: 1000 });
  const entry = clientCache.entries.get(clientCache.getScopedKey('key'));
  const p1 = entry.promise;

  // Invalidation occurs
  clientCache.invalidate('key');

  // Fetch 2 starts
  clientCache.getOrFetch('key', fetcher2, { ttl: 1000 });
  const p2 = entry.promise;
  assert.notStrictEqual(p1, p2);

  // Fetch 1 resolves earlier
  resolveFetch1('data 1');
  await new Promise((r) => setTimeout(r, 10));

  // Fetch 2 MUST still be the active in-flight promise!
  assert.strictEqual(entry.promise, p2, 'Fetch 1 should NOT have wiped Fetch 2 promise tracking');

  // Fetch 2 resolves
  resolveFetch2('data 2');
  await p2;
  await new Promise((r) => setTimeout(r, 10));

  // Now promise should be cleanly null
  assert.strictEqual(entry.promise, null);
});

await test('Stale-on-error fallback resilience', async () => {
  // Populate cache initially
  await clientCache.getOrFetch('profile', async () => ({ name: 'Alice' }), { ttl: 100 });
  assert.deepStrictEqual(clientCache.getSnapshot('profile').data, { name: 'Alice' });

  // Expire TTL
  await new Promise((r) => setTimeout(r, 150));
  assert.strictEqual(clientCache.isStale('profile', 100), true);

  // Revalidate with a throwing network error
  let threw = false;
  try {
    await clientCache.getOrFetch(
      'profile',
      async () => {
        throw new Error('500 Internal Server Error');
      },
      { ttl: 100 }
    );
  } catch {
    threw = true;
  }
  assert.strictEqual(threw, true);

  // Cached data MUST still be preserved!
  const snapshot = clientCache.getSnapshot('profile');
  assert.deepStrictEqual(snapshot.data, { name: 'Alice' }, 'Stale data should remain intact');
  assert.strictEqual(snapshot.error?.message, '500 Internal Server Error');
});

await test('Account-scoped keys prevent cross-user leakage', async () => {
  currentTestUserId = 'user_alice';
  await clientCache.getOrFetch('secret_notes', async () => ['Alice Secret Note'], { ttl: 5000 });
  assert.deepStrictEqual(clientCache.getSnapshot('secret_notes').data, ['Alice Secret Note']);

  // Switch to Bob
  currentTestUserId = 'user_bob';
  const bobSnap = clientCache.getSnapshot('secret_notes');
  assert.strictEqual(bobSnap.data, undefined, "Bob must not see Alice's cached data");
});

await test('Epoch counter discards pending resolutions on clear()', async () => {
  let resolveNetwork;
  const fetcher = () =>
    new Promise((resolve) => {
      resolveNetwork = resolve;
    });

  const p = clientCache.getOrFetch('async_item', fetcher, { ttl: 5000 });

  // User logs out while fetch is in flight
  clientCache.clear();
  assert.strictEqual(clientCache.getSnapshot('async_item').data, undefined);

  // Network returns
  resolveNetwork({ sensitive: 'user data' });
  await p.catch(() => {});

  // Entry should NOT be re-populated after clear()
  assert.strictEqual(clientCache.getSnapshot('async_item').data, undefined);
});

await test('Prefix invalidation (e.g. store:* or resources:*)', async () => {
  await clientCache.getOrFetch('store:listings', async () => ['L1'], { ttl: 5000 });
  await clientCache.getOrFetch('store:inventory', async () => ['I1'], { ttl: 5000 });
  await clientCache.getOrFetch('other:data', async () => ['O1'], { ttl: 5000 });

  assert.strictEqual(clientCache.isStale('store:listings', 5000), false);
  assert.strictEqual(clientCache.isStale('store:inventory', 5000), false);
  assert.strictEqual(clientCache.isStale('other:data', 5000), false);

  clientCache.invalidatePrefix('store:');

  assert.strictEqual(clientCache.isStale('store:listings', 5000), true);
  assert.strictEqual(clientCache.isStale('store:inventory', 5000), true);
  assert.strictEqual(clientCache.isStale('other:data', 5000), false, 'Unrelated keys remain fresh');
});

await test('Protected LRU eviction preserves active subscribers and in-flight promises', async () => {
  const smallCache = new (clientCache.constructor)(3); // capacity of 3
  smallCache.setUserIdProvider(() => 'test_user');

  // Key 1 has an active subscriber
  const unsub1 = smallCache.subscribe('key1', () => {});
  await smallCache.getOrFetch('key1', async () => 'v1', { ttl: 5000 });

  // Key 2 has an active in-flight promise
  let resolveK2;
  const pK2 = smallCache.getOrFetch(
    'key2',
    () => new Promise((resolve) => (resolveK2 = resolve)),
    { ttl: 5000 }
  );

  // Key 3 is idle
  await smallCache.getOrFetch('key3', async () => 'v3', { ttl: 5000 });

  // Add Key 4: should evict Key 3, NOT Key 1 (active subscriber) or Key 2 (in-flight promise)
  await smallCache.getOrFetch('key4', async () => 'v4', { ttl: 5000 });

  assert.strictEqual(smallCache.getSnapshot('key1').data, 'v1', 'Key 1 with active subscriber preserved');
  assert.strictEqual(smallCache.entries.has(smallCache.getScopedKey('key2')), true, 'Key 2 with in-flight fetch preserved');
  assert.strictEqual(smallCache.getSnapshot('key3').data, undefined, 'Key 3 was evicted cleanly');
  assert.strictEqual(smallCache.getSnapshot('key4').data, 'v4', 'Key 4 added');

  resolveK2('v2');
  await pK2;
  unsub1();
});

console.log(`\nResults: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);
