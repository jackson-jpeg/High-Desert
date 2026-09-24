"use client";

import { useEffect, useSyncExternalStore } from "react";
import { fetchCommunityCatalog } from "@/services/stats/client";
import { NO_COMMUNITY, type CommunityIndex } from "@/lib/library/sort-keys";

/**
 * Community plays and ratings for every episode, shared by every caller.
 *
 * Replaces a windowed fetch of the ~20 rows on screen. "Most played" sorted by
 * this browser's own play count while the Plays column showed community counts
 * for whichever rows had been fetched — so the order and the number beside it
 * came from two sources and the column read 41, 6, 78, 120… The sort, the
 * group headers and the column now all read this one map.
 *
 * Fetched on first use and refreshed at most once a minute, matching the
 * route's proxy cache.
 */

const REFRESH_MS = 60_000;

let index: CommunityIndex = NO_COMMUNITY;
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function refresh(): void {
  if (inflight || Date.now() - fetchedAt < REFRESH_MS) return;
  inflight = fetchCommunityCatalog()
    .then((episodes) => {
      fetchedAt = Date.now();
      if (!episodes) return;
      index = new Map(Object.entries(episodes));
      for (const l of listeners) l();
    })
    .finally(() => {
      inflight = null;
    });
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useCommunityCatalog(): CommunityIndex {
  const current = useSyncExternalStore(subscribe, () => index, () => NO_COMMUNITY);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, []);
  return current;
}

/** Tests only. */
export function resetCommunityCatalogForTests(): void {
  index = NO_COMMUNITY;
  fetchedAt = 0;
  inflight = null;
  listeners.clear();
}
