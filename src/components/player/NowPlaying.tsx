"use client";

import { usePlayerStore } from "@/stores/player-store";
import { cn } from "@/lib/utils/cn";

interface NowPlayingProps {
  className?: string;
}

export function NowPlaying({ className }: NowPlayingProps) {
  const episode = usePlayerStore((s) => s.currentEpisode);

  if (!episode) {
    return (
      <div className={cn("text-[11px] text-bevel-dark", className)}>
        No episode loaded
      </div>
    );
  }

  const displayTitle = episode.title || episode.fileName;
  const showLabel =
    episode.showType === "coast"
      ? "Coast to Coast AM"
      : episode.showType === "dreamland"
        ? "Dreamland"
        : episode.showType === "special"
          ? "Special"
          : "";

  return (
    <div className={cn("flex flex-col gap-0.5 min-w-0", className)}>
      <div className="text-[11px] text-desktop-gray font-bold truncate">
        {displayTitle}
      </div>
      {episode.guestName && (
        <div className="text-[10px] text-static-green truncate">
          {episode.guestName}
        </div>
      )}
      <div className="text-[10px] text-bevel-dark truncate">
        {[showLabel, episode.airDate].filter(Boolean).join(" \u2014 ")}
      </div>
    </div>
  );
}
