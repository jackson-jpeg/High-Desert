"use client";

import type { Episode } from "@/db/schema";
import { cn } from "@/lib/utils/cn";
import { formatDuration, getShowLabel } from "@/lib/utils/format";
import { useRef, useCallback, memo } from "react";
import { useLongPress } from "@/hooks/useLongPress";
import { MiniWaveform } from "./MiniWaveform";

interface EpisodeCardProps {
  episode: Episode;
  isPlaying?: boolean;
  isSelected?: boolean;
  isMultiSelected?: boolean;
  onClick: (episode: Episode, e: React.MouseEvent) => void;
  onDoubleClick?: (episode: Episode) => void;
  onContextMenu?: (episode: Episode, x: number, y: number) => void;
  onToggleFavorite?: (episode: Episode) => void;
  onQueue?: (episode: Episode) => void;
  className?: string;
  style?: React.CSSProperties;
}

export const EpisodeCard = memo(function EpisodeCard({
  episode,
  isPlaying = false,
  isSelected = false,
  isMultiSelected = false,
  onClick,
  onDoubleClick,
  onContextMenu,
  onToggleFavorite,
  onQueue,
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

  // Swipe actions (mobile)
  const cardRef = useRef<HTMLButtonElement>(null);
  const swipeState = useRef({ startX: 0, startY: 0, lastX: 0, swiping: false, blocked: false });

  const onTouchStartSwipe = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    // Dead zone: ignore swipes starting within 30px of left edge to avoid conflicting with iOS back-swipe
    const inDeadZone = t.clientX < 30;
    swipeState.current = { startX: t.clientX, startY: t.clientY, lastX: t.clientX, swiping: false, blocked: inDeadZone };
  }, []);

  const onTouchMoveSwipe = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    const s = swipeState.current;
    if (s.blocked) return;
    const dx = t.clientX - s.startX;
    const dy = t.clientY - s.startY;
    if (!s.swiping && Math.abs(dy) > Math.abs(dx)) return;
    if (Math.abs(dx) > 15) s.swiping = true;
    s.lastX = t.clientX;
    if (s.swiping && cardRef.current) {
      const clamped = Math.max(-100, Math.min(100, dx));
      cardRef.current.style.transform = `translateX(${clamped}px)`;
      cardRef.current.style.transition = "none";
    }
  }, []);

  const onTouchEndSwipe = useCallback(() => {
    const s = swipeState.current;
    const dx = s.lastX - s.startX;
    if (cardRef.current) {
      cardRef.current.style.transform = "";
      cardRef.current.style.transition = "transform 0.2s ease-out";
    }
    if (s.swiping) {
      if (dx > 60 && onQueue) {
        onQueue(episode);
      } else if (dx < -60 && onToggleFavorite) {
        onToggleFavorite(episode);
      }
    }
    s.swiping = false;
  }, [episode, onQueue, onToggleFavorite]);

  return (
    <button
      ref={cardRef}
      onClick={(e) => onClick(episode, e)}
      onDoubleClick={onDoubleClick ? () => onDoubleClick(episode) : undefined}
      onContextMenu={handleContextMenu}
      onTouchStart={(e) => { longPress.onTouchStart(e); onTouchStartSwipe(e); }}
      onTouchMove={(e) => { longPress.onTouchMove(e); onTouchMoveSwipe(e); }}
      onTouchEnd={(e) => { longPress.onTouchEnd(e); onTouchEndSwipe(); }}
      style={style}
      role="option"
      aria-selected={isSelected || isPlaying}
      title={episode.aiSummary || undefined}
      aria-label={`${episode.title || episode.fileName}${episode.airDate ? `, ${episode.airDate}` : ""}${isPlaying ? " (now playing)" : ""}`}
      className={cn(
        "w-full text-left p-3 md:p-1.5 w98-raised-dark bg-card-surface relative group glass-light",
        "transition-all duration-150 cursor-pointer",
        "hover:bg-title-bar-blue/15 hover:-translate-y-px hover:shadow-[0_2px_8px_rgba(0,0,0,0.3)]",
        "active:bg-title-bar-blue/20 active:translate-y-0 active:shadow-none",
        showAccent,
        episode.aiNotable && !isPlaying && "border-l-desert-amber/70 bg-desert-amber/[0.03]",
        episode.favoritedAt && !isPlaying && !episode.aiNotable && "bg-desert-amber/[0.02]",
        isPlaying && "ring-1 ring-static-green/40 bg-title-bar-blue/10 glass-glow-green",
        isSelected && !isPlaying && "bg-highlight-blue/20",
        isMultiSelected && "bg-highlight-blue/30 ring-1 ring-highlight-blue/40",
        className,
      )}
    >
      {/* Top row: date + indicators + title (title inline on desktop) */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isMultiSelected && (
            <span className="w-[14px] h-[14px] md:w-[12px] md:h-[12px] flex items-center justify-center w98-inset-dark bg-inset-well text-[9px] md:text-[8px] text-static-green flex-shrink-0">
              {"\u2713"}
            </span>
          )}
          <span className="text-[12px] md:text-[10px] text-desert-amber tabular-nums flex-shrink-0">
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
          {/* Title inline on desktop */}
          <span className="hidden md:inline text-[11px] text-desktop-gray font-bold truncate">
            {episode.title || episode.fileName}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {episode.rating && (
            <span className="text-[8px] text-desert-amber/60 flex-shrink-0 tabular-nums hidden md:inline" title={`Rated ${episode.rating}/5`}>
              {"★".repeat(episode.rating)}
            </span>
          )}
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
                "text-[11px] md:text-[9px] min-w-[28px] min-h-[28px] md:min-w-0 md:min-h-0 flex items-center justify-center flex-shrink-0 cursor-pointer transition-colors-fast",
                episode.favoritedAt
                  ? "text-desert-amber"
                  : "text-bevel-dark/30 md:opacity-0 md:group-hover:opacity-100",
              )}
              title={episode.favoritedAt ? "Remove from favorites" : "Add to favorites"}
              role="button"
              aria-pressed={!!episode.favoritedAt}
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

      {/* Title — mobile only (shown inline on desktop above) */}
      <div className="text-[13px] text-desktop-gray font-bold truncate mt-1 md:hidden">
        {episode.title || episode.fileName}
      </div>

      {/* Guest + series + duration */}
      <div className="flex items-center justify-between gap-2 mt-0.5">
        <div className="flex items-center gap-1.5 min-w-0 truncate">
          {episode.guestName ? (
            <span
              className="text-[13px] md:text-[10px] text-static-green/90 md:text-static-green/80 truncate hover:text-static-green hover:underline active:text-static-green cursor-pointer py-0.5 -my-0.5"
              onClick={(e) => {
                e.stopPropagation();
                window.dispatchEvent(new CustomEvent("hd:show-guest", { detail: episode.guestName }));
              }}
            >
              {episode.guestName}
            </span>
          ) : (
            <span className="text-[12px] md:text-[10px] text-static-green/80 truncate">
              {episode.topic || "\u00A0"}
            </span>
          )}
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

      {/* Fallback artwork placeholder */}
      {!episode.coverImage && (
        <div className="absolute top-3 right-3 md:top-1.5 md:right-1.5 w-8 h-8 md:w-6 md:h-6 flex items-center justify-center w98-inset-dark bg-inset-well rounded-sm">
          <svg className="w-4 h-4 md:w-3 md:h-3 text-bevel-dark/50" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
          </svg>
        </div>
      )}

      {/* Mini waveform progress indicator */}
      {hasProgress && (
        <div className="absolute bottom-1 right-2">
          <MiniWaveform progress={progressPct} completed={isCompleted} />
        </div>
      )}
    </button>
  );
}, (prev, next) => {
  return (
    prev.episode === next.episode &&
    prev.isPlaying === next.isPlaying &&
    prev.isSelected === next.isSelected &&
    prev.isMultiSelected === next.isMultiSelected &&
    prev.onClick === next.onClick &&
    prev.onDoubleClick === next.onDoubleClick &&
    prev.onContextMenu === next.onContextMenu &&
    prev.onToggleFavorite === next.onToggleFavorite &&
    prev.onQueue === next.onQueue &&
    prev.className === next.className
  );
});
