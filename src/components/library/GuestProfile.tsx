"use client";

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import type { Episode } from "@/db/schema";
import { usePlayerStore } from "@/stores/player-store";
import { Button } from "@/components/win98";
import { cn } from "@/lib/utils/cn";
import { formatDuration } from "@/lib/utils/format";

interface GuestProfileProps {
  guestName: string;
  onPlay: (episode: Episode) => void;
  onClose: () => void;
  className?: string;
}

export function GuestProfile({ guestName, onPlay, onClose, className }: GuestProfileProps) {
  const episodes = useLiveQuery(
    () => db.episodes.where("guestName").equals(guestName).sortBy("airDate"),
    [guestName],
  );

  if (!guestName || typeof guestName !== 'string' || guestName.trim() === '') {
    return (
      <div
        className={cn(
          "w98-raised-dark bg-raised-surface flex flex-col animate-slide-up glass-heavy",
          className,
        )}
      >
        {/* Mobile drag handle */}
        <div className="flex justify-center pt-2 pb-0.5 md:hidden">
          <div className="w-8 h-[3px] rounded-full bg-white/15" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-bevel-dark/20 glass-divider">
          <span className="text-[11px] md:text-[9px] text-bevel-dark/70">Guest Profile</span>
          <button
            onClick={onClose}
            className="text-[14px] md:text-[10px] text-bevel-dark hover:text-desktop-gray active:text-desktop-gray cursor-pointer flex-shrink-0 min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-3 pb-[calc(0.75rem+var(--safe-bottom))] md:pb-3 flex flex-col gap-3 max-h-[80vh] md:max-h-none overflow-auto overscroll-contain md:flex-1">
          <div className="text-[14px] md:text-[12px] text-desktop-gray text-center py-8">
            No guest information available
          </div>
        </div>
      </div>
    );
  }

  if (!episodes || !Array.isArray(episodes)) {
    return (
      <div
        className={cn(
          "w98-raised-dark bg-raised-surface flex flex-col animate-slide-up glass-heavy",
          className,
        )}
      >
        {/* Mobile drag handle */}
        <div className="flex justify-center pt-2 pb-0.5 md:hidden">
          <div className="w-8 h-[3px] rounded-full bg-white/15" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-bevel-dark/20 glass-divider">
          <span className="text-[11px] md:text-[9px] text-bevel-dark/70">Guest Profile</span>
          <button
            onClick={onClose}
            className="text-[14px] md:text-[10px] text-bevel-dark hover:text-desktop-gray active:text-desktop-gray cursor-pointer flex-shrink-0 min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-3 pb-[calc(0.75rem+var(--safe-bottom))] md:pb-3 flex flex-col gap-3 max-h-[80vh] md:max-h-none overflow-auto overscroll-contain md:flex-1">
          <div className="text-[16px] md:text-[14px] text-static-green font-bold">
            {guestName}
          </div>
          <div className="text-[14px] md:text-[12px] text-desktop-gray text-center py-8">
            No episodes found for this guest
          </div>
        </div>
      </div>
    );
  }

  const stats = useMemo(() => {
    if (!episodes || !Array.isArray(episodes) || episodes.length === 0) return null;
    const years = episodes
      .map((ep) => ep?.airDate?.slice(0, 4))
      .filter(Boolean) as string[];
    const uniqueYears = [...new Set(years)].sort();
    const firstYear = uniqueYears[0] ?? "?";
    const lastYear = uniqueYears[uniqueYears.length - 1] ?? "?";

    const categories = new Map<string, number>();
    for (const ep of episodes) {
      if (ep?.aiCategory) {
        categories.set(ep.aiCategory, (categories.get(ep.aiCategory) ?? 0) + 1);
      }
    }

    return {
      count: episodes.length,
      yearRange: firstYear === lastYear ? firstYear : `${firstYear}–${lastYear}`,
      categories: Array.from(categories.entries()).sort((a, b) => b[1] - a[1]),
    };
  }, [episodes]);

  const handlePlayAll = () => {
    if (!episodes || !Array.isArray(episodes) || episodes.length === 0) return;
    const store = usePlayerStore.getState();
    store.enqueueMany(episodes);
    const firstEpisode = episodes[0];
    if (!firstEpisode || !firstEpisode.id) return;
    window.dispatchEvent(new CustomEvent("hd:play-episode", { detail: firstEpisode }));
  };

  const handleShuffle = () => {
    if (!episodes || !Array.isArray(episodes) || episodes.length === 0) return;
    const shuffled = [...episodes].sort(() => Math.random() - 0.5);
    const store = usePlayerStore.getState();
    store.enqueueMany(shuffled);
    const firstEpisode = shuffled[0];
    if (!firstEpisode || !firstEpisode.id) return;
    window.dispatchEvent(new CustomEvent("hd:play-episode", { detail: firstEpisode }));
  };

  return (
    <div
      className={cn(
        "w98-raised-dark bg-raised-surface flex flex-col animate-slide-up glass-heavy",
        className,
      )}
    >
      {/* Mobile drag handle */}
      <div className="flex justify-center pt-2 pb-0.5 md:hidden">
        <div className="w-8 h-[3px] rounded-full bg-white/15" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-bevel-dark/20 glass-divider">
        <span className="text-[11px] md:text-[9px] text-bevel-dark/70">Guest Profile</span>
        <button
          onClick={onClose}
          className="text-[14px] md:text-[10px] text-bevel-dark hover:text-desktop-gray active:text-desktop-gray cursor-pointer flex-shrink-0 min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="p-3 pb-[calc(0.75rem+var(--safe-bottom))] md:pb-3 flex flex-col gap-3 max-h-[80vh] md:max-h-none overflow-auto overscroll-contain md:flex-1">
        {/* Name */}
        <div className="text-[16px] md:text-[14px] text-static-green font-bold">
          {guestName}
        </div>

        {/* Stats */}
        {stats && (
          <div className="flex items-center gap-3 text-[10px] md:text-[9px]">
            <span className="text-desktop-gray">{stats.count} episode{stats.count !== 1 ? "s" : ""}</span>
            <span className="text-desert-amber tabular-nums">{stats.yearRange}</span>
          </div>
        )}

        {/* Category cloud */}
        {stats && stats.categories.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {stats.categories.map(([cat, count]) => (
              <span
                key={cat}
                className="text-[11px] md:text-[8px] text-desert-amber/70 bg-desert-amber/8 px-2 py-1 md:px-1.5 md:py-px"
              >
                {cat}
                <span className="ml-0.5 opacity-50">{count}</span>
              </span>
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <Button variant="dark" size="sm" onClick={handlePlayAll} disabled={!episodes || episodes.length === 0}>
            ▶ Play All
          </Button>
          <Button size="sm" onClick={handleShuffle} disabled={!episodes || episodes.length === 0}>
            ⤮ Shuffle
          </Button>
        </div>

        {/* Episode list */}
        {episodes && episodes.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-bevel-dark/15 pt-2">
            {episodes.map((ep) => {
              if (!ep || !ep.id) return null;
              const hasProgress = (ep.playbackPosition ?? 0) > 0 && (ep.duration ?? 0) > 0;
              const progressPct = hasProgress
                ? Math.min(100, (ep.playbackPosition! / ep.duration!) * 100)
                : 0;
              return (
                <button
                  key={ep.id}
                  onClick={() => onPlay(ep)}
                  className="text-left px-3 py-2.5 md:px-2 md:py-1.5 hover:bg-title-bar-blue/15 active:bg-title-bar-blue/15 cursor-pointer transition-colors-fast w98-raised-dark bg-card-surface"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] md:text-[10px] text-desert-amber tabular-nums flex-shrink-0">
                      {ep.airDate ?? "Unknown"}
                    </span>
                    {ep.duration != null && (
                      <span className="text-[11px] md:text-[9px] text-bevel-dark/70 tabular-nums flex-shrink-0">
                        {formatDuration(ep.duration)}
                      </span>
                    )}
                  </div>
                  <div className="text-[13px] md:text-[10px] text-desktop-gray truncate mt-0.5">
                    {ep.title || ep.fileName || 'Unknown Episode'}
                  </div>
                  {hasProgress && (
                    <div className="h-[2px] mt-1 bg-inset-well w98-inset-dark overflow-hidden">
                      <div
                        className={cn(
                          "h-full",
                          progressPct > 90 ? "bg-static-green/40" : "bg-phosphor-amber/60",
                        )}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
