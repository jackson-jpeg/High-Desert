"use client";

import type { Episode } from "@/lib/db/schema";
import { cn } from "@/lib/utils/cn";

interface EpisodeCardProps {
  episode: Episode;
  isPlaying?: boolean;
  isSelected?: boolean;
  isMultiSelected?: boolean;
  onClick: (episode: Episode) => void;
  onDoubleClick?: (episode: Episode) => void;
  onContextMenu?: (episode: Episode, x: number, y: number) => void;
  className?: string;
  style?: React.CSSProperties;
}

export function EpisodeCard({
  episode,
  isPlaying = false,
  isSelected = false,
  isMultiSelected = false,
  onClick,
  onDoubleClick,
  onContextMenu,
  className,
  style,
}: EpisodeCardProps) {
  const showLabel =
    episode.showType === "coast"
      ? "Coast to Coast AM"
      : episode.showType === "dreamland"
        ? "Dreamland"
        : episode.showType === "special"
          ? "Special"
          : null;

  const isArchive = episode.source === "archive";
  const hasProgress = (episode.playbackPosition ?? 0) > 0 && (episode.duration ?? 0) > 0;
  const progressPct = hasProgress
    ? Math.min(100, ((episode.playbackPosition! / episode.duration!) * 100))
    : 0;

  const handleContextMenu = (e: React.MouseEvent) => {
    if (onContextMenu) {
      e.preventDefault();
      onContextMenu(episode, e.clientX, e.clientY);
    }
  };

  return (
    <button
      onClick={() => onClick(episode)}
      onDoubleClick={onDoubleClick ? () => onDoubleClick(episode) : undefined}
      onContextMenu={handleContextMenu}
      style={style}
      role="option"
      aria-selected={isSelected || isPlaying}
      aria-label={`${episode.title || episode.fileName}${episode.airDate ? `, ${episode.airDate}` : ""}${isPlaying ? " (now playing)" : ""}`}
      className={cn(
        "w-full text-left p-3 w98-raised-dark bg-card-surface relative",
        "hover:bg-title-bar-blue/15 transition-colors-fast cursor-pointer",
        "flex flex-col gap-1",
        isPlaying && "ring-1 ring-static-green/40 bg-title-bar-blue/10",
        isSelected && !isPlaying && "bg-highlight-blue/20",
        isMultiSelected && "bg-highlight-blue/30 ring-1 ring-highlight-blue/40",
        className,
      )}
    >
      {/* Top row: date + show type + source + AI status */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] text-desert-amber tabular-nums">
            {episode.airDate ?? "Unknown date"}
          </span>
          {isArchive && (
            <span className="text-[8px] text-title-bar-blue bg-title-bar-blue/15 px-1 py-px uppercase tracking-wider flex-shrink-0">
              Archive
            </span>
          )}
          {episode.aiStatus === "failed" && (
            <span className="text-[8px] text-red-400 bg-red-400/15 px-1 py-px uppercase tracking-wider flex-shrink-0">
              AI Failed
            </span>
          )}
        </div>
        {showLabel && (
          <span className="text-[9px] text-bevel-dark uppercase tracking-wider flex-shrink-0">
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
        {episode.duration != null && (
          <span className="text-[10px] text-bevel-dark tabular-nums flex-shrink-0">
            {formatDuration(episode.duration)}
          </span>
        )}
      </div>

      {/* Playback progress bar */}
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
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) {
    return `${h}h ${m}m`;
  }
  return `${m}m`;
}
