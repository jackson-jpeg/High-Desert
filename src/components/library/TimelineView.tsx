"use client";

import type { Episode } from "@/lib/db/schema";
import { EpisodeCard } from "./EpisodeCard";
import { cn } from "@/lib/utils/cn";

interface TimelineViewProps {
  episodes: Episode[];
  currentEpisodeId?: number;
  selectedEpisodeId?: number;
  onEpisodeClick: (episode: Episode) => void;
  onEpisodeDoubleClick?: (episode: Episode) => void;
  onAction?: (action: "scan" | "search") => void;
  className?: string;
}

interface YearGroup {
  year: string;
  episodes: Episode[];
}

function groupByYear(episodes: Episode[]): YearGroup[] {
  const groups = new Map<string, Episode[]>();

  for (const ep of episodes) {
    const year = ep.airDate ? ep.airDate.slice(0, 4) : "Unknown";
    const list = groups.get(year) ?? [];
    list.push(ep);
    groups.set(year, list);
  }

  // Sort years descending
  return Array.from(groups.entries())
    .sort(([a], [b]) => (b === "Unknown" ? -1 : a === "Unknown" ? 1 : b.localeCompare(a)))
    .map(([year, episodes]) => ({ year, episodes }));
}

export function TimelineView({
  episodes,
  currentEpisodeId,
  selectedEpisodeId,
  onEpisodeClick,
  onEpisodeDoubleClick,
  onAction,
  className,
}: TimelineViewProps) {
  const groups = groupByYear(episodes);

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
    <div className={cn("flex flex-col", className)}>
      {groups.map(({ year, episodes: yearEpisodes }) => (
        <div key={year}>
          {/* Sticky year header */}
          <div className="sticky top-0 z-10 bg-midnight/95 backdrop-blur-sm px-4 py-2 border-b border-bevel-dark/20">
            <span className="text-[12px] text-desert-amber font-bold">
              {year}
            </span>
            <span className="text-[10px] text-bevel-dark ml-2">
              ({yearEpisodes.length} episodes)
            </span>
          </div>

          {/* Episode cards */}
          <div className="flex flex-col gap-[3px] p-2">
            {yearEpisodes.map((ep, i) => (
              <EpisodeCard
                key={ep.id}
                episode={ep}
                isPlaying={ep.id === currentEpisodeId}
                isSelected={ep.id === selectedEpisodeId}
                onClick={onEpisodeClick}
                onDoubleClick={onEpisodeDoubleClick}
                style={{ "--i": i } as React.CSSProperties}
                className="animate-stagger"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
