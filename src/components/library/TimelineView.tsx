"use client";

import { useRef, useMemo } from "react";
import type { Episode } from "@/lib/db/schema";
import { EpisodeCard } from "./EpisodeCard";
import { useVirtualList } from "@/hooks/useVirtualList";
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
  className?: string;
}

const ITEM_HEIGHT = 88; // EpisodeCard height: p-3 (24px) + 3 rows ~48px + gap-1 (8px) + margin (8px)

export function TimelineView({
  episodes,
  currentEpisodeId,
  selectedEpisodeId,
  selectedIds,
  onEpisodeClick,
  onEpisodeDoubleClick,
  onEpisodeContextMenu,
  onAction,
  className,
}: TimelineViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const { virtualItems, totalHeight, onScroll } = useVirtualList({
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

  if (episodes.length === 0) {
    return (
      <div className={cn("flex flex-col items-center justify-center py-24 text-center px-8", className)}>
        <div className="text-[20px] text-desert-amber/60 mb-4">
          ~
        </div>
        <div className="text-[13px] text-desktop-gray mb-2">
          Your library is empty
        </div>
        <div className="text-[11px] text-bevel-dark leading-relaxed max-w-[280px] mb-4">
          Scan a local folder or search the archive to start building your collection.
        </div>
        {onAction && (
          <div className="flex items-center gap-4">
            <button
              onClick={() => onAction("scan")}
              className="text-[10px] text-desert-amber hover:text-desktop-gray cursor-pointer transition-colors-fast"
            >
              Scan Folder
            </button>
            <span className="text-[10px] text-bevel-dark/40">or</span>
            <button
              onClick={() => onAction("search")}
              className="text-[10px] text-title-bar-blue hover:text-desktop-gray cursor-pointer transition-colors-fast"
            >
              Search Archive
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Sticky year header */}
      {currentYear && (
        <div className="sticky top-0 z-10 bg-midnight/95 backdrop-blur-sm px-4 py-2 border-b border-bevel-dark/20">
          <span className="text-[12px] text-desert-amber font-bold">
            {currentYear}
          </span>
          <span className="text-[10px] text-bevel-dark ml-2">
            ({yearCounts.get(currentYear) ?? 0} episodes)
          </span>
        </div>
      )}

      {/* Virtual scrolling container */}
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="flex-1 overflow-auto"
      >
        <div className="relative p-2" role="listbox" aria-label="Episodes" style={{ height: totalHeight }}>
          {virtualItems.map(({ item: ep, index, offsetTop }) => (
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
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
