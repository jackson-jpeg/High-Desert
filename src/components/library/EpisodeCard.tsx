"use client";

import type { Episode } from "@/db/schema";
import { cn } from "@/lib/utils/cn";
import {
  formatDuration,
  formatAirDate,
  formatFileSize,
  getShowLabel,
  LARGE_EPISODE_BYTES,
} from "@/lib/utils/format";
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
  communityPlays?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Column tracks for the desktop row. Kept next to the header definition in
 * TimelineView so the header and the rows can never drift apart.
 */
/*
 * The first track is a fixed width, not `auto`. With `auto` it sized to its
 * content, so the header ("Date") and the rows ("Nov 12, 2013" plus status
 * glyphs) resolved to different widths and every following column drifted out
 * of alignment with its header.
 */
export const EPISODE_GRID_COLS =
  "grid-cols-[132px_minmax(0,1fr)_minmax(0,150px)_60px_56px_20px] " +
  "lg:grid-cols-[132px_minmax(0,1fr)_minmax(0,180px)_minmax(0,140px)_60px_56px_64px_44px_20px]";

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
  communityPlays,
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

  const sizeLabel = formatFileSize(episode.fileSize);
  const isLarge = (episode.fileSize ?? 0) >= LARGE_EPISODE_BYTES;

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
  const cardRef = useRef<HTMLDivElement>(null);
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

  const title = episode.title || episode.fileName;

  const showGuest = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent("hd:show-guest", { detail: episode.guestName }));
  };
  const filterSeries = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent("hd:filter-series", { detail: episode.aiSeries }));
  };

  /* Status glyphs, shared by both layouts. */
  const indicators = (
    <>
      {isPlaying && (
        <span className="w-[5px] h-[5px] rounded-full bg-red-500 animate-on-air flex-shrink-0" />
      )}
      {episode.aiNotable && !isPlaying && (
        <span
          className="text-hd-11 text-yellow-400 flex-shrink-0 drop-shadow-[0_0_3px_rgba(250,204,21,0.4)]"
          title="Notable episode — a classic Art Bell moment"
        >
          {"★"}
        </span>
      )}
      {isCompleted && !isPlaying && (
        <span className="text-hd-10 text-static-green/85 flex-shrink-0" title="Completed">
          {"✓"}
        </span>
      )}
      {hasProgress && !isCompleted && !isPlaying && (
        <span
          className="text-hd-10 text-bevel-dark flex-shrink-0 tabular-nums"
          title={`${Math.round(progressPct)}% played`}
        >
          {Math.round(progressPct)}%
        </span>
      )}
      {episode.aiStatus === "failed" && (
        <span
          className="w-[5px] h-[5px] rounded-full bg-red-400/60 flex-shrink-0"
          title="AI categorization failed"
        />
      )}
    </>
  );

  /* Action controls are real <button>s. The row used to be a <button>
     containing another <button> (series) plus two role="button" spans
     (favourite, guest) — invalid HTML, and three tab stops on each of 1,313
     rows. tabIndex -1 keeps them clickable while the listbox owns keyboard
     navigation. */
  const favButton = onToggleFavorite && (
    <button
      type="button"
      tabIndex={-1}
      onClick={(e) => {
        e.stopPropagation();
        onToggleFavorite(episode);
      }}
      className={cn(
        "flex items-center justify-center flex-shrink-0 cursor-pointer transition-colors-fast",
        "text-hd-12 md:text-hd-10 min-w-[28px] min-h-[28px] md:min-w-0 md:min-h-0",
        episode.favoritedAt
          ? "text-desert-amber"
          : "text-bevel-dark/85 md:opacity-0 md:group-hover:opacity-100",
      )}
      title={episode.favoritedAt ? "Remove from favorites" : "Add to favorites"}
      aria-pressed={!!episode.favoritedAt}
      aria-label={episode.favoritedAt ? "Remove from favorites" : "Add to favorites"}
    >
      {episode.favoritedAt ? "★" : "☆"}
    </button>
  );

  return (
    <div
      ref={cardRef}
      onClick={(e) => onClick(episode, e)}
      onDoubleClick={onDoubleClick ? () => onDoubleClick(episode) : undefined}
      onContextMenu={handleContextMenu}
      onTouchStart={(e) => { longPress.onTouchStart(e); onTouchStartSwipe(e); }}
      onTouchMove={(e) => { longPress.onTouchMove(e); onTouchMoveSwipe(e); }}
      onTouchEnd={(e) => { longPress.onTouchEnd(e); onTouchEndSwipe(); }}
      style={style}
      role="option"
      tabIndex={-1}
      aria-selected={isSelected || isPlaying}
      title={episode.aiSummary || undefined}
      aria-label={`${title}${episode.airDate ? `, ${episode.airDate}` : ""}${isPlaying ? " (now playing)" : ""}`}
      className={cn(
        "w-full h-full text-left w98-raised-dark bg-card-surface relative group glass-light",
        "p-2.5 md:px-2 md:py-0 md:flex md:items-center",
        "transition-all duration-150 cursor-pointer overflow-hidden",
        "hover:bg-title-bar-blue/15 hover:shadow-[0_2px_8px_rgba(0,0,0,0.3)]",
        "active:bg-title-bar-blue/20 active:shadow-none",
        showAccent,
        episode.aiNotable && !isPlaying && "border-l-desert-amber/70 bg-desert-amber/[0.03]",
        episode.favoritedAt && !isPlaying && !episode.aiNotable && "bg-desert-amber/[0.02]",
        isPlaying && "ring-1 ring-static-green/40 bg-title-bar-blue/10 glass-glow-green",
        isSelected && !isPlaying && "bg-highlight-blue/20",
        isMultiSelected && "bg-highlight-blue/30 ring-1 ring-highlight-blue/40",
        className,
      )}
    >
      {/* ---------------------------------------------------------------
          Desktop: one aligned table row.

          This was two stacked rows using justify-between, which pinned the
          content to the far edges and left ~700px of empty gutter down the
          middle of every row at 1440px. Fixed column tracks line the
          metadata up down the whole list and let the title absorb the slack.
          --------------------------------------------------------------- */}
      <div className={cn("hidden md:grid w-full items-center gap-x-3 min-w-0", EPISODE_GRID_COLS)}>
        {/* Date + status */}
        <div className="flex items-center gap-1.5 min-w-0">
          {isMultiSelected && (
            <span className="w-[12px] h-[12px] flex items-center justify-center w98-inset-dark bg-inset-well text-hd-10 text-static-green flex-shrink-0">
              {"✓"}
            </span>
          )}
          <span className="text-hd-11 text-desert-amber tabular-nums flex-shrink-0 font-mono tracking-tight">
            {formatAirDate(episode.airDate) || "Unknown date"}
          </span>
          {indicators}
        </div>

        {/* Title */}
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-hd-12 text-desktop-gray font-bold truncate">{title}</span>
          {episode.aiSeries && (
            <button
              type="button"
              tabIndex={-1}
              onClick={filterSeries}
              className="text-hd-10 text-signal-blue flex-shrink-0 hidden xl:inline cursor-pointer hover:underline transition-colors-fast"
            >
              {episode.aiSeries}{episode.aiSeriesPart ? ` Pt.${episode.aiSeriesPart}` : ""}
            </button>
          )}
        </div>

        {/* Guest */}
        <div className="min-w-0">
          {episode.guestName ? (
            <button
              type="button"
              tabIndex={-1}
              onClick={showGuest}
              aria-label={`View guest profile: ${episode.guestName}`}
              className="text-hd-11 text-static-green/85 truncate max-w-full block text-left hover:text-static-green hover:underline cursor-pointer transition-colors-fast"
            >
              {episode.guestName}
            </button>
          ) : (
            <span className="text-hd-11 text-static-green/85 truncate block">
              {episode.topic || ""}
            </span>
          )}
        </div>

        {/* Category — needs the room, so it only appears at lg and up */}
        <div className="hidden lg:block min-w-0">
          <span className="text-hd-10 text-desert-amber/85 truncate block">
            {episode.aiCategory || ""}
          </span>
        </div>

        {/* Show type */}
        <span className="text-hd-10 text-bevel-dark/85 truncate">{showLabel || ""}</span>

        {/* Duration */}
        <span className="text-hd-11 text-bevel-dark/85 tabular-nums font-mono text-right">
          {episode.duration != null ? formatDuration(episode.duration) : ""}
        </span>

        {/*
          Download size, as its own column rather than a second line under the
          runtime — the desktop row is a fixed 34px virtual-list item and "a
          single aligned table row", so stacking here is what makes rows overlap
          at larger text scales.

          Worth a column of its own because runtime does not predict the wait:
          these are community rips spanning 0.1MB to 268MB, so a three-hour show
          might be 25MB or 190MB. Amber past LARGE_EPISODE_BYTES, so a slow start
          reads as "this is a big file" rather than "the site is broken".
        */}
        <span
          className={cn(
            "hidden lg:block text-hd-10 tabular-nums font-mono text-right",
            isLarge ? "text-desert-amber/85" : "text-bevel-dark/85",
          )}
          title={
            isLarge
              ? "Large file — expect a longer wait before it starts"
              : undefined
          }
        >
          {sizeLabel}
        </span>

        {/* Community plays */}
        <span
          className="hidden lg:block text-hd-10 text-bevel-dark/85 tabular-nums text-right"
          title={communityPlays ? `Played ${communityPlays} times across all listeners` : undefined}
        >
          {communityPlays ? `▶ ${communityPlays.toLocaleString()}` : ""}
        </span>

        {/* Favourite */}
        <div className="flex justify-end">{favButton}</div>
      </div>

      {/* ---------------------------------------------------------------
          Mobile: stacked, unchanged in shape.
          --------------------------------------------------------------- */}
      <div className="md:hidden">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {isMultiSelected && (
              <span className="w-[14px] h-[14px] flex items-center justify-center w98-inset-dark bg-inset-well text-hd-10 text-static-green flex-shrink-0">
                {"✓"}
              </span>
            )}
            <span className="text-hd-12 text-desert-amber tabular-nums flex-shrink-0 font-mono tracking-tight">
              {formatAirDate(episode.airDate) || "Unknown date"}
            </span>
            {indicators}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {favButton}
            {showLabel && (
              <span className="text-hd-10 text-bevel-dark/85 flex-shrink-0">{showLabel}</span>
            )}
          </div>
        </div>

        <div className="text-hd-15 text-desktop-gray font-bold truncate mt-0.5 font-sans leading-tight">
          {title}
        </div>
        {episode.aiCategory && (
          <span className="text-hd-11 text-desert-amber/85 truncate mt-0.5 block">
            {episode.aiCategory}
          </span>
        )}

        <div className="flex items-center justify-between gap-2 mt-0.5">
          {episode.guestName ? (
            <button
              type="button"
              tabIndex={-1}
              onClick={showGuest}
              aria-label={`View guest profile: ${episode.guestName}`}
              className="text-hd-14 text-static-green/90 truncate min-w-0 text-left py-0.5 -my-0.5 cursor-pointer"
            >
              {episode.guestName}
            </button>
          ) : (
            <span className="text-hd-13 text-static-green/85 truncate min-w-0">
              {episode.topic || " "}
            </span>
          )}
          <div className="flex items-center gap-2 flex-shrink-0">
            {episode.duration != null && (
              <span className="text-hd-12 text-bevel-dark/85 tabular-nums font-mono">
                {formatDuration(episode.duration)}
              </span>
            )}
            {sizeLabel && (
              <span
                className={cn(
                  "text-hd-micro tabular-nums font-mono",
                  isLarge ? "text-desert-amber/85" : "text-bevel-dark/85",
                )}
                title={isLarge ? "Large file — expect a longer wait to start" : undefined}
              >
                {sizeLabel}
              </span>
            )}
            {communityPlays != null && communityPlays > 0 && (
              <span
                className="text-hd-8 text-bevel-dark/85 tabular-nums"
                title={`Played ${communityPlays} times across all listeners`}
              >
                {"▶"} {communityPlays.toLocaleString()}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Progress. A hairline along the row's bottom edge on desktop, where
          the absolutely-positioned waveform would collide with the single-row
          grid; the waveform stays on the roomier mobile card. */}
      {hasProgress && (
        <>
          <div
            className="hidden md:block absolute bottom-0 left-0 h-[2px] bg-static-green/40"
            style={{ width: `${progressPct}%` }}
            aria-hidden="true"
          />
          <div className="md:hidden absolute bottom-1 right-2">
            <MiniWaveform progress={progressPct} completed={isCompleted} />
          </div>
        </>
      )}
    </div>
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
    prev.communityPlays === next.communityPlays &&
    prev.className === next.className
  );
});
