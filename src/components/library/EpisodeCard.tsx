"use client";

import type { Episode } from "@/lib/db/schema";
import { cn } from "@/lib/utils/cn";

interface EpisodeCardProps {
  episode: Episode;
  isPlaying?: boolean;
  onClick: (episode: Episode) => void;
  className?: string;
}

export function EpisodeCard({
  episode,
  isPlaying = false,
  onClick,
  className,
}: EpisodeCardProps) {
  const showLabel =
    episode.showType === "coast"
      ? "Coast to Coast AM"
      : episode.showType === "dreamland"
        ? "Dreamland"
        : episode.showType === "special"
          ? "Special"
          : null;

  return (
    <button
      onClick={() => onClick(episode)}
      className={cn(
        "w-full text-left p-3 w98-raised-dark bg-card-surface",
        "hover:bg-title-bar-blue/15 transition-colors-fast cursor-pointer",
        "flex flex-col gap-1",
        isPlaying && "ring-1 ring-static-green/50 bg-title-bar-blue/10",
        className,
      )}
    >
      {/* Top row: date + show type */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-desert-amber tabular-nums">
          {episode.airDate ?? "Unknown date"}
        </span>
        {showLabel && (
          <span className="text-[9px] text-bevel-dark uppercase tracking-wider">
            {showLabel}
          </span>
        )}
      </div>

      {/* Title */}
      <div className="text-[11px] text-desktop-gray font-bold truncate">
        {episode.title || episode.fileName}
      </div>

      {/* Guest + duration */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-static-green truncate">
          {episode.guestName || episode.topic || "\u00A0"}
        </span>
        {episode.duration && (
          <span className="text-[10px] text-bevel-dark tabular-nums flex-shrink-0">
            {formatDuration(episode.duration)}
          </span>
        )}
      </div>
    </button>
  );
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) {
    return `${h}h ${m}m`;
  }
  return `${m}m`;
}
