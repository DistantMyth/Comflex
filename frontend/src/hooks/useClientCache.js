/**
 * useClientCache.js — React 19 SWR hook powered by useSyncExternalStore.
 *
 * Guarantees:
 * - Tear-free rendering via useSyncExternalStore.
 * - Reference-stable snapshots to avoid infinite render loops.
 * - Reactive revalidation when entries are invalidated while mounted (via snapshot.version).
 * - Stale-closure elimination for fetcher and onSuccess callbacks.
 * - Eliminates 1-frame cold-start paint flash.
 */

import { useSyncExternalStore, useEffect, useRef, useCallback } from 'react';
import { clientCache } from '../utils/clientCache';

export function useClientCache(key, fetcherFn, options = {}) {
  const { ttl = 60000, enabled = true, initialData } = options;

  const fetcherRef = useRef(fetcherFn);
  fetcherRef.current = fetcherFn;

  const onSuccessRef = useRef(options.onSuccess);
  onSuccessRef.current = options.onSuccess;

  const prevDataRef = useRef(initialData);

  // Subscribe to external store via standard React 19 API
  const subscribe = useCallback(
    (onStoreChange) => {
      if (!enabled || !key) return () => {};
      return clientCache.subscribe(key, onStoreChange);
    },
    [key, enabled]
  );

  const getSnapshot = useCallback(() => {
    if (!enabled || !key) return clientCache.getServerSnapshot();
    return clientCache.getSnapshot(key);
  }, [key, enabled]);

  const getServerSnapshot = useCallback(() => {
    return clientCache.getServerSnapshot();
  }, []);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Trigger initial SWR evaluation & re-evaluate when invalidated (snapshot.version bumps)
  useEffect(() => {
    if (!enabled || !key) return;

    if (clientCache.isStale(key, ttl)) {
      clientCache.getOrFetch(key, () => fetcherRef.current(), {
        ttl,
        initialData,
      }).catch(() => {
        // Errors are captured inside the cache snapshot error property
      });
    }
  }, [key, enabled, ttl, initialData, snapshot.version]);

  // Fire onSuccess when fresh data arrives
  useEffect(() => {
    if (snapshot?.data !== undefined && snapshot.data !== prevDataRef.current) {
      prevDataRef.current = snapshot.data;
      onSuccessRef.current?.(snapshot.data);
    }
  }, [snapshot?.data]);

  const refresh = useCallback(() => {
    if (!key) return Promise.resolve();
    clientCache.invalidate(key);
    return clientCache.getOrFetch(key, () => fetcherRef.current(), { ttl, initialData });
  }, [key, ttl, initialData]);

  const mutate = useCallback(
    (updater) => {
      if (!key) return;
      clientCache.mutate(key, updater);
    },
    [key]
  );

  const data = snapshot?.data !== undefined ? snapshot.data : initialData;
  // Prevent 1-frame cold-start paint flash
  const loading = enabled && ((snapshot?.data === undefined && !snapshot?.error) || Boolean(snapshot?.loading));
  const isRevalidating = Boolean(snapshot?.isRevalidating);
  const error = snapshot?.error ?? null;

  return {
    data,
    loading,
    isRevalidating,
    error,
    refresh,
    mutate,
  };
}

export default useClientCache;
