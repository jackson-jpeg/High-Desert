"use client";

import { useTimedLiveQuery } from "@/hooks/useTimedLiveQuery";
import { db } from "@/db";
import type { Episode } from "@/db/schema";

/**
 * Every episode row, newest air date first — the library's one full-table live
 * query. It re-runs (and the library re-renders) on any write to `episodes`,
 * which is why the player's position saves no longer go there (HD-016): they
 * write `progress`. `position-save-quiet.test.tsx` holds that a save leaves
 * this query asleep, with a control proving an episodes write wakes it.
 *
 * Timed (useTimedLiveQuery): if the read has not answered in DB_WAIT_MS the
 * page shows an error with Retry instead of gray rows forever (2026-10-13).
 */
export function useLibraryEpisodes(): { value: Episode[] | undefined; timedOut: boolean; retry: () => void } {
  return useTimedLiveQuery(() => db.episodes.orderBy("airDate").reverse().toArray(), []);
}
