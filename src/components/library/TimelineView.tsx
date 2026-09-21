"use client";

import { useMemo, useCallback, useEffect, useRef } from "react";
import type { Episode } from "@/db/schema";
import { EpisodeCard, EPISODE_GRID_COLS } from "./EpisodeCard";
import { YearNavigator } from "./YearNavigator";
import { YearScrubber } from "./YearScrubber";
import { useWakeFlag } from "@/hooks/useWakeFlag";
import { useVirtualList } from "@/hooks/useVirtualList";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils/cn";
import { communityKey } from "@/lib/utils/community-key";
import { useCommunityStats } from "@/hooks/useCommunityStats";
import { useTextScale, itemHeightFor } from "@/hooks/useTextScale";
import { deriveRailGroups, activeGroupIndex, type RailGroup } from "@/lib/library/rail-groups";
import type { SortMode } from "@/lib/library/filter-episodes";

interface TimelineViewProps {
  /** The rendered list, already filtered and sorted — the rail is derived from exactly this. */
  episodes: Episode[];
  /** How `episodes` was ordered; decides what the rail's groups are. */
  sortMode?: SortMode;
  /** An active series filter overrides `sortMode`'s order (see `sortEpisodes`). */
  seriesFilter?: string | null;
  /** Offered as the newest/oldest toggle in date order. */
  onSortModeChange?: (mode: SortMode) => void;
  currentEpisodeId?: number;
  selectedEpisodeId?: number;
  selectedIds?: Set<number>;
  /**
   * The keyboard's active row (`useLibrarySelection().activeIndex`), or -1.
   * `aria-activedescendant` points at it, and the list scrolls to keep it
   * rendered (HD-021).
   */
  activeRow?: number;
  onEpisodeClick: (episode: Episode, e: React.MouseEvent) => void;
  onEpisodeDoubleClick?: (episode: Episode) => void;
  onEpisodeContextMenu?: (episode: Episode, x: number, y: number) => void;
  onAction?: (action: "scan" | "search") => void;
  onToggleFavorite?: (episode: Episode) => void;
  onQueue?: (episode: Episode) => void;
  className?: string;
}

/** The DOM id of an episode's row, for `aria-activedescendant`. */
export function optionIdFor(ep: Episode): string {
  return `episode-option-${ep.id}`;
}

/** How long the mobile scrubber stays up after the list stops moving. */
export const SCRUBBER_IDLE_MS = 1500;

// Row heights live in @/hooks/useTextScale — they are shared with the
// scroll-to-index call sites in the library page, which used to carry their own
// diverging copies.

