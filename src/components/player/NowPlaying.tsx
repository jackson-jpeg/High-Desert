"use client";

import { usePlayerStore } from "@/stores/player-store";
import { cn } from "@/lib/utils/cn";

interface NowPlayingProps {
  expanded?: boolean;
  className?: string;
}

export function NowPlaying({ expanded = false, className }: NowPlayingProps) {
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
    <div className={cn("flex flex-col gap-0.5 min-w-0", className)} aria-live="polite">
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

      {/* Extended info in expanded mode */}
      {expanded && (
        <>
          {episode.aiSummary && (
            <div className="text-[10px] text-desktop-gray/70 leading-relaxed mt-1 line-clamp-2">
              {episode.aiSummary}
            </div>
          )}
          {episode.aiTags && episode.aiTags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {episode.aiTags.map((tag) => (
                <span
                  key={tag}
                  className="text-[8px] text-desert-amber/70 bg-desert-amber/10 px-1 py-px"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
