"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import type { Episode } from "@/db/schema";

/**
 * Every episode row, newest air date first — the library's one full-table live
 * query. It re-runs (and the library re-renders) on any write to `episodes`,
 * which is why the player's position saves no longer go there (HD-016): they
 * write `progress`. `position-save-quiet.test.tsx` holds that a save leaves
 * this query asleep, with a control proving an episodes write wakes it.
 */
export function useLibraryEpisodes(): Episode[] | undefined {
  return useLiveQuery(() => db.episodes.orderBy("airDate").reverse().toArray(), []);
}
