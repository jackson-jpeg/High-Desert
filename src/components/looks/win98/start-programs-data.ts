"use client";

import { useEffect, useState } from "react";
import { useLiveStore, serverNow } from "@/stores/live-store";
import { formatStationTime } from "@/lib/live/format";
import { recentlyPlayedEpisodes } from "@/services/episodes/progress";
import { episodeTitle } from "@/lib/library/display-title";
import { communityKey } from "@/lib/utils/community-key";
import { RECENT_MAX, type RecentEntry, type TonightEntry } from "./start-menu";

/** How many of tonight's shows the menu lists: the one on the air and what follows. */
export const TONIGHT_MAX = 8;

/** Tonight's Shows from the day's log: the show on the air, then the rest of the night. */
export function tonightEntries(guide: readonly { title: string; start: number; end: number }[], now: number): TonightEntry[] {
  return guide
    .filter((s) => s.end > now)
    .slice(0, TONIGHT_MAX)
    .map((s) => ({ time: formatStationTime(s.start), title: s.title, onAir: s.start <= now && now < s.end }));
}

export function useTonightEntries(): TonightEntry[] {
  const guide = useLiveStore((s) => s.schedule?.guide ?? null);
  return guide ? tonightEntries(guide, serverNow()) : [];
}

/** The listener's last shows, read when the menu opens (never on every render). */
export function useRecentEntries(open: boolean): RecentEntry[] {
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    recentlyPlayedEpisodes(RECENT_MAX)
      .then((rows) => {
        if (!live) return;
        // A local file has no key, so no Library link: it is left out.
        const entries = rows.flatMap(({ episode }) => {
          const key = communityKey(episode);
          return key ? [{ title: episodeTitle(episode), key }] : [];
        });
        setRecent(entries);
      })
      // A library that cannot be read lists nothing; the menu still works.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open]);
  return recent;
}
