"use client";

import { useState, useEffect, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Episode } from "@/db";
import { Window } from "@/components/win98";
import { fetchLeaderboard } from "@/services/stats/client";
import { formatAirDate } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import { communityKey } from "@/lib/utils/community-key";

type Period = "alltime" | "week";

interface LeaderboardEntry {
  episodeId: string;
  plays: number;
}

export function CommunityLeaderboard() {
  const [period, setPeriod] = useState<Period>("alltime");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect -- sync loading state before async fetch
    fetchLeaderboard(period).then((data) => {
      if (!cancelled) {
        setEntries(data);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [period]);

  const entryKeys = entries.map((e) => e.episodeId);

  // Build a Map<communityKey, Episode> from all episodes — 1313 entries is trivial
  const keyToEpisode = useLiveQuery(
    async (): Promise<Map<string, Episode>> => {
      if (entryKeys.length === 0) return new Map();
      const all = await db.episodes.toArray();
      const map = new Map<string, Episode>();
      for (const ep of all) {
        const key = communityKey(ep);
        if (key) map.set(key, ep);
      }
      return map;
    },
    [entryKeys.join(",")],
  );

  const handlePlay = useCallback(
    (episodeId: string) => {
      const ep = keyToEpisode?.get(episodeId);
      if (ep) {
        window.dispatchEvent(
          new CustomEvent("hd:play-episode", { detail: ep }),
        );
      }
    },
    [keyToEpisode],
  );

  if (!loading && entries.length === 0) return null;

  const maxPlays = entries[0]?.plays ?? 1;

  return (
    <Window title="Community Top 20" variant="dark" headingLevel={2}>
      <div className="p-3">
        {/* Period toggle */}
        <div className="flex items-center gap-1 mb-3">
          {(["alltime", "week"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "px-2 py-0.5 text-hd-9 transition-colors-fast cursor-pointer",
                period === p
                  ? "text-desert-amber w98-inset-dark bg-inset-well"
                  : "text-bevel-dark hover:text-desktop-gray",
              )}
            >
              {p === "alltime" ? "All Time" : "This Week"}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-4 text-hd-10 text-bevel-dark">
            Loading...
          </div>
        ) : (
          <div className="flex flex-col gap-[3px]">
            {entries.map((entry, i) => {
              const ep = keyToEpisode?.get(entry.episodeId);
              const pct = (entry.plays / maxPlays) * 100;
              return (
                <button
                  key={entry.episodeId}
                  onClick={() => handlePlay(entry.episodeId)}
                  className="flex items-center gap-2 text-left w-full px-1 py-0.5 cursor-pointer hover:bg-title-bar-blue/15 transition-colors-fast group"
                >
                  <span className="text-hd-8 text-bevel-dark/60 tabular-nums w-[14px] text-right flex-shrink-0">
                    {i + 1}
                  </span>
                  <div className="flex flex-col min-w-0 w-[120px] md:w-[160px] flex-shrink-0">
                    <span className="text-hd-10 text-desktop-gray truncate">
                      {ep?.title || ep?.fileName || entry.episodeId}
                    </span>
                    {ep?.airDate && (
                      <span className="text-hd-8 text-bevel-dark/50 tabular-nums">
                        {formatAirDate(ep.airDate)}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 h-[10px] w98-inset-dark bg-inset-well overflow-hidden">
                    <div
                      className="h-full bg-desert-amber/40 animate-bar-grow"
                      style={{
                        width: `${pct}%`,
                        "--i": i,
                      } as React.CSSProperties}
                    />
                  </div>
                  <span className="text-hd-8 text-bevel-dark tabular-nums w-[28px] text-right flex-shrink-0">
                    {entry.plays}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Window>
  );
}
