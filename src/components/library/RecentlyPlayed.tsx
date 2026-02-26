"use client";

import type { Episode } from "@/db/schema";
import { cn } from "@/lib/utils/cn";

interface RecentlyPlayedProps {
  episodes: Episode[];
  onPlay: (episode: Episode) => void;
  compact?: boolean;
  className?: string;
}

export function RecentlyPlayed({ episodes, onPlay, compact, className }: RecentlyPlayedProps) {
  if (!episodes || episodes.length === 0 || !Array.isArray(episodes)) {
    return (
      <div className={cn("flex flex-col gap-1", className)}>
        {!compact && (
          <div className="px-1">
            <span className="text-[11px] md:text-[9px] text-bevel-dark/60 uppercase tracking-wider">
              Recently Played
            </span>
          </div>
        )}
        <div className="w98-raised-dark bg-raised-surface px-3 py-4">
          <div className="text-[11px] md:text-[9px] text-bevel-dark/50 text-center">
            No recently played episodes
          </div>
        </div>
      </div>
    );
  }

  const validEpisodes = episodes.filter(ep => 
    ep != null && 
    typeof ep === 'object' &&
    (ep.title || ep.fileName) && 
    ep.id != null
  );

  const displayEpisodes = compact ? validEpisodes.slice(0, 4) : validEpisodes;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {!compact && (
        <div className="px-1">
          <span className="text-[11px] md:text-[9px] text-bevel-dark/60 uppercase tracking-wider">
            Recently Played
          </span>
        </div>
      )}
      <div className={cn(
        "flex gap-2 overflow-x-auto scrollbar-thin",
        compact ? "pb-0.5" : "pb-1.5 snap-x snap-mandatory md:snap-none",
      )}>
        {displayEpisodes.map((ep) => {
          if (!ep) return null;
          const hasProgress = typeof ep.playbackPosition === 'number' && 
            typeof ep.duration === 'number' && 
            ep.playbackPosition > 0 && 
            ep.duration > 0;
          const progressPct = hasProgress
            ? Math.min(100, (ep.playbackPosition! / ep.duration!) * 100)
            : 0;
          const isCompleted = hasProgress && progressPct > 90;

          return (
            <button
              key={ep.id}
              onClick={() => onPlay(ep)}
              className={cn(
                "flex-shrink-0 w98-raised-dark bg-card-surface group",
                "hover:bg-title-bar-blue/15 hover:-translate-y-px hover:shadow-[0_2px_8px_rgba(0,0,0,0.3)]",
                "active:bg-title-bar-blue/25 active:scale-[0.98]",
                "transition-all duration-150 cursor-pointer",
                "flex flex-col gap-0.5 relative",
                compact ? "w-[130px] p-1.5" : "w-[180px] md:w-[140px] p-2.5 md:p-1.5 snap-start",
              )}
            >
              <span className={cn(
                "text-desert-amber/80 tabular-nums",
                compact ? "text-[8px]" : "text-[11px] md:text-[9px]",
              )}>
                {ep.airDate || "Unknown"}
              </span>
              <span className={cn(
                "text-desktop-gray font-bold truncate w-full text-left",
                compact ? "text-[9px]" : "text-[12px] md:text-[10px]",
              )}>
                {ep.title || ep.fileName || "Untitled Episode"}
              </span>
              {ep.guestName && (
                <span className={cn(
                  "text-static-green/50 truncate w-full text-left",
                  compact ? "text-[8px]" : "text-[11px] md:text-[9px]",
                )}>
                  {ep.guestName}
                </span>
              )}
              {hasProgress && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px]">
                  <div
                    className={cn("h-full", isCompleted ? "bg-static-green/40" : "bg-phosphor-amber/60")}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
