"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Episode } from "@/db";
import { communityKey } from "@/lib/utils/community-key";

const EMPTY = new Map<string, Episode>();

/**
 * Map of community key → local episode, for turning the ids the stats API
 * returns back into titles.
 *
 * `communityKey` is derived, not stored, so there is no index to look it up by
 * and the whole table has to be walked. That is fine once — it is ~1,300 rows —
 * but the panels that need it poll every few seconds, so it must not rebuild on
 * every render, and it must not be a plain `useLiveQuery` over `toArray()`:
 * that re-runs on *any* write to `episodes`, and playback position is written
 * throughout playback. Rebuilding is therefore keyed on the row count, which
 * settles immediately after seeding and then never changes.
 *
 * Pass `enabled: false` to skip the work entirely when nothing will render it.
 */
export function useCommunityKeyIndex(enabled = true): Map<string, Episode> {
  const count = useLiveQuery(() => db.episodes.count(), [], 0);
  const [index, setIndex] = useState<Map<string, Episode>>(EMPTY);

  useEffect(() => {
    if (!enabled || !count) return;
    let cancelled = false;
    db.episodes
      .toArray()
      .then((eps) => {
        if (cancelled) return;
        const map = new Map<string, Episode>();
        for (const ep of eps) {
          const key = communityKey(ep);
          if (key) map.set(key, ep);
        }
        setIndex(map);
      })
      .catch(() => {
        // Leave the previous index in place; the panels fall back to showing
        // the raw id rather than disappearing.
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, count]);

  return index;
}
