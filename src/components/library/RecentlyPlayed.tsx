"use client";

import type { Episode } from "@/db/schema";
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
      <div className="px-1">
        <span className="text-[11px] md:text-[9px] text-bevel-dark/60 uppercase tracking-wider">
          Recently Played
        </span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1.5 scrollbar-thin snap-x snap-mandatory md:snap-none">
        {episodes.map((ep) => {
          const hasProgress = (ep.playbackPosition ?? 0) > 0 && (ep.duration ?? 0) > 0;
          const progressPct = hasProgress
            ? Math.min(100, (ep.playbackPosition! / ep.duration!) * 100)
            : 0;
          const isCompleted = hasProgress && progressPct > 90;

          return (
            <button
              key={ep.id}
              onClick={() => onPlay(ep)}
              className={cn(
                "flex-shrink-0 w-[180px] md:w-[160px] p-2.5 md:p-2 w98-raised-dark bg-card-surface group snap-start",
                "hover:bg-title-bar-blue/15 hover:-translate-y-px hover:shadow-[0_2px_8px_rgba(0,0,0,0.3)]",
                "active:bg-title-bar-blue/20",
                "transition-all duration-150 cursor-pointer",
                "flex flex-col gap-0.5 relative",
              )}
            >
              <span className="text-[11px] md:text-[9px] text-desert-amber/80 tabular-nums">
                {ep.airDate ?? "Unknown"}
              </span>
              <span className="text-[12px] md:text-[10px] text-desktop-gray font-bold truncate w-full text-left">
                {ep.title || ep.fileName}
              </span>
              {ep.guestName && (
                <span className="text-[11px] md:text-[9px] text-static-green/50 truncate w-full text-left">
                  {ep.guestName}
                </span>
              )}
              {/* Progress bar */}
              {hasProgress && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px]">
                  <div
                    className={cn(
                      "h-full",
                      isCompleted ? "bg-static-green/40" : "bg-phosphor-amber/60",
                    )}
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
