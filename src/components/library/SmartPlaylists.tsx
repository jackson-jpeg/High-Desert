"use client";

import { useState, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import type { Episode } from "@/db/schema";
import { usePlayerStore } from "@/stores/player-store";
import { Window } from "@/components/win98";
import { toast } from "@/stores/toast-store";
import { cn } from "@/lib/utils/cn";
import { SmartPlaylistsSkeleton } from "./SmartPlaylistsSkeleton";

interface SmartPlaylistsProps {
  onPlay: (episode: Episode) => void;
  className?: string;
}

type SmartList = {
  key: string;
  label: string;
  icon: string;
  episodes: Episode[];
};

function SmartPlaylistsContent({ onPlay, className }: SmartPlaylistsProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const allEpisodes = useLiveQuery(
    () => db.episodes.toArray(),
    [],
  );

  const lists = useMemo((): SmartList[] => {
    if (!allEpisodes || allEpisodes.length === 0) return [];

    const unlistened = allEpisodes
      .filter((ep) => !ep.playbackPosition || ep.playbackPosition === 0)
      .slice(0, 50);

    const mostPlayed = [...allEpisodes]
      .filter((ep) => (ep.playCount ?? 0) > 0)
      .sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0))
      .slice(0, 30);

    const recentlyAdded = [...allEpisodes]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 30);

    // By decade
    const decadeMap = new Map<string, Episode[]>();
    for (const ep of allEpisodes) {
      const year = ep.airDate?.slice(0, 4);
      if (!year || year === "Unkn") continue;
      const decade = year.slice(0, 3) + "0s";
      const list = decadeMap.get(decade) ?? [];
      list.push(ep);
      decadeMap.set(decade, list);
    }
    const decades = Array.from(decadeMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([decade, eps]) => ({
        key: `decade-${decade}`,
        label: decade,
        icon: "\u{1F4C5}",
        episodes: eps.sort((a, b) => (a.airDate ?? "").localeCompare(b.airDate ?? "")),
      }));

    const result: SmartList[] = [];

    if (unlistened.length > 0) {
      result.push({ key: "unlistened", label: "Unlistened", icon: "\u{1F195}", episodes: unlistened });
    }
    if (mostPlayed.length > 0) {
      result.push({ key: "most-played", label: "Most Played", icon: "\u{1F525}", episodes: mostPlayed });
    }
    result.push({ key: "recently-added", label: "Recently Added", icon: "\u{2728}", episodes: recentlyAdded });
    result.push(...decades);

    return result;
  }, [allEpisodes]);

  if (lists.length === 0) {
    return (
      <Window title="Smart Playlists" variant="dark" className={className}>
        <div className="p-4 flex flex-col gap-3">
          <div className="text-[13px] text-desktop-gray font-bold">
            No Episodes Available
          </div>
          <div className="text-[11px] text-bevel-dark leading-relaxed">
            Add some episodes to your library to see smart playlists here.
          </div>
        </div>
      </Window>
    );
  }

  const handlePlayAll = (list: SmartList) => {
    const store = usePlayerStore.getState();
    store.enqueueMany(list.episodes);
    if (list.episodes[0]) {
      onPlay(list.episodes[0]);
    }
    toast.info(`Playing "${list.label}" (${list.episodes.length} episodes)`);
  };

  const handleShuffle = (list: SmartList) => {
    const store = usePlayerStore.getState();
    const shuffled = [...list.episodes].sort(() => Math.random() - 0.5);
    store.enqueueMany(shuffled);
    if (shuffled[0]) {
      onPlay(shuffled[0]);
    }
    toast.info(`Shuffling "${list.label}" (${shuffled.length} episodes)`);
  };

  return (
    <Window title="Smart Playlists" variant="dark" className={className}>
      <div className="p-2 flex flex-col gap-0.5 max-h-[350px] overflow-auto">
        {lists?.map((list) => (
          <div key={list.key}>
            <button
              onClick={() => setExpanded(expanded === list.key ? null : list.key)}
              className={cn(
                "flex items-center gap-2 w-full text-left px-2 py-2.5 md:py-1.5 min-h-[44px] md:min-h-0 cursor-pointer transition-colors-fast",
                expanded === list.key
                  ? "bg-title-bar-blue/15 text-desktop-gray"
                  : "text-bevel-dark hover:text-desktop-gray hover:bg-title-bar-blue/10",
              )}
            >
              <span className="text-[12px] md:text-[10px]">{list.icon}</span>
              <span className="text-[12px] md:text-[10px] flex-1">{list.label}</span>
              <span className="text-[10px] md:text-[8px] text-bevel-dark/50 tabular-nums">
                {list.episodes.length}
              </span>
            </button>

            {expanded === list.key && (
              <div className="pl-4 flex flex-col gap-0.5 py-1">
                {/* Action row */}
                <div className="flex items-center gap-2 px-2 pb-1">
                  <button
                    onClick={() => handlePlayAll(list)}
                    className="text-[11px] md:text-[8px] text-title-bar-blue hover:text-title-bar-blue/80 active:text-title-bar-blue cursor-pointer min-h-[32px] md:min-h-0 px-1"
                  >
                    {"\u25B6"} Play All
                  </button>
                  <button
                    onClick={() => handleShuffle(list)}
                    className="text-[11px] md:text-[8px] text-desert-amber hover:text-desert-amber/80 active:text-desert-amber cursor-pointer min-h-[32px] md:min-h-0 px-1"
                  >
                    {"\u21C6"} Shuffle
                  </button>
                </div>
                {list.episodes?.slice(0, 15).map((ep) => (
                  <button
                    key={ep.id}
                    onClick={() => onPlay(ep)}
                    className="flex items-center gap-2 text-left px-2 py-2 md:py-1 min-h-[36px] md:min-h-0 cursor-pointer hover:bg-title-bar-blue/10 active:bg-title-bar-blue/15 transition-colors-fast"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] md:text-[9px] text-desktop-gray/80 truncate">
                        {ep.title || ep.fileName}
                      </div>
                    </div>
                    {ep.airDate && (
                      <span className="text-[9px] md:text-[7px] text-bevel-dark/40 tabular-nums flex-shrink-0">
                        {ep.airDate}
                      </span>
                    )}
                  </button>
                ))}
                {list.episodes?.length > 15 && (
                  <div className="text-[8px] text-bevel-dark/40 px-2 py-0.5">
                    +{list.episodes.length - 15} more
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </Window>
  );
}

import { SmartPlaylistErrorBoundary } from "./SmartPlaylistErrorBoundary";

export function SmartPlaylists({ onPlay, className }: SmartPlaylistsProps) {
  return (
    <SmartPlaylistErrorBoundary>
      <SmartPlaylistsContent onPlay={onPlay} className={className} />
    </SmartPlaylistErrorBoundary>
  );
}
    </SmartPlaylistErrorBoundary>
  );
}
