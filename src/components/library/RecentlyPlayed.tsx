"use client";

import type { Episode } from "@/lib/db/schema";
import { cn } from "@/lib/utils/cn";

interface RecentlyPlayedProps {
  episodes: Episode[];
  onPlay: (episode: Episode) => void;
  className?: string;
}

export function RecentlyPlayed({ episodes, onPlay, className }: RecentlyPlayedProps) {
  if (episodes.length === 0) return null;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="text-[9px] text-bevel-dark uppercase tracking-wider px-1">
        Recently Played
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {episodes.map((ep) => {
          const hasProgress = (ep.playbackPosition ?? 0) > 0 && (ep.duration ?? 0) > 0;
          const progressPct = hasProgress
            ? Math.min(100, (ep.playbackPosition! / ep.duration!) * 100)
            : 0;

          return (
            <button
              key={ep.id}
              onClick={() => onPlay(ep)}
              className={cn(
                "flex-shrink-0 w-[140px] p-2 w98-raised-dark bg-card-surface",
                "hover:bg-title-bar-blue/15 transition-colors-fast cursor-pointer",
                "flex flex-col gap-0.5 relative",
              )}
            >
              <span className="text-[9px] text-desert-amber tabular-nums">
                {ep.airDate ?? "Unknown"}
              </span>
              <span className="text-[10px] text-desktop-gray font-bold truncate">
                {ep.title || ep.fileName}
              </span>
              {/* Progress bar */}
              {hasProgress && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-transparent">
                  <div
                    className="h-full bg-phosphor-amber/70"
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
