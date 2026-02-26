"use client";

import { useRef, useMemo } from "react";
import type { Episode } from "@/db/schema";
import { EpisodeCard } from "./EpisodeCard";
import { YearNavigator } from "./YearNavigator";
import { useVirtualList } from "@/hooks/useVirtualList";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils/cn";

interface TimelineViewProps {
  episodes: Episode[];
  currentEpisodeId?: number;
  selectedEpisodeId?: number;
  selectedIds?: Set<number>;
  onEpisodeClick: (episode: Episode, e: React.MouseEvent) => void;
  onEpisodeDoubleClick?: (episode: Episode) => void;
  onEpisodeContextMenu?: (episode: Episode, x: number, y: number) => void;
  onAction?: (action: "scan" | "search") => void;
  onToggleFavorite?: (episode: Episode) => void;
  onQueue?: (episode: Episode) => void;
  className?: string;
}

// Mobile cards need more height for larger text sizes
const ITEM_HEIGHT_MOBILE = 88;
const ITEM_HEIGHT_DESKTOP = 72;

export function TimelineView({
  episodes,
  currentEpisodeId,
  selectedEpisodeId,
  selectedIds,
  onEpisodeClick,
  onEpisodeDoubleClick,
  onEpisodeContextMenu,
  onAction,
  onToggleFavorite,
  onQueue,
  className,
}: TimelineViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const isMobile = useIsMobile();
  const ITEM_HEIGHT = isMobile ? ITEM_HEIGHT_MOBILE : ITEM_HEIGHT_DESKTOP;

  const { virtualItems, totalHeight, onScroll, scrollToIndex } = useVirtualList({
    items: episodes,
    itemHeight: ITEM_HEIGHT,
    containerRef,
    overscan: 5,
  });

  // Derive current year header from first visible episode
  const currentYear = useMemo(() => {
    if (virtualItems.length === 0) return null;
    const firstEp = virtualItems[0].item;
    return firstEp.airDate ? firstEp.airDate.slice(0, 4) : "Unknown";
  }, [virtualItems]);

  // Count episodes per year for header badge
  const yearCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ep of episodes) {
      const year = ep.airDate ? ep.airDate.slice(0, 4) : "Unknown";
      counts.set(year, (counts.get(year) ?? 0) + 1);
    }
    return counts;
  }, [episodes]);

  const sortedYears = useMemo(() => {
    return Array.from(yearCounts.entries())
      .filter(([y]) => y !== "Unknown")
      .sort(([a], [b]) => a.localeCompare(b));
  }, [yearCounts]);

  const handleYearClick = useMemo(() => {
    return (year: string) => {
      const idx = episodes.findIndex((ep) => ep.airDate?.startsWith(year));
      if (idx !== -1) scrollToIndex(idx);
    };
  }, [episodes, scrollToIndex]);

  if (!episodes || episodes.length === 0) {
    return (
      <div className={cn("flex flex-col items-center justify-center py-20 text-center px-8 animate-fade-in", className)}>
        <div className="text-[12px] text-desktop-gray mb-1.5 font-bold">
          No timeline data
        </div>
        <div className="text-[10px] text-bevel-dark leading-relaxed max-w-[300px]">
          No episodes found. Import the Ultimate Art Bell Collection, search archive.org, or scan local files to build your late-night radio archive.
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Sticky year header */}
      {currentYear && (
        <div className="sticky top-0 z-10 bg-midnight/95 backdrop-blur-sm px-4 py-1.5 border-b border-bevel-dark/15 glass-light flex items-center gap-2">
          <span className="text-[12px] text-desert-amber/90 font-bold tabular-nums">
            {currentYear}
          </span>
          <span className="text-[9px] text-bevel-dark/50">
            {yearCounts.get(currentYear) ?? 0}
          </span>
          {/* Year nav dots — desktop only */}
          <div className="hidden md:flex items-center gap-[3px] ml-auto">
            {Array.from(yearCounts.keys())
              .filter((y) => y !== "Unknown")
              .sort()
              .map((year) => (
                <span
                  key={year}
                  className={cn(
                    "w-[3px] h-[3px] rounded-full transition-colors-fast",
                    year === currentYear ? "bg-desert-amber/80" : "bg-bevel-dark/20",
                  )}
                  title={`${year} (${yearCounts.get(year)})`}
                />
              ))}
          </div>
        </div>
      )}

      {/* Virtual scrolling container + year nav */}
      <div className="flex-1 overflow-hidden flex">
        <div
          ref={containerRef}
          onScroll={onScroll}
          className="flex-1 overflow-auto"
        >
          <div className="relative p-2" role="listbox" aria-label="Episodes" style={{ height: totalHeight }}>
            {virtualItems.map(({ item: ep, offsetTop }) => (
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
                />
              </div>
            ))}
          </div>
        </div>
        {sortedYears.length > 1 && (
          <YearNavigator
            years={sortedYears}
            currentYear={currentYear}
            onYearClick={handleYearClick}
          />
        )}
      </div>
    </div>
  );
}