export function TimelineView({
  episodes,
  sortMode = "date",
  seriesFilter = null,
  onSortModeChange,
  currentEpisodeId,
  selectedEpisodeId,
  selectedIds,
  activeRow = -1,
  onEpisodeClick,
  onEpisodeDoubleClick,
  onEpisodeContextMenu,
  onAction,
  onToggleFavorite,
  onQueue,
  className,
}: TimelineViewProps) {
  const isMobile = useIsMobile();
  const textScale = useTextScale();
  const ITEM_HEIGHT = itemHeightFor(isMobile, textScale);

  const { containerRef, virtualItems, totalHeight, visibleStartIndex, onScroll, scrollToIndex } = useVirtualList({
    items: episodes,
    itemHeight: ITEM_HEIGHT,
    overscan: 5,
  });

  // Community play counts for the visible window only. Requesting the whole
  // filtered list (~1,300 ids) blew past the route's 100-id cap and 400'd every
  // time. The hook debounces and caches, so scrolling doesn't spam the server.
  const visibleKeys = useMemo(
    () =>
      virtualItems
        .map((v) => communityKey(v.item))
        .filter((k): k is string => !!k),
    [virtualItems],
  );
  const communityPlayCounts = useCommunityStats(visibleKeys);

  // The rail and the sticky header are projections of `episodes` — the same
  // array, in the same order, as the rows below (docs/timeline-rail.md).
  const groups = useMemo(
    () => deriveRailGroups(episodes, sortMode, seriesFilter),
    [episodes, sortMode, seriesFilter],
  );

  // The first row actually on screen. Not `virtualItems[0]`, which is an
  // overscan row five rows above the viewport (HD-035).
  const firstRow = visibleStartIndex;
  const activeIndex = activeGroupIndex(groups, firstRow);
  const activeGroup: RailGroup | null = activeIndex >= 0 ? groups[activeIndex] : null;

  // A rail entry means "the start of this group": its first row goes to the
  // top of the list, so the entry clicked is the one that becomes active.
  const handleSelect = useCallback(
    (group: RailGroup) => scrollToIndex(group.firstIndex, "start"),
    [scrollToIndex],
  );

  // Mobile scrubber: up while the list moves, gone ~1.5s after it stops.
  const [scrubberAwake, wakeScrubber] = useWakeFlag(SCRUBBER_IDLE_MS);
  const handleScroll = useCallback(() => {
    onScroll();
    wakeScrubber();
  }, [onScroll, wakeScrubber]);

  // Keep the active row in view — and so in the DOM. The list is virtualised:
  // a row scrolled out of the window is not rendered at all, and an
  // `aria-activedescendant` naming a missing id is announced as nothing.
  // "Nearest": no movement while the row is already on screen, so a mouse
  // click never scrolls the list under the pointer. The listbox sits below the
  // sticky column header inside the scroller; `offsetTop` is that header.
  const listboxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const listbox = listboxRef.current;
    const scroller = listbox?.parentElement;
    if (!listbox || !scroller || activeRow < 0) return;
    const top = activeRow * ITEM_HEIGHT;
    const bottom = listbox.offsetTop + top + ITEM_HEIGHT;
    if (top < scroller.scrollTop) {
      scroller.scrollTop = top;
    } else if (bottom > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = bottom - scroller.clientHeight;
    } else {
      return;
    }
    onScroll();
  }, [activeRow, ITEM_HEIGHT, onScroll]);

  const activeEpisode = activeRow >= 0 ? episodes[activeRow] : undefined;
  // Only name a row that is actually rendered; see above.
  const activeRendered = !!activeEpisode && virtualItems.some((v) => v.index === activeRow);

  const dateDirection = !seriesFilter && (sortMode === "date" || sortMode === "date-asc") ? sortMode : null;

  if (episodes.length === 0) {
    return (
      <div className={cn("flex flex-col items-center justify-center py-20 text-center px-8 animate-fade-in", className)}>
        {/* Radio tower icon */}
        <div className="relative mb-5">
          {/* Decorative glyph, hidden from assistive technology: no text to read. */}
          {/* eslint-disable-next-line hd/text-opacity-floor */}
          <div className="text-hd-32 text-desert-amber opacity-20 select-none" aria-hidden="true">{"\u{1F4E1}"}</div>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-[3px] h-[3px] rounded-full bg-desert-amber/40 animate-on-air" />
          </div>
        </div>

        <div className="text-hd-13 text-desktop-gray mb-1.5 font-bold">
          No episodes yet
        </div>
        <div className="text-hd-11 text-bevel-dark leading-relaxed max-w-[300px] mb-5">
          Start building your late-night radio archive. Import the Ultimate Art Bell Collection, search archive.org, or scan local files.
        </div>

        {onAction ? (
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-3">
              <button
                onClick={() => onAction("scan")}
                className={cn(
                  "text-hd-11 px-3 py-1.5 w98-raised-dark bg-raised-surface",
                  "text-desert-amber hover:bg-title-bar-blue/15 cursor-pointer transition-colors-fast",
                )}
              >
                Import Collection
              </button>
              <button
                onClick={() => onAction("search")}
                className={cn(
                  "text-hd-11 px-3 py-1.5 w98-raised-dark bg-raised-surface",
                  "text-signal-blue hover:bg-title-bar-blue/15 cursor-pointer transition-colors-fast",
                )}
              >
                Search Archive
              </button>
            </div>
            <span className="text-hd-10 text-bevel-dark/85 mt-1">
              Keyboard: / to search, Ctrl+Shift+S to scan
            </span>
          </div>
        ) : (
          <div className="text-hd-10 text-bevel-dark/85 italic">
            The library is being set up. Episodes will appear shortly.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Sticky group header: the group of the first visible row, and in
          date order the direction toggle — the only place the ascending sort
          is offered on desktop outside the sort presets. */}
      {(activeGroup || dateDirection) && (
        <div className="sticky top-0 z-10 bg-midnight/95 backdrop-blur-sm px-4 py-1.5 border-b border-bevel-dark/15 glass-light flex items-center gap-2">
          {activeGroup && (
            <>
              <span data-testid="rail-header-group" data-group={activeGroup.key} className="text-hd-13 text-desert-amber/90 font-bold tabular-nums truncate">
                {activeGroup.title}
              </span>
              <span className="text-hd-10 text-bevel-dark/85">
                {activeGroup.count}
              </span>
            </>
          )}
          {dateDirection && onSortModeChange && (
            <button
              type="button"
              onClick={() => onSortModeChange(dateDirection === "date" ? "date-asc" : "date")}
              aria-label={dateDirection === "date" ? "Newest first — switch to oldest first" : "Oldest first — switch to newest first"}
              className="ml-auto min-h-touch md:min-h-0 px-2 text-hd-10 text-bevel-dark/85 hover:text-desktop-gray cursor-pointer transition-colors-fast whitespace-nowrap"
            >
              {dateDirection === "date" ? "Newest first \u2193" : "Oldest first \u2191"}
            </button>
          )}
        </div>
      )}

      {/* Virtual scrolling container + year nav */}
      <div className="relative flex-1 overflow-hidden flex">
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-auto overscroll-contain"
        >
          {/* Column header — desktop only. It lives *inside* the scroller, and
              carries the same mx-2 inset as the rows, so it is measured against
              exactly the same width they are. Placed outside, it was wider by
              the year rail plus the scrollbar, and the flexible title column
              absorbed the difference — so every label from Guest rightward sat
              ~60px off its own column. */}
          <div
            className={cn(
              "hidden md:grid sticky top-0 z-10 items-center gap-x-3 mx-2 px-2 py-1",
              "bg-midnight/95 backdrop-blur-sm border-b border-bevel-dark/20",
              "text-hd-10 text-bevel-dark/85 uppercase tracking-wider select-none",
              EPISODE_GRID_COLS,
            )}
            aria-hidden="true"
          >
            <span>Date</span>
            <span>Title</span>
            <span>Guest</span>
            <span className="hidden lg:block">Category</span>
            <span>Show</span>
            <span className="text-right">Length</span>
            <span className="hidden lg:block text-right">Size</span>
            <span className="hidden lg:block text-right">Plays</span>
            <span />
          </div>

          {/* A focusable single-select listbox (HD-021). Focus stays on the
              listbox; the active row is announced through
              aria-activedescendant, so rows need no tab stops of their own.
              Keys are useLibraryKeyboard's. */}
          <div
            ref={listboxRef}
            className="relative px-2 pb-2 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-signal-blue/60"
            role="listbox"
            aria-label="Episodes"
            tabIndex={0}
            aria-activedescendant={activeRendered ? optionIdFor(activeEpisode) : undefined}
            data-episode-listbox=""
            style={{ height: totalHeight }}
          >
            {virtualItems.map(({ item: ep, offsetTop, index }) => (
              <div
                key={ep.id}
                className="absolute left-2 right-2"
                style={{ top: offsetTop, height: ITEM_HEIGHT }}
              >
                <EpisodeCard
                  episode={ep}
                  isPlaying={ep.id === currentEpisodeId}
                  isSelected={ep.id === selectedEpisodeId}
                  isMultiSelected={selectedIds ? selectedIds.has(ep.id!) : false}
                  onClick={onEpisodeClick}
                  onDoubleClick={onEpisodeDoubleClick}
                  onContextMenu={onEpisodeContextMenu}
                  onToggleFavorite={onToggleFavorite}
                  onQueue={onQueue}
                  communityPlays={communityPlayCounts.get(communityKey(ep) ?? "")}
                  optionId={optionIdFor(ep)}
                  setSize={episodes.length}
                  posInSet={index + 1}
                />
              </div>
            ))}
          </div>
        </div>
        {isMobile ? (
          <YearScrubber
            groups={groups}
            activeIndex={activeIndex}
            awake={scrubberAwake}
            onSelect={handleSelect}
            onRelease={wakeScrubber}
          />
        ) : (
          <YearNavigator groups={groups} activeIndex={activeIndex} onSelect={handleSelect} />
        )}
      </div>
    </div>
  );
}
