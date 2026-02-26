"use client";

import { usePlayerStore } from "@/stores/player-store";
import { cn } from "@/lib/utils/cn";
import { getShowLabel } from "@/lib/utils/format";
import { CassetteTape } from "./CassetteTape";

interface NowPlayingProps {
  expanded?: boolean;
  className?: string;
}

export function NowPlaying({ expanded = false, className }: NowPlayingProps) {
  const episode = usePlayerStore((s) => s.currentEpisode);
  const objectUrl = usePlayerStore((s) => s.objectUrl);
  const buffering = usePlayerStore((s) => s.buffering);
  const audio = typeof document !== 'undefined' ? document.querySelector('audio') : null;

  if (!episode || !objectUrl) {
    return (
      <div className={cn("flex items-center gap-2 min-w-0", className)} aria-live="polite">
        <CassetteTape className="hidden md:block flex-shrink-0 mt-0.5 opacity-50" />
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="text-[14px] md:text-[11px] text-desktop-gray/50 font-bold truncate">
            No episode loaded
          </div>
          <div className="text-[11px] md:text-[10px] text-bevel-dark/50 truncate">
            Select an episode to begin
          </div>
        </div>
      </div>
    );
  }

  const displayTitle = episode.title || episode.fileName || "Unknown Track";
  const showLabel = getShowLabel(episode.showType) ?? "";

  return (
    <div className={cn("flex items-start gap-2 min-w-0", className)} aria-live="polite">
      <CassetteTape className="hidden md:block flex-shrink-0 mt-0.5" />
      <div className="flex flex-col gap-0.5 min-w-0">
      <div className="text-[14px] md:text-[11px] text-desktop-gray font-bold truncate">
        {displayTitle}
      </div>
      {episode.guestName && (
        <div className="hidden md:block text-[10px] text-static-green/80 truncate">
          {episode.guestName}
        </div>
      )}
      <div className="text-[11px] md:text-[10px] text-bevel-dark/70 truncate">
        {[showLabel, episode.airDate].filter(Boolean).join(" \u00B7 ")}
      </div>

      {/* Extended info in expanded mode */}
      {expanded && (
        <>
          {episode.aiSummary && (
            <div className="text-[10px] text-desktop-gray/50 leading-relaxed mt-1 line-clamp-2">
              {episode.aiSummary}
            </div>
          )}
          {episode.aiTags && episode.aiTags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {episode.aiTags.map((tag) => (
                <span
                  key={tag}
                  className="text-[8px] text-desert-amber/50 px-1 py-px"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </>
      )}
      </div>
    </div>
  );
}
