"use client";

import type { Episode } from "@/db/schema";
import { cn } from "@/lib/utils/cn";
import { formatDuration, getShowLabel } from "@/lib/utils/format";
import { useLongPress } from "@/hooks/useLongPress";

interface EpisodeCardProps {
  episode: Episode;
  isPlaying?: boolean;
  isSelected?: boolean;
  isMultiSelected?: boolean;
  onClick: (episode: Episode, e: React.MouseEvent) => void;
  onDoubleClick?: (episode: Episode) => void;
  onContextMenu?: (episode: Episode, x: number, y: number) => void;
  onToggleFavorite?: (episode: Episode) => void;
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
  onToggleFavorite,
  className,
  style,
}: EpisodeCardProps) {
  const showLabel = getShowLabel(episode.showType);

  const showAccent =
    episode.showType === "coast"
      ? "border-l-2 border-l-title-bar-blue/60"
      : episode.showType === "dreamland"
        ? "border-l-2 border-l-static-green/50"
        : episode.showType === "special"
          ? "border-l-2 border-l-desert-amber/50"
          : "";

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

  const longPress = useLongPress((e) => {
    if (onContextMenu) {
      const touch = e.touches[0];
      onContextMenu(episode, touch?.clientX ?? 0, touch?.clientY ?? 0);
    }
  });

  return (
    <button
      onClick={(e) => onClick(episode, e)}
      onDoubleClick={onDoubleClick ? () => onDoubleClick(episode) : undefined}
      onContextMenu={handleContextMenu}
      {...longPress}
      style={style}
      role="option"
      aria-selected={isSelected || isPlaying}
      aria-label={`${episode.title || episode.fileName}${episode.airDate ? `, ${episode.airDate}` : ""}${isPlaying ? " (now playing)" : ""}`}
      className={cn(
        "w-full text-left p-3 w98-raised-dark bg-card-surface relative group glass-light",
        "transition-all duration-150 cursor-pointer",
        "hover:bg-title-bar-blue/15 hover:-translate-y-px hover:shadow-[0_2px_8px_rgba(0,0,0,0.3)] active:bg-title-bar-blue/20",
        showAccent,
        episode.aiNotable && !isPlaying && "border-l-desert-amber/70 bg-desert-amber/[0.03]",
        episode.favoritedAt && !isPlaying && !episode.aiNotable && "bg-desert-amber/[0.02]",
        isPlaying && "ring-1 ring-static-green/40 bg-title-bar-blue/10 glass-glow-green",
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
          <span className="text-[12px] md:text-[10px] text-desert-amber tabular-nums">
            {episode.airDate ?? "Unknown date"}
          </span>
          {isPlaying && (
            <span className="w-[5px] h-[5px] rounded-full bg-red-500 animate-on-air flex-shrink-0" />
          )}
          {episode.aiNotable && !isPlaying && (
            <span
              className="text-[10px] text-yellow-400 flex-shrink-0 drop-shadow-[0_0_3px_rgba(250,204,21,0.4)]"
              title="Notable episode — a classic Art Bell moment"
            >
              {"\u2605"}
            </span>
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
          {episode.aiCategory && (
            <span className="text-[7px] text-desert-amber/50 flex-shrink-0 hidden md:inline">
              {episode.aiCategory}
            </span>
          )}
          {episode.aiStatus === "failed" && (
            <span className="w-[5px] h-[5px] rounded-full bg-red-400/60 flex-shrink-0" title="AI categorization failed" />
          )}
          {onToggleFavorite && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(episode);
              }}
              className={cn(
                "text-[11px] md:text-[9px] flex-shrink-0 cursor-pointer transition-colors-fast",
                episode.favoritedAt
                  ? "text-desert-amber"
                  : "text-bevel-dark/30 opacity-0 group-hover:opacity-100",
              )}
              title={episode.favoritedAt ? "Remove from favorites" : "Add to favorites"}
              role="button"
              aria-label={episode.favoritedAt ? "Remove from favorites" : "Add to favorites"}
            >
              {episode.favoritedAt ? "\u2605" : "\u2606"}
            </span>
          )}
          {showLabel && (
            <span className="text-[9px] text-bevel-dark/70 flex-shrink-0">
              {showLabel}
            </span>
          )}
        </div>
      </div>

      {/* Title */}
      <div className="text-[13px] md:text-[11px] text-desktop-gray font-bold truncate mt-1">
        {episode.title || episode.fileName}
      </div>

      {/* Guest + series + duration */}
      <div className="flex items-center justify-between gap-2 mt-0.5">
        <div className="flex items-center gap-1.5 min-w-0 truncate">
          <span className="text-[12px] md:text-[10px] text-static-green/80 truncate">
            {episode.guestName || episode.topic || "\u00A0"}
          </span>
          {episode.aiSeries && (
            <span className="text-[8px] text-title-bar-blue/50 flex-shrink-0 hidden md:inline">
              {episode.aiSeries}{episode.aiSeriesPart ? ` Pt.${episode.aiSeriesPart}` : ""}
            </span>
          )}
        </div>
        {episode.duration != null && (
          <span className="text-[12px] md:text-[10px] text-bevel-dark/70 tabular-nums flex-shrink-0">
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
