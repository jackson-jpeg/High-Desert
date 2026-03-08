"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { fetchEpisodeCounts } from "@/services/stats/client";

const DEBOUNCE_MS = 300;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  count: number;
  fetchedAt: number;
}

// Shared cache across hook instances (module-level)
const cache = new Map<string, CacheEntry>();

/**
 * Debounced batch-fetching of episode play counts with client-side caching.
 * Pass the archiveIdentifiers of currently-visible episodes; the hook coalesces
 * requests, skips cached entries, and returns a Map of id → play count.
 */
export function useCommunityStats(archiveIds: string[]): Map<string, number> {
  const [counts, setCounts] = useState<Map<string, number>>(() => new Map());
  const prevKeyRef = useRef<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doFetch = useCallback(async (ids: string[]) => {
    const now = Date.now();

    // Filter to IDs that need fetching (not cached or stale)
    const needed = ids.filter((id) => {
      const entry = cache.get(id);
      if (!entry) return true;
      return now - entry.fetchedAt > CACHE_TTL;
    });

    // Always build result from cache + fresh data
    const buildResult = () => {
      const result = new Map<string, number>();
      for (const id of ids) {
        const entry = cache.get(id);
        if (entry) result.set(id, entry.count);
      }
      return result;
    };

    if (needed.length === 0) {
      setCounts(buildResult());
      return;
    }

    const freshCounts = await fetchEpisodeCounts(needed);
    const fetchedAt = Date.now();

    // Cache all fetched results (including zeros for IDs not in response)
    for (const id of needed) {
      cache.set(id, {
        count: freshCounts[id] ?? 0,
        fetchedAt,
      });
    }

    setCounts(buildResult());
  }, []);

  useEffect(() => {
    // Filter out empty/falsy IDs
    const validIds = archiveIds.filter(Boolean);
    if (validIds.length === 0) {
      setCounts(new Map()); // eslint-disable-line react-hooks/set-state-in-effect -- clear state on empty input
      return;
    }

    // Skip if IDs haven't changed
    const key = validIds.slice().sort().join(",");
    if (key === prevKeyRef.current) return;
    prevKeyRef.current = key;

    // Debounce the fetch
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      doFetch(validIds);
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [archiveIds, doFetch]);

  return counts;
}
