"use client";

import type { Episode } from "@/lib/db/schema";
import { cn } from "@/lib/utils/cn";

interface EpisodeCardProps {
  episode: Episode;
  isPlaying?: boolean;
  isSelected?: boolean;
  isMultiSelected?: boolean;
  onClick: (episode: Episode, e: React.MouseEvent) => void;
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

  const showAccent =
    episode.showType === "coast"
      ? "border-l-2 border-l-title-bar-blue/60"
      : episode.showType === "dreamland"
        ? "border-l-2 border-l-static-green/50"
        : episode.showType === "special"
          ? "border-l-2 border-l-desert-amber/50"
          : "";

  const isArchive = episode.source === "archive";
  const hasProgress = (episode.playbackPosition ?? 0) > 0 && (episode.duration ?? 0) > 0;
  const progressPct = hasProgress
    ? Math.min(100, ((episode.playbackPosition! / episode.duration!) * 100))
    : 0;
  const isCompleted = hasProgress && progressPct > 90;

  const handleContextMenu = (e: React.MouseEvent) => {
    if (onContextMenu) {
      e.preventDefault();
      onContextMenu(episode, e.clientX, e.clientY);
    }
  };

  return (
    <button
      onClick={(e) => onClick(episode, e)}
      onDoubleClick={onDoubleClick ? () => onDoubleClick(episode) : undefined}
      onContextMenu={handleContextMenu}
      style={style}
      role="option"
      aria-selected={isSelected || isPlaying}
      aria-label={`${episode.title || episode.fileName}${episode.airDate ? `, ${episode.airDate}` : ""}${isPlaying ? " (now playing)" : ""}`}
      className={cn(
        "w-full text-left p-3 w98-raised-dark bg-card-surface relative group",
        "transition-all duration-150 cursor-pointer",
        "hover:bg-title-bar-blue/15 hover:-translate-y-px hover:shadow-[0_2px_8px_rgba(0,0,0,0.3)]",
        showAccent,
        isPlaying && "ring-1 ring-static-green/40 bg-title-bar-blue/10",
        isSelected && !isPlaying && "bg-highlight-blue/20",
        isMultiSelected && "bg-highlight-blue/30 ring-1 ring-highlight-blue/40",
        className,
      )}
    >
      {/* Top row: date + status indicators */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isMultiSelected && (
            <span className="w-[12px] h-[12px] flex items-center justify-center w98-inset-dark bg-inset-well text-[8px] text-static-green flex-shrink-0">
              {"\u2713"}
            </span>
          )}
          <span className="text-[10px] text-desert-amber tabular-nums">
            {episode.airDate ?? "Unknown date"}
          </span>
          {isPlaying && (
            <span className="w-[5px] h-[5px] rounded-full bg-red-500 animate-on-air flex-shrink-0" />
          )}
          {isCompleted && !isPlaying && (
            <span className="text-[9px] text-static-green/70 flex-shrink-0" title="Completed">
              {"\u2713"}
            </span>
          )}
          {hasProgress && !isCompleted && !isPlaying && (
            <span className="text-[8px] text-bevel-dark flex-shrink-0 tabular-nums" title={`${Math.round(progressPct)}% played`}>
              {Math.round(progressPct)}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {episode.aiStatus === "failed" && (
            <span className="w-[5px] h-[5px] rounded-full bg-red-400/60 flex-shrink-0" title="AI categorization failed" />
          )}
          {showLabel && (
            <span className="text-[9px] text-bevel-dark/70 flex-shrink-0">
              {showLabel}
            </span>
          )}
        </div>
      </div>

      {/* Title */}
      <div className="text-[11px] text-desktop-gray font-bold truncate mt-1">
        {episode.title || episode.fileName}
      </div>

      {/* Guest + duration */}
      <div className="flex items-center justify-between gap-2 mt-0.5">
        <span className="text-[10px] text-static-green/80 truncate">
          {episode.guestName || episode.topic || "\u00A0"}
        </span>
        {episode.duration != null && (
          <span className="text-[10px] text-bevel-dark/70 tabular-nums flex-shrink-0">
            {formatDuration(episode.duration)}
          </span>
        )}
      </div>

      {/* Playback progress bar */}
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
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) {
    return `${h}h ${m}m`;
  }
  return `${m}m`;
}
